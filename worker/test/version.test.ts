import { describe, expect, it } from "vitest";
import { API_PATHS, parseVersionResponse } from "../../shared/src/contract";
import worker from "../src/index";

const env = { cacheVersion: 1 };

function call(path: string, method = "GET", cacheVersion = env.cacheVersion) {
  const request = new Request(`https://ratings.example${path}`, { method });
  return worker.fetch(request, { cacheVersion });
}

describe("GET /v1/version", () => {
  it("returns JSON that parseVersionResponse accepts for the configured cacheVersion", async () => {
    const response = await call(API_PATHS.version);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(parseVersionResponse(await response.json())).toEqual({ cacheVersion: 1 });
  });

  it("uses the cacheVersion from the env, not a hardcoded 1", async () => {
    const response = await call(`${API_PATHS.version}?t=1`, "GET", 4);
    expect(parseVersionResponse(await response.json())).toEqual({ cacheVersion: 4 });
  });

  it("returns 404 for every other path and method", async () => {
    const misses = await Promise.all([
      call("/"),
      call("/v1/ratings"),
      call("/v1/version/"),
      call(API_PATHS.version, "POST"),
      call("/privacy"),
    ]);
    expect(misses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  });
});
