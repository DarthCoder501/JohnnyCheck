import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./worker/test/cloudflare-workers-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: [
      "shared/test/**/*.test.ts",
      "worker/test/**/*.test.ts",
      "extension/test/**/*.test.ts",
    ],
    environment: "node",
  },
});
