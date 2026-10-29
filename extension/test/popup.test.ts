import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { ENABLED_DEFAULT, STORAGE_KEYS } from "../../shared/src/contract";
import { bindPopup, type SyncArea } from "../src/popup";

const POPUP_CSS = `html,
body {
  box-sizing: border-box;
  width: 320px;
  margin: 0;
  padding: 16px;
  background: #ffffff;
  color: #222222;
  font-family: Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
}
.rspr-popup-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: #151618;
  font-size: 14px;
  font-weight: 600;
}
.rspr-popup-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  cursor: pointer;
}
.rspr-popup-toggle input {
  accent-color: #222222;
  width: 44px;
  height: 24px;
}
.rspr-popup a {
  color: #000000;
  text-decoration: underline;
}
.rspr-mark {
  display: block;
  flex: none;
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  background: #148280;
  transform: rotate(45deg);
}
@media (forced-colors: active) {
  .rspr-mark {
    background: CanvasText;
    border: 1px solid CanvasText;
  }
}
`;

const PRIVACY_URL = "https://red-storm-prof-ratings.johnnycheck.workers.dev/privacy";
const DISCLAIMER = "Unofficial. Not affiliated with St. John's University, Rate My Professors, or Ellucian.";

function popupDocument(): Document {
  const window = new Window();
  window.document.write(readFileSync(new URL("../popup.html", import.meta.url), "utf8"));
  window.document.close();
  return window.document as unknown as Document;
}

function memorySync(initial: Record<string, unknown> = {}): SyncArea & { values: Record<string, unknown> } {
  const values = { ...initial };
  return {
    values,
    async get(key: string) {
      return values[key] === undefined ? {} : { [key]: values[key] };
    },
    async set(items: { [key: string]: unknown }) {
      Object.assign(values, items);
    },
  };
}

describe("extension popup", () => {
  it("copies the popup stylesheet, including the popup diamond and forced-colors rule", () => {
    const css = readFileSync(new URL("../popup.css", import.meta.url), "utf8");
    expect(css).toBe(POPUP_CSS);
    expect(css).not.toMatch(/box-shadow|linear-gradient|radial-gradient|#C12F33|#C64C44|#214A80/);
    const html = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
    expect(html).not.toContain("content.css");
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      action?: { default_popup?: string };
    };
    expect(manifest.action?.default_popup).toBe("popup.html");
  });

  it("shows only the title, the disclaimer, Show ratings, and the two underlined links", () => {
    const doc = popupDocument();
    const title = doc.querySelector(".rspr-popup-title");
    expect(title?.textContent).toContain("Red Storm Professor Ratings");
    expect(title?.querySelectorAll(".rspr-mark")).toHaveLength(1);
    expect(doc.body.textContent).toContain(DISCLAIMER);
    const toggle = doc.querySelector("label.rspr-popup-toggle");
    expect(toggle?.textContent).toContain("Show ratings");
    expect(toggle?.querySelector("input[type='checkbox']")).not.toBeNull();
    const links = [...doc.querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual(["Privacy", "How a name is matched"]);
    expect(links.every((link) => link.getAttribute("href") === PRIVACY_URL)).toBe(true);
    expect(doc.querySelectorAll("button, img, svg")).toHaveLength(0);
    const visible = [...doc.body.children].filter((node) => node.tagName !== "SCRIPT").map((node) => node.tagName);
    expect(visible).toEqual(["H1", "P", "LABEL", "P"]);
  });

  it("defaults Show ratings on, and writes a change to chrome.storage.sync under enabled", async () => {
    const doc = popupDocument();
    const box = doc.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(box?.checked).toBe(true);
    const area = memorySync();
    await bindPopup(doc, area);
    expect(box?.checked).toBe(ENABLED_DEFAULT);
    box!.checked = false;
    box!.dispatchEvent(new doc.defaultView!.Event("change"));
    await Promise.resolve();
    expect(area.values[STORAGE_KEYS.enabled]).toBe(false);

    const again = popupDocument();
    const stored = memorySync({ [STORAGE_KEYS.enabled]: false });
    await bindPopup(again, stored);
    expect(again.querySelector<HTMLInputElement>("input[type='checkbox']")?.checked).toBe(false);
  });

  it("keeps a click that happens before the first read returns", async () => {
    const doc = popupDocument();
    const box = doc.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    let resolveGet: (value: { [key: string]: unknown }) => void = () => {};
    const values: { [key: string]: unknown } = {};
    const area: SyncArea = {
      get: () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
      set: async (items) => {
        Object.assign(values, items);
      },
    };
    const pending = bindPopup(doc, area);
    box.checked = false;
    box.dispatchEvent(new doc.defaultView!.Event("change"));
    resolveGet({});
    await pending;
    expect(box.checked).toBe(false);
    expect(values[STORAGE_KEYS.enabled]).toBe(false);
  });
});
