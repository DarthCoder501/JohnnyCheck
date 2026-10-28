import { API_PATHS } from "../../shared/src/contract";
import { handleLimitedRatings, RateLimits, type Env } from "./limits";
import { PRIVACY_PATH, privacyResponse } from "./privacy";

export type { Env };
export { RateLimits };

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === API_PATHS.ratings) {
      return handleLimitedRatings(request, env);
    }
    if (request.method === "GET" && url.pathname === API_PATHS.version) {
      return Response.json({ cacheVersion: env.cacheVersion });
    }
    if (request.method === "GET" && url.pathname === PRIVACY_PATH) {
      return privacyResponse();
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default worker;
