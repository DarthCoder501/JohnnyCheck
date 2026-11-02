import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, ["extension/build.mjs"], {
  cwd: root,
  stdio: "inherit",
});
const release = join(root, "release");
rmSync(release, { recursive: true, force: true });
mkdirSync(release);
execFileSync(
  "zip",
  [
    "-r",
    "-X",
    join(release, "red-storm-prof-ratings.zip"),
    "manifest.json",
    "content.css",
    "popup.html",
    "popup.css",
    "dist",
    "icons",
  ],
  { cwd: join(root, "extension"), stdio: "inherit" },
);
