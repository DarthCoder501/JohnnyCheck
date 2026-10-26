import { API_PATHS } from "../../shared/src/contract";

interface Env {
  cacheVersion: number;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== API_PATHS.version) {
      return new Response(null, { status: 404 });
    }
    return Response.json({ cacheVersion: env.cacheVersion });
  },
} satisfies ExportedHandler<Env>;

export default worker;
