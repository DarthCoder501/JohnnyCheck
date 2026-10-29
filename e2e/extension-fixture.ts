import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();

async function stageExtension(): Promise<string> {
  const distJs = path.join(root, "extension/dist/popup.js");
  await readFile(distJs);
  const stage = await mkdtemp(path.join(tmpdir(), "rspr-ext-"));
  await mkdir(path.join(stage, "dist"));
  await cp(path.join(root, "extension/dist"), path.join(stage, "dist"), { recursive: true });
  await cp(path.join(root, "extension/popup.html"), path.join(stage, "popup.html"));
  await cp(path.join(root, "extension/popup.css"), path.join(stage, "popup.css"));
  await cp(path.join(root, "extension/content.css"), path.join(stage, "content.css"));
  const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8")) as {
    background?: { service_worker: string };
  };
  manifest.background = { service_worker: "sw.js" };
  await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(stage, "sw.js"), "chrome.runtime.onInstalled.addListener(() => {});\n");
  return stage;
}

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const extensionDir = await stageExtension();
    const profile = await mkdtemp(path.join(tmpdir(), "rspr-profile-"));
    // Playwright's Chromium still accepts --load-extension. Installed Chrome and Edge ignore it.
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    try {
      await use(context);
    } finally {
      await context.close();
      await rm(extensionDir, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
    }
  },
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },
});

export const expect = test.expect;
