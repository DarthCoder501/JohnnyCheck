import { CLIENT_ID_HEADER } from "../../shared/src/contract";
import { DurableObject } from "cloudflare:workers";
import { handleCachedRatings } from "./edge";
import { type Env as RatingsEnv } from "./ratings";

const WINDOW_MS = 60_000;
const IP_LIMIT = 1000;
const CLIENT_LIMIT = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LimitDecision = "ok" | "ip" | "client" | "bad_client";

interface Bucket {
  start: number;
  count: number;
}

/**
 * One shared counter. The Workers rate-limit binding stays approximate across isolates,
 * so a 3.5s burst never reached 429. This object is single-threaded.
 * shortcut: memory resets if the object is evicted, SQLite if a cold start must keep the window.
 */
export class RateGate {
  private hits = new Map<string, Bucket>();

  take(ip: string, client: string | null, now = Date.now()): LimitDecision {
    this.prune(now);
    if (this.bump(`ip:${ip}`, IP_LIMIT, now)) {
      return "ip";
    }
    if (client === null) {
      return "bad_client";
    }
    if (this.bump(`client:${client}`, CLIENT_LIMIT, now)) {
      return "client";
    }
    return "ok";
  }

  private bump(key: string, limit: number, now: number): boolean {
    const current = this.hits.get(key);
    if (current === undefined || now - current.start >= WINDOW_MS) {
      this.hits.set(key, { start: now, count: 1 });
      return false;
    }
    current.count += 1;
    return current.count > limit;
  }

  private prune(now: number): void {
    if (this.hits.size < 500) {
      return;
    }
    for (const [key, bucket] of this.hits) {
      if (now - bucket.start >= WINDOW_MS) {
        this.hits.delete(key);
      }
    }
  }
}

export class RateLimits extends DurableObject<Env> {
  private gate = new RateGate();

  async check(ip: string, client: string | null): Promise<LimitDecision> {
    return this.gate.take(ip, client);
  }
}

export interface RateLimitBinding {
  getByName(name: string): {
    check(ip: string, client: string | null): Promise<LimitDecision>;
  };
}

export interface Env extends RatingsEnv {
  RATE_LIMITS: RateLimitBinding;
}

function clientKey(request: Request): string | null {
  const raw = request.headers.get(CLIENT_ID_HEADER);
  if (raw === null || !UUID.test(raw)) {
    return null;
  }
  return raw.toLowerCase();
}

export async function handleLimitedRatings(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  let decision: LimitDecision;
  try {
    decision = await env.RATE_LIMITS.getByName("ratings").check(ip, clientKey(request));
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "ratings_limit_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return new Response(null, { status: 429 });
  }
  if (decision === "ip" || decision === "client") {
    console.log(JSON.stringify({ event: "ratings_limited", ceiling: decision }));
    return new Response(null, { status: 429 });
  }
  if (decision === "bad_client") {
    console.log(JSON.stringify({ event: "ratings_rejected", reason: "client_id" }));
    return Response.json({ error: "X-Client-ID must be a UUID." }, { status: 400 });
  }
  return handleCachedRatings(request, env);
}
