import * as esbuild from "esbuild";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
};

await esbuild.build({
  ...shared,
  entryPoints: {
    popup: "extension/src/popup.ts",
    "content-script": "extension/src/content-script.ts",
  },
  outdir: "extension/dist",
});

await esbuild.build({
  ...shared,
  entryPoints: { "chip-hook": "e2e/chip-hook.ts" },
  outdir: "e2e/dist",
});
