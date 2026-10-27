import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCampus } from "../../shared/src/campus";
import {
  SCHOOL_IDS,
  TTL_RATED_SECONDS,
  TTL_SHORT_SECONDS,
  parseRatingsResponse,
  parseVersionResponse,
  schoolGraphqlId,
  type RatingRequestItem,
} from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { parseInstructor } from "../../shared/src/names";
import worker, { type Env } from "../src/index";
import { resetSurnameIsolate } from "../src/rmp";

const TOKEN = "public-token";

interface MemoryKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  puts: Array<{ key: string; expirationTtl?: number }>;
}

afterEach(() => {
  resetSurnameIsolate();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function memoryKv(failPut = false): MemoryKv {
  const rows = new Map<string, string>();
  const puts: MemoryKv["puts"] = [];
  return {
    puts,
    async get(key) {
      return rows.get(key) ?? null;
    },
    async put(key, value, options) {
      if (failPut) {
        throw new Error("kv down");
      }
      rows.set(key, value);
      puts.push({ key, expirationTtl: options?.expirationTtl });
    },
  };
}

function envFor(kv: MemoryKv, cacheVersion = 1): Env {
  return { cacheVersion, rmpToken: TOKEN, RATINGS: kv };
}

function item(overrides: Partial<RatingRequestItem> = {}): RatingRequestItem {
  return {
    key: "row",
    name: "Ann Smith",
    campus: " Queens Campus",
    subject: "Computer Science",
    ...overrides,
  };
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    legacyId: 42,
    firstName: "Ann",
    lastName: "Smith",
    department: "Computer Science",
    numRatings: 28,
    avgRating: 4.5,
    avgDifficulty: 3.1,
    wouldTakeAgainPercent: 80,
    school: { name: "St. John's University - Jamaica/Queens", legacyId: SCHOOL_IDS.queens },
    ...overrides,
  };
}

function page(nodes: Record<string, unknown>[], hasNextPage: boolean, endCursor: string | null) {
  return new Response(
    JSON.stringify({
      data: {
        search: {
          teachers: {
            edges: nodes.map((entry) => ({ node: entry })),
            pageInfo: { hasNextPage, endCursor },
          },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function emptyPage(hasNextPage: boolean, endCursor: string | null) {
  return page([], hasNextPage, endCursor);
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return JSON.parse(String(init.body)) as {
      variables: { cursor: string; query: { text: string; schoolID: string } };
    };
  });
}

function stub(fetchImpl: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

async function post(items: RatingRequestItem[], env: Env) {
  return worker.fetch(
    new Request("https://ratings.example/v1/ratings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }),
    env,
  );
}

describe("POST /v1/ratings", () => {
  it("returns the version cacheVersion and serves a stored rating until its TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const kv = memoryKv();
    const env = envFor(kv, 4);
    const fetchImpl = stub(vi.fn(async () => page([node()], false, null)));

    const first = await post([item()], env);
    const body = parseRatingsResponse(await first.json());
    const version = parseVersionResponse(
      await (await worker.fetch(new Request("https://ratings.example/v1/version"), env)).json(),
    );

    expect(first.status).toBe(200);
    expect(version).toEqual({ cacheVersion: 4 });
    expect(body).toMatchObject({
      cacheVersion: 4,
      results: { row: { status: "rated", match: "exact", legacyId: 42, quality: 4.5, ttlSeconds: TTL_RATED_SECONDS } },
    });
    expect(kv.puts).toEqual([{ key: expect.stringMatching(/^r4:842:/), expirationTtl: TTL_RATED_SECONDS }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-07T23:59:59Z"));
    const during = parseRatingsResponse(await (await post([item()], env)).json());
    expect(during?.results.row).toMatchObject({ legacyId: 42, quality: 4.5 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-08T00:00:01Z"));
    await post([item()], env);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stores an unrated profile for 24 hours and does not store not_listed", async () => {
    const kv = memoryKv();
    const env = envFor(kv);
    const fetchImpl = stub(
      vi.fn(async () => emptyPage(false, null)).mockResolvedValueOnce(
        page([node({ numRatings: 0, avgRating: null })], false, null),
      ),
    );

    const unrated = parseRatingsResponse(await (await post([item({ key: "shell" })], env)).json());
    expect(unrated?.results.shell).toMatchObject({ status: "unrated", quality: null, ttlSeconds: TTL_SHORT_SECONDS });
    expect(kv.puts.map((put) => put.expirationTtl)).toEqual([TTL_SHORT_SECONDS]);

    const missed = parseRatingsResponse(
      await (await post([item({ key: "miss", name: "Robert Lee" })], env)).json(),
    );
    expect(missed?.results.miss).toMatchObject({ status: "not_listed" });
    expect(kv.puts).toHaveLength(1);

    const again = parseRatingsResponse(await (await post([item({ key: "miss", name: "Robert Lee" })], env)).json());
    expect(again?.results.miss).toMatchObject({ status: "not_listed" });
    expect(kv.puts).toHaveLength(1);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(2);
  });

  it("does not query or store placeholders and names that do not parse", async () => {
    const kv = memoryKv();
    const fetchImpl = stub(vi.fn(async () => page([node()], false, null)));

    const response = await post(
      [
        item({ key: "tba", name: "TBA" }),
        item({ key: "empty", name: "" }),
        item({ key: "staff", name: "Staff" }),
        item({ key: "dashes", name: "---" }),
        item({ key: "single", name: "Madonna" }),
        item({ key: "ann", name: "Ann Smith" }),
      ],
      envFor(kv),
    );
    const body = parseRatingsResponse(await response.json());

    expect(response.status).toBe(200);
    expect(Object.keys(body?.results ?? {})).toEqual(["ann"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(kv.puts.map((put) => put.key)).toHaveLength(1);
  });

  it("does not return an Accounting record for the History key", async () => {
    const joan = parseInstructor("Joan E. DeBello");
    if (joan === null) {
      throw new Error("unparsed");
    }
    const accountingKey = localCacheKey(1, " Queens Campus", "ACCOUNTING - TOBIN", joan);
    const historyKey = localCacheKey(1, " Queens Campus", "HISTORY", joan);
    const kv = memoryKv();
    const fetchImpl = stub(
      vi.fn(async () => emptyPage(false, null)).mockResolvedValueOnce(
        page([
          node({ firstName: "Joan", lastName: "DeBello", legacyId: 9, department: "Accounting" }),
        ], false, null),
      ),
    );

    const accounting = parseRatingsResponse(
      await (
        await post([item({ key: "acct", name: "Joan E. DeBello", subject: "ACCOUNTING - TOBIN" })], envFor(kv))
      ).json(),
    );
    const history = parseRatingsResponse(
      await (await post([item({ key: "hist", name: "Joan E. DeBello", subject: "HISTORY" })], envFor(kv))).json(),
    );

    expect(accountingKey).not.toBe(historyKey);
    expect(kv.puts.map((put) => put.key)).toEqual([accountingKey]);
    expect(accounting?.results.acct).toMatchObject({ legacyId: 9, quality: 4.5 });
    expect(history?.results.hist).toMatchObject({ status: "not_listed" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects an oversized batch before any upstream call", async () => {
    const fetchImpl = stub(vi.fn(async () => page([node()], false, null)));
    const env = envFor(memoryKv());
    const cases = [
      [" Queens Campus", 7],
      ["Manhattan Campus", 5],
      ["Online Learning", 4],
      [null, 4],
      ["Staten Island", 5],
    ] as const;

    for (const [campus, count] of cases) {
      const items = Array.from({ length: count }, (_, index) => item({ key: `k${index}`, campus }));
      const response = await post(items, env);
      expect(response.status, `${campus} ${count}`).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches school 3991 on an Online Learning miss and stops at 48 upstream calls", async () => {
    const kv = memoryKv();
    const online = stub(vi.fn(async () => emptyPage(false, null)));
    const missed = parseRatingsResponse(
      await (await post([item({ campus: "Online Learning", name: "Ann Smith" })], envFor(kv))).json(),
    );
    expect(missed?.results.row).toMatchObject({ status: "not_listed" });
    expect(callsOf(online).map((call) => call.variables.query.schoolID)).toEqual([
      schoolGraphqlId(SCHOOL_IDS.queens),
      schoolGraphqlId(SCHOOL_IDS.statenIsland),
      schoolGraphqlId(SCHOOL_IDS.manhattan),
      schoolGraphqlId(SCHOOL_IDS.generic),
    ]);
    expect(kv.puts).toEqual([]);

    resetSurnameIsolate();
    const names = [
      "Ada Van Nguyen",
      "Bea De La Cruz",
      "Cia De Los Reyes",
      "Dee Van Der Berg",
      "Eve Di Matteo",
      "Fae Von Trapp",
    ];
    const worst = stub(vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables: { cursor: string; query: { text: string } } };
      const finalToken = !body.variables.query.text.includes(" ");
      if (!finalToken) {
        return body.variables.cursor === "" ? emptyPage(true, "p2") : emptyPage(false, null);
      }
      return body.variables.cursor === "" ? emptyPage(true, "f2") : emptyPage(true, "f3");
    }));
    const response = await post(
      names.map((name, index) => item({ key: `w${index}`, name })),
      envFor(kv),
    );
    expect(response.status).toBe(200);
    expect(worst).toHaveBeenCalledTimes(48);
    expect(kv.puts).toEqual([]);
  });

  it("stops after a unique exact hit and turns a later truncated school into unavailable", async () => {
    const kv = memoryKv();
    const exact = stub(vi.fn(async () => page([node()], false, null)));
    const hit = parseRatingsResponse(await (await post([item()], envFor(kv))).json());
    expect(hit?.results.row).toMatchObject({ match: "exact", legacyId: 42 });
    expect(callsOf(exact).map((call) => call.variables.query.schoolID)).toEqual([
      schoolGraphqlId(SCHOOL_IDS.queens),
    ]);

    resetSurnameIsolate();
    const truncated = stub(
      vi
        .fn()
        .mockResolvedValueOnce(emptyPage(false, null))
        .mockResolvedValueOnce(emptyPage(true, "more"))
        .mockResolvedValueOnce(emptyPage(true, "again")),
    );
    const missed = parseRatingsResponse(
      await (await post([item({ key: "gone", name: "Robert Lee" })], envFor(kv))).json(),
    );
    expect(missed?.results.gone).toEqual({ status: "unavailable" });
    expect(callsOf(truncated).map((call) => call.variables.query.schoolID)).toEqual([
      schoolGraphqlId(SCHOOL_IDS.queens),
      schoolGraphqlId(SCHOOL_IDS.generic),
      schoolGraphqlId(SCHOOL_IDS.generic),
    ]);
    expect(kv.puts.map((put) => put.key).some((key) => key.includes("lee"))).toBe(false);

    await post([item({ key: "gone", name: "Robert Lee" })], envFor(kv));
    expect(callsOf(truncated).map((call) => call.variables.query.schoolID)).toEqual([
      schoolGraphqlId(SCHOOL_IDS.queens),
      schoolGraphqlId(SCHOOL_IDS.generic),
      schoolGraphqlId(SCHOOL_IDS.generic),
      schoolGraphqlId(SCHOOL_IDS.queens),
    ]);

    resetSurnameIsolate();
    const kept = stub(
      vi
        .fn()
        .mockResolvedValueOnce(
          page([node({ department: "Computer Science", legacyId: 3 })], false, null),
        )
        .mockResolvedValueOnce(
          page([node({ department: "History", legacyId: 8, avgRating: null, numRatings: 4 })], true, "next"),
        )
        .mockResolvedValueOnce(emptyPage(true, "tail")),
    );
    const held = parseRatingsResponse(
      await (await post([item({ key: "keep", name: "Ann Smith", subject: "HISTORY" })], envFor(kv))).json(),
    );
    expect(held?.results.keep).toMatchObject({ status: "rated", match: "possible", legacyId: 3 });
    expect(kept).toHaveBeenCalledTimes(3);
  });

  it("keeps an Online Learning row possible until one person is unique across the four schools", async () => {
    const unique = stub(
      vi.fn(async () => emptyPage(false, null)).mockResolvedValueOnce(
        page([node({ school: { name: "Queens", legacyId: SCHOOL_IDS.queens } })], false, null),
      ),
    );
    const one = parseRatingsResponse(
      await (await post([item({ campus: "Online Learning" })], envFor(memoryKv()))).json(),
    );
    expect(unique).toHaveBeenCalledTimes(4);
    expect(one?.results.row).toMatchObject({ match: "exact", legacyId: 42 });

    resetSurnameIsolate();
    const both = stub(
      vi
        .fn(async () => emptyPage(false, null))
        .mockResolvedValueOnce(page([node({ legacyId: 1 })], false, null))
        .mockResolvedValueOnce(
          page([
            node({
              legacyId: 2,
              school: { name: "Staten Island", legacyId: SCHOOL_IDS.statenIsland },
            }),
          ], false, null),
        ),
    );
    const two = parseRatingsResponse(
      await (await post([item({ key: "two", campus: "Online Learning" })], envFor(memoryKv()))).json(),
    );
    expect(callsOf(both).map((call) => call.variables.query.schoolID)).toContain(
      schoolGraphqlId(SCHOOL_IDS.statenIsland),
    );
    expect(two?.results.two).toMatchObject({ match: "possible" });

    resetSurnameIsolate();
    const duplicate = stub(
      vi.fn(async () =>
        page([node({ legacyId: 7, school: { name: "Queens", legacyId: SCHOOL_IDS.queens } })], false, null),
      ),
    );
    const same = parseRatingsResponse(
      await (await post([item({ key: "same", campus: "Online Learning" })], envFor(memoryKv()))).json(),
    );
    expect(duplicate).toHaveBeenCalledTimes(4);
    expect(same?.results.same).toMatchObject({ match: "exact", legacyId: 7 });

    resetSurnameIsolate();
    const partial = stub(
      vi
        .fn(async () => emptyPage(false, null))
        .mockResolvedValueOnce(page([node()], false, null))
        .mockResolvedValueOnce(emptyPage(true, "more"))
        .mockResolvedValueOnce(emptyPage(true, "again")),
    );
    const unfinished = parseRatingsResponse(
      await (await post([item({ key: "open", campus: "Online Learning" })], envFor(memoryKv()))).json(),
    );
    expect(partial.mock.calls.length).toBeGreaterThan(2);
    expect(unfinished?.results.open).toMatchObject({ match: "possible", legacyId: 42 });
  });

  it("returns the score when the KV write fails, and leaves a 403 out of KV", async () => {
    const failing = memoryKv(true);
    const fetchImpl = stub(vi.fn(async () => page([node()], false, null)));
    const body = parseRatingsResponse(await (await post([item()], envFor(failing))).json());
    expect(body?.results.row).toMatchObject({ status: "rated", legacyId: 42 });
    expect(failing.puts).toEqual([]);

    resetSurnameIsolate();
    const kv = memoryKv();
    const forbidden = stub(vi.fn(async () => new Response("no", { status: 403 })));
    const blocked = parseRatingsResponse(await (await post([item({ key: "blocked" })], envFor(kv))).json());
    await post([item({ key: "blocked" })], envFor(kv));
    expect(blocked?.results.blocked).toEqual({ status: "unavailable" });
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(kv.puts).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
