import { afterEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_IDS, parseRatingsResponse, type RatingRequestItem } from "../../shared/src/contract";
import worker, { type Env } from "../src/index";
import { resetSurnameIsolate } from "../src/rmp";

const TOKEN = "public-token";

afterEach(() => {
  resetSurnameIsolate();
  vi.unstubAllGlobals();
});

function countingKv() {
  const rows = new Map<string, string>();
  let gets = 0;
  return {
    get gets() {
      return gets;
    },
    async get(key: string) {
      gets += 1;
      return rows.get(key) ?? null;
    },
    async put(key: string, value: string) {
      rows.set(key, value);
    },
  };
}

function fakeCache() {
  const rows = new Map<string, Response>();
  const puts: string[] = [];
  const cache = {
    async match(request: RequestInfo) {
      const hit = rows.get(request instanceof Request ? request.url : String(request));
      return hit?.clone();
    },
    async put(request: RequestInfo, response: Response) {
      const url = request instanceof Request ? request.url : String(request);
      puts.push(`${url} ${response.headers.get("cache-control")}`);
      rows.set(url, response.clone());
    },
  };
  vi.stubGlobal("caches", { default: cache });
  return { puts };
}

function envFor(kv: ReturnType<typeof countingKv>, cacheVersion = 1): Env {
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

function page(nodes: Record<string, unknown>[]) {
  return new Response(
    JSON.stringify({
      data: {
        search: {
          teachers: {
            edges: nodes.map((entry) => ({ node: entry })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function post(body: unknown, env: Env) {
  return worker.fetch(
    new Request("https://ratings.example/v1/ratings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe("POST /v1/ratings colo cache", () => {
  it("answers the second identical batch from the colo cache without a KV get", async () => {
    const kv = countingKv();
    const cache = fakeCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page([
          {
            legacyId: 42,
            firstName: "Ann",
            lastName: "Smith",
            department: "Computer Science",
            numRatings: 28,
            avgRating: 4.5,
            avgDifficulty: 3.1,
            wouldTakeAgainPercent: 80,
            school: { name: "St. John's University - Jamaica/Queens", legacyId: SCHOOL_IDS.queens },
          },
        ]),
      ),
    );
    const env = envFor(kv);

    const first = parseRatingsResponse(await (await post({ items: [item()] }, env)).json());
    const getsAfterFirst = kv.gets;
    const second = parseRatingsResponse(await (await post({ items: [item()] }, env)).json());

    expect(first?.results.row).toMatchObject({ status: "rated", legacyId: 42 });
    expect(second).toEqual(first);
    expect(kv.gets).toBe(getsAfterFirst);
    expect(cache.puts).toEqual([expect.stringContaining("max-age=7200")]);

    await post({ items: [item({ key: "other", name: "Robert Lee" })] }, env);
    expect(kv.gets).toBeGreaterThan(getsAfterFirst);
  });

  it("does not write a non-200 response to the colo cache", async () => {
    const kv = countingKv();
    const cache = fakeCache();
    const env = envFor(kv);

    const rejected = await post({ items: [] }, env);
    await post({ items: [] }, env);

    expect(rejected.status).toBe(400);
    expect(cache.puts).toEqual([]);
    expect(kv.gets).toBe(0);
  });

  it("misses the old colo entry when cacheVersion is newer and reads KV", async () => {
    const kv = countingKv();
    const cache = fakeCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page([
          {
            legacyId: 42,
            firstName: "Ann",
            lastName: "Smith",
            department: "Computer Science",
            numRatings: 28,
            avgRating: 4.5,
            avgDifficulty: 3.1,
            wouldTakeAgainPercent: 80,
            school: { name: "St. John's University - Jamaica/Queens", legacyId: SCHOOL_IDS.queens },
          },
        ]),
      ),
    );

    await post({ items: [item()] }, envFor(kv, 1));
    const getsAfterFirst = kv.gets;
    const bumped = parseRatingsResponse(await (await post({ items: [item()] }, envFor(kv, 2))).json());

    expect(bumped?.cacheVersion).toBe(2);
    expect(kv.gets).toBeGreaterThan(getsAfterFirst);
    expect(cache.puts).toHaveLength(2);
    expect(cache.puts.every((put) => put.includes("max-age=7200"))).toBe(true);
  });

  it("does not store a 200 whose result is unavailable", async () => {
    const kv = countingKv();
    const cache = fakeCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    const env = envFor(kv);

    const blocked = parseRatingsResponse(await (await post({ items: [item()] }, env)).json());
    const getsAfterFirst = kv.gets;
    await post({ items: [item()] }, env);

    expect(blocked?.results.row).toEqual({ status: "unavailable" });
    expect(cache.puts).toEqual([]);
    expect(kv.gets).toBeGreaterThan(getsAfterFirst);
  });
});
