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

interface PageDoc {
  getElementById(id: string): unknown;
  querySelector?(selector: string): unknown;
  body?: unknown;
  documentElement?: unknown;
  defaultView?: unknown;
}

function headerLabel(header: Element): string {
  return (header.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hasResultsHeader(table: Element, label: string): boolean {
  for (const header of table.querySelectorAll(":scope > thead th")) {
    if (header.getAttribute("data-property") === label) return true;
    if (headerLabel(header) === label) return true;
  }
  return false;
}

/** Largest ancestor that still contains only this results table, so a summary grid beside it stays out. */
function scopeForResultsTable(table: Element): Element {
  let node = table;
  while (node.parentElement !== null) {
    const grids = node.parentElement.querySelectorAll(
      'table.grid[role="grid"], table.search-results-table',
    );
    if (grids.length !== 1) return node;
    node = node.parentElement;
  }
  return node;
}

/** Browse has `#searchResultsParent` in the first HTML. Register for Classes may only have `#searchResults`, a grid with an Add column, or either of those after the script starts. */
function resultsScope(doc: PageDoc): Element | null {
  const parent = doc.getElementById("searchResultsParent");
  if (isElement(parent)) return parent;
  const anchor = resultsAnchor(doc);
  const search = doc.querySelector?.("#searchResults");
  if (
    isElement(search) &&
    search.querySelector('table.grid[role="grid"]') !== null
  ) {
    return search;
  }
  if (anchor === null) return null;
  for (const node of anchor.querySelectorAll('table.grid[role="grid"]')) {
    if (
      !hasResultsHeader(node, "instructor") ||
      !hasResultsHeader(node, "add")
    ) {
      continue;
    }
    return scopeForResultsTable(node);
  }
  for (const node of anchor.querySelectorAll("table.search-results-table")) {
    if (!hasResultsHeader(node, "instructor")) continue;
    return scopeForResultsTable(node);
  }
  return null;
}

function resultsAnchor(doc: PageDoc): Element | null {
  if (isElement(doc.body)) return doc.body;
  return isElement(doc.documentElement) ? doc.documentElement : null;
}

export function runContentScript(
  doc: PageDoc,
  port: string,
  view?: ViewHost,
  sync?: SyncListen,
  local?: LocalRatings,
  deliver?: (message: RatingsQueryMessage) => void,
  wake?: () => void,
): ContentSession | null {
  if (port !== CLASS_SEARCH_PORT) return null;
  const host = view ?? viewHost(doc.defaultView);
  if (host === null) return null;

  let scope: Element | null = null;
  let finder: { disconnect(): void } | null = null;
  let watch: {
    disconnect(): void;
    applyReply(reply: RatingsQueryReply): void;
  } | null = null;
  let readDone = false;
  let cacheVersion = 1;
  let showing = false;

  const clearChips = () => {
    if (scope === null) return;
    for (const chip of scope.querySelectorAll(".rspr-chip")) chip.remove();
    for (const cell of scope.querySelectorAll("td.rspr-cell"))
      cell.classList.remove("rspr-cell");
  };
  const stop = () => {
    finder?.disconnect();
    finder = null;
    watch?.disconnect();
    watch = null;
    clearChips();
  };
  const start = () => {
    if (watch !== null || !showing) return;
    const next = resultsScope(doc);
    if (next === null) {
      if (finder !== null) return;
      const anchor = resultsAnchor(doc);
      if (anchor === null) return;
      const observer = new host.MutationObserver(() => start());
      observer.observe(anchor, { childList: true, subtree: true });
      finder = observer;
      return;
    }
    finder?.disconnect();
    finder = null;
    scope = next;
    watch = observeGrid(scope, cacheVersion, host, local, deliver, wake);
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
