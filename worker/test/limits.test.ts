import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ID_HEADER, SCHOOL_IDS } from "../../shared/src/contract";
import worker, { type Env } from "../src/index";
import { RateGate } from "../src/limits";
import { resetSurnameIsolate } from "../src/rmp";

const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";
const IP = "203.0.113.10";

afterEach(() => {
  resetSurnameIsolate();
  vi.unstubAllGlobals();
});

function binding(gate: RateGate): Env["RATE_LIMITS"] {
  return {
    getByName() {
      return {
        check: (ip, client) => Promise.resolve(gate.take(ip, client, 0)),
      };
    },
  };
}

function memoryKv() {
  const rows = new Map<string, string>();
  const puts: string[] = [];
  let gets = 0;
  return {
    puts,
    get gets() {
      return gets;
    },
    async get(key: string) {
      gets += 1;
      return rows.get(key) ?? null;
    },
    async put(key: string, value: string) {
      puts.push(value);
      rows.set(key, value);
    },
  };
}

function envFor(kv: ReturnType<typeof memoryKv>, gate = new RateGate()): Env {
  return {
    cacheVersion: 1,
    rmpToken: "public-token",
    RATINGS: kv,
    RATE_LIMITS: binding(gate),
  };
}

function teacherPage() {
  return new Response(
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
                  school: { name: "St. John's University - Jamaica/Queens", legacyId: SCHOOL_IDS.queens },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function post(env: Env, clientId?: string) {
  const headers = new Headers({ "content-type": "application/json", "CF-Connecting-IP": IP });
  if (clientId !== undefined) {
    headers.set(CLIENT_ID_HEADER, clientId);
  }
  return worker.fetch(
    new Request("https://ratings.example/v1/ratings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        items: [{ key: "row", name: "Ann Smith", campus: " Queens Campus", subject: "Computer Science" }],
      }),
    }),
    env,
  );
}

describe("rate gate", () => {
  it("allows 1,000 hits from one IP and blocks the next", () => {
    const gate = new RateGate();
    for (let index = 0; index < 1000; index += 1) {
      expect(gate.take(IP, crypto.randomUUID(), 0)).toBe("ok");
    }
    expect(gate.take(IP, crypto.randomUUID(), 0)).toBe("ip");
    expect(gate.take("203.0.113.11", crypto.randomUUID(), 0)).toBe("ok");
  });

  it("blocks the 31st request for one client and allows another client", () => {
    const gate = new RateGate();
    for (let index = 0; index < 30; index += 1) {
      expect(gate.take(IP, CLIENT_A, 0)).toBe("ok");
    }
    expect(gate.take(IP, CLIENT_A, 0)).toBe("client");
    expect(gate.take(IP, CLIENT_B, 0)).toBe("ok");
  });

  it("starts a new window after 60 seconds", () => {
    const gate = new RateGate();
    for (let index = 0; index < 30; index += 1) {
      gate.take(IP, CLIENT_A, 0);
    }
    expect(gate.take(IP, CLIENT_A, 0)).toBe("client");
    expect(gate.take(IP, CLIENT_A, 60_000)).toBe("ok");
  });
});

describe("POST /v1/ratings limits", () => {
  it("rejects a missing or non-UUID client id after counting the IP", async () => {
    const kv = memoryKv();
    const gate = new RateGate();
    const fetchImpl = vi.fn(async () => teacherPage());
    vi.stubGlobal("fetch", fetchImpl);
    const env = envFor(kv, gate);

    const missing = await post(env);
    const bad = await post(env, "not-a-uuid");

    expect(missing.status).toBe(400);
    expect(bad.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(kv.puts).toEqual([]);
    for (let index = 0; index < 998; index += 1) {
      expect(gate.take(IP, crypto.randomUUID(), 0)).toBe("ok");
    }
    expect(gate.take(IP, crypto.randomUUID(), 0)).toBe("ip");
  });

  it("returns an empty 429 on the 1,001st IP request and does not search", async () => {
    const kv = memoryKv();
    const gate = new RateGate();
    for (let index = 0; index < 1000; index += 1) {
      gate.take(IP, crypto.randomUUID(), 0);
    }
    const fetchImpl = vi.fn(async () => teacherPage());
    vi.stubGlobal("fetch", fetchImpl);

    const response = await post(envFor(kv, gate), CLIENT_A);

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(kv.puts).toEqual([]);
  });

  it("blocks request 31 for one client id and still allows a second id", async () => {
    const kv = memoryKv();
    const gate = new RateGate();
    for (let index = 0; index < 30; index += 1) {
      expect(gate.take(IP, CLIENT_A, 0)).toBe("ok");
    }
    const fetchImpl = vi.fn(async () => teacherPage());
    vi.stubGlobal("fetch", fetchImpl);
    const env = envFor(kv, gate);

    const blocked = await post(env, CLIENT_A);
    const allowed = await post(env, CLIENT_B.toUpperCase());

    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe("");
    expect(allowed.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(kv.puts[0]).not.toContain(CLIENT_A);
    expect(kv.puts[0]).not.toContain(CLIENT_B);
  });

  it("counts a colo-cache hit and does not search again", async () => {
    const kv = memoryKv();
    const rows = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        async match(request: RequestInfo) {
          const hit = rows.get(request instanceof Request ? request.url : String(request));
          return hit?.clone();
        },
        async put(request: RequestInfo, response: Response) {
          rows.set(request instanceof Request ? request.url : String(request), response.clone());
        },
      },
    });
    const fetchImpl = vi.fn(async () => teacherPage());
    vi.stubGlobal("fetch", fetchImpl);
    const env = envFor(kv);

    expect((await post(env, CLIENT_A)).status).toBe(200);
    const getsAfterFirst = kv.gets;
    expect((await post(env, CLIENT_A)).status).toBe(200);

    expect(kv.gets).toBe(getsAfterFirst);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
