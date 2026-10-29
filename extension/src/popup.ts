import { ENABLED_DEFAULT, STORAGE_KEYS } from "../../shared/src/contract";

export interface SyncArea {
  get(key: string): Promise<{ [key: string]: unknown }>;
  set(items: { [key: string]: unknown }): Promise<void>;
}

export async function readEnabled(area: SyncArea): Promise<boolean> {
  const stored = await area.get(STORAGE_KEYS.enabled);
  const value = stored[STORAGE_KEYS.enabled];
  return typeof value === "boolean" ? value : ENABLED_DEFAULT;
}

export function bindPopup(doc: Document, area: SyncArea): Promise<void> {
  const box = doc.querySelector<HTMLInputElement>("input[type='checkbox']");
  if (box === null) return Promise.resolve();
  let touched = false;
  box.addEventListener("change", () => {
    touched = true;
    void area.set({ [STORAGE_KEYS.enabled]: box.checked });
  });
  return readEnabled(area).then((on) => {
    if (!touched) box.checked = on;
  });
}

const page = globalThis.document;
if (page !== undefined && typeof chrome !== "undefined" && chrome.storage?.sync !== undefined) {
  void bindPopup(page, chrome.storage.sync);
}
