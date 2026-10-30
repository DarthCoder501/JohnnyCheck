import { ENABLED_DEFAULT, STORAGE_AREAS, STORAGE_KEYS } from "../../shared/src/contract";
import { observeGrid, type RatingsQueryMessage, type RatingsQueryReply, type ViewHost } from "./grid";
import { pageDeliver, pageLocal, type LocalRatings } from "./paint";

const CLASS_SEARCH_PORT = "8103";
// shortcut: cacheVersion stays 1 until extension-version reads storage
const CACHE_VERSION = 1;

export interface StorageChange {
  newValue?: unknown;
}

/** `chrome.storage.onChanged` plus the sync read. Content scripts can use both. */
export interface SyncListen {
  get(key: string): Promise<{ [key: string]: unknown }>;
  onChanged: {
    addListener(
      listener: (changes: { [key: string]: StorageChange }, areaName: string) => void,
    ): void;
  };
}

export interface ContentSession {
  applyReply(reply: RatingsQueryReply): void;
}

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as Node).nodeType === 1;
}

function viewHost(value: unknown): ViewHost | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("requestAnimationFrame" in value) || !("MutationObserver" in value)) return null;
  return value as ViewHost;
}

function enabledValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : ENABLED_DEFAULT;
}

export function runContentScript(
  doc: { getElementById(id: string): unknown; defaultView?: unknown },
  port: string,
  view?: ViewHost,
  sync?: SyncListen,
  local?: LocalRatings,
  deliver?: (message: RatingsQueryMessage) => void,
): ContentSession | null {
  if (port !== CLASS_SEARCH_PORT) return null;
  const parent = doc.getElementById("searchResultsParent");
  if (!isElement(parent)) return null;
  const host = view ?? viewHost(doc.defaultView);
  if (host === null) return null;

  let watch: { disconnect(): void; applyReply(reply: RatingsQueryReply): void } | null = null;
  let readDone = false;

  const clearChips = () => {
    for (const chip of parent.querySelectorAll(".rspr-chip")) chip.remove();
  };
  const start = () => {
    if (watch !== null) return;
    watch = observeGrid(parent, CACHE_VERSION, host, local, deliver);
  };
  const applyEnabled = (on: boolean) => {
    if (on) start();
    else {
      watch?.disconnect();
      watch = null;
      clearChips();
    }
  };
  const settle = (on: boolean) => {
    if (readDone) return;
    readDone = true;
    applyEnabled(on);
  };

  if (sync === undefined) start();
  else {
    sync.onChanged.addListener((changes, areaName) => {
      if (areaName !== STORAGE_AREAS.enabled) return;
      const change = changes[STORAGE_KEYS.enabled];
      if (change === undefined) return;
      readDone = true;
      applyEnabled(enabledValue(change.newValue));
    });
    void sync.get(STORAGE_KEYS.enabled).then(
      (stored) => settle(enabledValue(stored[STORAGE_KEYS.enabled])),
      () => settle(ENABLED_DEFAULT),
    );
  }

  return {
    applyReply(reply) {
      watch?.applyReply(reply);
    },
  };
}

function pageSync(): SyncListen | undefined {
  if (typeof chrome === "undefined" || chrome.storage === undefined) return undefined;
  const { sync, onChanged } = chrome.storage;
  return {
    get: (key) => sync.get(key),
    onChanged: {
      addListener(listener) {
        onChanged.addListener(listener);
      },
    },
  };
}

const page = globalThis.document;
if (page !== undefined) {
  const host = viewHost(globalThis);
  if (host !== null) {
    let session: ContentSession | null = null;
    session = runContentScript(
      page,
      globalThis.location.port,
      host,
      pageSync(),
      pageLocal(),
      pageDeliver((reply) => session?.applyReply(reply)),
    );
  }
}
