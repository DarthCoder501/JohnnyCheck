import { parseRatingsResponse } from "../../shared/src/contract";
import { handleRatings, type Env } from "./ratings";

/**
 * `cache.put` throws unless the key is GET, and the URL is the only key.
 * https://developers.cloudflare.com/workers/runtime-apis/cache/
 */
async function ratingsCacheKey(request: Request, cacheVersion: number): Promise<Request> {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("cacheVersion", String(cacheVersion));
  url.searchParams.set("body", await request.clone().text());
  return new Request(url, { method: "GET" });
}

function coloCache(): Cache | null {
  try {
    return caches.default;
  } catch {
    return null;
  }
}

function canStore(body: unknown): boolean {
  const parsed = parseRatingsResponse(body);
  if (!parsed) {
    return false;
  }
  // Upstream failures are `unavailable` for five minutes in this isolate, not in the colo cache.
  return Object.values(parsed.results).every((result) => result.status !== "unavailable");
}

export async function handleCachedRatings(request: Request, env: Env): Promise<Response> {
  const cache = coloCache();
  if (!cache) {
    return handleRatings(request, env);
  }
  const key = await ratingsCacheKey(request, env.cacheVersion);
  try {
    const hit = await cache.match(key);
    if (hit) {
      console.log(JSON.stringify({ event: "ratings_colo", hit: true, cacheVersion: env.cacheVersion }));
      return hit;
    }
  } catch {
    console.warn(JSON.stringify({ event: "colo_read_failed" }));
  }

  const response = await handleRatings(request, env);
  if (response.status !== 200) {
    return response;
  }
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!canStore(body)) {
    return response;
  }
  try {
    // workerd drops a 200 that has no Cache-Control, and put() still resolves. 7200s is the documented default for status 200.
    // https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/
    const stored = new Response(response.clone().body, {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=7200" },
    });
    await cache.put(key, stored);
  } catch {
    console.warn(JSON.stringify({ event: "colo_write_failed" }));
  }
  return response;
}
