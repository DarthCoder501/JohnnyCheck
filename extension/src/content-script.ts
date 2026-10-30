import {
  ENABLED_DEFAULT,
  STORAGE_AREAS,
  STORAGE_KEYS,
} from "../../shared/src/contract";
import {
  observeGrid,
  type RatingsQueryMessage,
  type RatingsQueryReply,
  type ViewHost,
} from "./grid";
import { pageDeliver, pageLocal, pageWake, type LocalRatings } from "./paint";

const CLASS_SEARCH_PORT = "8103";

export interface StorageChange {
  newValue?: unknown;
}

/** `chrome.storage.onChanged` plus the sync read. Content scripts can use both. */
export interface SyncListen {
  get(key: string): Promise<{ [key: string]: unknown }>;
  onChanged: {
    addListener(
      listener: (
        changes: { [key: string]: StorageChange },
        areaName: string,
      ) => void,
    ): void;
  };
}

export interface ContentSession {
  applyReply(reply: RatingsQueryReply): void;
}

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Node).nodeType === 1
  );
}

function viewHost(value: unknown): ViewHost | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("requestAnimationFrame" in value) || !("MutationObserver" in value))
    return null;
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
  wake?: () => void,
): ContentSession | null {
  if (port !== CLASS_SEARCH_PORT) return null;
  const parent = doc.getElementById("searchResultsParent");
  if (!isElement(parent)) return null;
  const host = view ?? viewHost(doc.defaultView);
  if (host === null) return null;

  let watch: {
    disconnect(): void;
    applyReply(reply: RatingsQueryReply): void;
  } | null = null;
  let readDone = false;
  let cacheVersion = 1;
  let showing = false;

  const clearChips = () => {
    for (const chip of parent.querySelectorAll(".rspr-chip")) chip.remove();
  };
  const stop = () => {
    watch?.disconnect();
    watch = null;
    clearChips();
  };
  const start = () => {
    if (watch !== null || !showing) return;
    watch = observeGrid(parent, cacheVersion, host, local, deliver, wake);
  };
  const applyEnabled = (on: boolean) => {
    showing = on;
    if (on) start();
    else stop();
  };
  const settle = (on: boolean) => {
    if (readDone) return;
    readDone = true;
    applyEnabled(on);
  };
  const useVersion = (next: number) => {
    if (next === cacheVersion) return;
    cacheVersion = next;
    const on = showing;
    stop();
    if (on) {
      showing = true;
      start();
    }
  };

  const listen = sync !== undefined;
  if (listen) {
    sync.onChanged.addListener((changes, areaName) => {
      if (areaName === STORAGE_AREAS.enabled) {
        const change = changes[STORAGE_KEYS.enabled];
        if (change === undefined) return;
        readDone = true;
        applyEnabled(enabledValue(change.newValue));
        return;
      }
      if (areaName !== STORAGE_AREAS.cacheVersion) return;
      const next = changes[STORAGE_KEYS.cacheVersion]?.newValue;
      if (typeof next === "number" && next >= 0) useVersion(next);
    });
  }
  if (sync === undefined && local === undefined) {
    showing = true;
    start();
  } else {
    const empty = (): { [key: string]: unknown } => ({});
    void Promise.all([
      sync?.get(STORAGE_KEYS.enabled) ?? Promise.resolve(empty()),
      local?.get([STORAGE_KEYS.cacheVersion]) ?? Promise.resolve(empty()),
    ]).then(
      ([enabledStored, versionStored]) => {
        const storedVersion = versionStored[STORAGE_KEYS.cacheVersion];
        if (typeof storedVersion === "number" && storedVersion >= 0)
          cacheVersion = storedVersion;
        settle(
          sync === undefined
            ? true
            : enabledValue(enabledStored[STORAGE_KEYS.enabled]),
        );
      },
      () => settle(sync === undefined ? true : ENABLED_DEFAULT),
    );
  }

  return {
    applyReply(reply) {
      watch?.applyReply(reply);
    },
  };
}

function pageSync(): SyncListen | undefined {
  if (typeof chrome === "undefined" || chrome.storage === undefined)
    return undefined;
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
      pageWake(),
    );
  }
}
