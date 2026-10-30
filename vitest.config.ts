import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

// Posts to the deployed worker. `npm test` skips it. Naming the file on the command includes it.
const liveFetch = process.argv.some((arg) =>
  arg.includes("extension/test/fetch.test.ts"),
);

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./worker/test/cloudflare-workers-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "shared/test/**/*.test.ts",
      "worker/test/**/*.test.ts",
      "extension/test/**/*.test.ts",
    ],
    exclude: liveFetch
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, "extension/test/fetch.test.ts"],
    environment: "node",
  },
});
