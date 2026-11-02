import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCampus } from "../../shared/src/campus";
import {
  CLIENT_ID_HEADER,
  MAX_UPSTREAM_FETCHES,
  SCHOOL_IDS,
} from "../../shared/src/contract";
import { parseInstructor } from "../../shared/src/names";
import worker, { type Env } from "../src/index";
import { resetSurnameIsolate, searchSurname } from "../src/rmp";

const TOKEN = "public-token";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const IP = "203.0.113.10";
const NAME = "Ann Smith";

afterEach(() => {
  resetSurnameIsolate();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function capture(): string[] {
  const lines: string[] = [];
  const push = (line?: unknown) => {
    lines.push(String(line));
  };
  vi.spyOn(console, "log").mockImplementation(push);
  vi.spyOn(console, "warn").mockImplementation(push);
  return lines;
}

function events(lines: readonly string[]): unknown[] {
  return lines.map((line) => JSON.parse(line) as unknown);
}

function env(kv: Env["RATINGS"]): Env {
  return {
    cacheVersion: 1,
    rmpToken: TOKEN,
    RATINGS: kv,
    RATE_LIMITS: { getByName: () => ({ check: async () => "ok" as const }) },
  };
}

function post(target: Env, body: BodyInit, client = CLIENT) {
  return worker.fetch(
    new Request("https://ratings.example/v1/ratings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": IP,
        [CLIENT_ID_HEADER]: client,
      },
      body,
    }),
    target,
  );
}

function quiet(lines: readonly string[]) {
  const text = lines.join("\n");
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(NAME);
  expect(text).not.toContain(IP);
  expect(text).not.toContain(CLIENT);
}

describe("worker log schemas", () => {
  it("logs a ratings line with a KV hit count and no free text", async () => {
    const lines = capture();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            data: {
              search: {
                teachers: {
                  edges: [
                    {
                      node: {
                        legacyId: 42,
                        firstName: "Ann",
                        lastName: "Smith",
                        department: "Computer Science",
                        numRatings: 28,
                        avgRating: 4.5,
                        avgDifficulty: 3.1,
                        wouldTakeAgainPercent: 80,
                        school: {
                          name: "St. John's University - Jamaica/Queens",
                          legacyId: SCHOOL_IDS.queens,
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const rows = new Map<string, string>();
    const response = await post(
      env({
        async get(key) {
          return rows.get(key) ?? null;
        },
        async put(key, value) {
          rows.set(key, value);
        },
      }),
      JSON.stringify({
        items: [
          {
            key: "row",
            name: NAME,
            campus: "Queens Campus",
            subject: "Computer Science",
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const logged = events(lines);
    expect(logged).toContainEqual({
      event: "ratings",
      items: 1,
      upstream: expect.any(Number),
      kv: 0,
      skipped: 0,
      rated: 1,
      unrated: 0,
      not_listed: 0,
      unavailable: 0,
    });
    lines.length = 0;
    const again = await post(
      env({
        async get(key) {
          return rows.get(key) ?? null;
        },
        async put(key, value) {
          rows.set(key, value);
        },
      }),
      JSON.stringify({
        items: [
          {
            key: "row",
            name: NAME,
            campus: "Queens Campus",
            subject: "Computer Science",
          },
        ],
      }),
    );
    expect(again.status).toBe(200);
    expect(events(lines)).toContainEqual(
      expect.objectContaining({ event: "ratings", kv: 1, upstream: 0 }),
    );
    quiet(lines);
  });

  it("logs a fixed ratings_limit_failed line", async () => {
    const lines = capture();
    const response = await post(
      {
        ...env({
          get: async () => null,
          put: async () => undefined,
        }),
        RATE_LIMITS: {
          getByName: () => ({
            check: async () => {
              throw new Error(`token ${TOKEN} ip ${IP} ${CLIENT} ${NAME}`);
            },
          }),
        },
      },
      "{}",
    );
    expect(response.status).toBe(429);
    expect(events(lines)).toEqual([{ event: "ratings_limit_failed" }]);
    quiet(lines);
  });

  it("logs json and batch rejections", async () => {
    const lines = capture();
    const kv = { get: async () => null, put: async () => undefined };
    expect((await post(env(kv), "not-json")).status).toBe(400);
    const items = Array.from({ length: 7 }, (_, index) => ({
      key: `row-${index}`,
      name: NAME,
      campus: "Queens Campus",
      subject: "Computer Science",
    }));
    expect(
      (await post(env(kv), JSON.stringify({ items }))).status,
    ).toBe(400);
    expect(events(lines)).toEqual([
      { event: "ratings_rejected", reason: "json" },
      { event: "ratings_rejected", reason: "batch" },
    ]);
    quiet(lines);
  });

  it("logs a KV read throw and a bad stored value", async () => {
    const lines = capture();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const broken = await post(
      env({
        get: async () => {
          throw new Error("kv down");
        },
        put: async () => undefined,
      }),
      JSON.stringify({
        items: [
          {
            key: "row",
            name: NAME,
            campus: "Queens Campus",
            subject: "Computer Science",
          },
        ],
      }),
    );
    expect(broken.status).toBe(200);
    const bad = await post(
      env({
        get: async () => "not-json",
        put: async () => undefined,
      }),
      JSON.stringify({
        items: [
          {
            key: "row",
            name: NAME,
            campus: "Queens Campus",
            subject: "Computer Science",
          },
        ],
      }),
    );
    expect(bad.status).toBe(200);
    const names = events(lines).map(
      (entry) => (entry as { event: string }).event,
    );
    expect(names).toContain("kv_read_failed");
    expect(names).toContain("kv_bad_value");
    quiet(lines);
  });

  it("logs upstream failures without the query or the token", async () => {
    const lines = capture();
    const name = parseInstructor(NAME);
    if (name === null) throw new Error("unparsed");
    const input = {
      name,
      campus: resolveCampus("Queens Campus"),
      subject: "Computer Science",
      schoolId: SCHOOL_IDS.queens,
      token: TOKEN,
      nowMs: 0,
    };
    await searchSurname({
      ...input,
      fetch: async () => new Response("no", { status: 500 }),
    });
    resetSurnameIsolate();
    await searchSurname({
      ...input,
      fetch: async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    resetSurnameIsolate();
    await searchSurname({
      ...input,
      fetch: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    resetSurnameIsolate();
    await searchSurname({
      ...input,
      fetch: async () => {
        throw new Error(`Bearer ${TOKEN} ${NAME}`);
      },
    });
    resetSurnameIsolate();
    await searchSurname({
      ...input,
      budget: { used: MAX_UPSTREAM_FETCHES, max: MAX_UPSTREAM_FETCHES },
      fetch: async () => new Response("unused", { status: 200 }),
    });
    expect(events(lines)).toEqual([
      { event: "rmp_failed", reason: "status", status: 500 },
      { event: "rmp_failed", reason: "bad_json" },
      { event: "rmp_failed", reason: "no_data" },
      { event: "rmp_failed", reason: "throw" },
      { event: "rmp_failed", reason: "budget" },
    ]);
    quiet(lines);
  });
});
