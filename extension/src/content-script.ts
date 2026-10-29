import { observeGrid, type ViewHost } from "./grid";

const CLASS_SEARCH_PORT = "8103";
// shortcut: cacheVersion stays 1 until extension-version reads storage
const CACHE_VERSION = 1;

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as Node).nodeType === 1;
}

function viewHost(value: unknown): ViewHost | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("requestAnimationFrame" in value) || !("MutationObserver" in value)) return null;
  return value as ViewHost;
}

export function runContentScript(
  doc: { getElementById(id: string): unknown; defaultView?: unknown },
  port: string,
  view?: ViewHost,
): void {
  if (port !== CLASS_SEARCH_PORT) return;
  const parent = doc.getElementById("searchResultsParent");
  if (!isElement(parent)) return;
  const host = view ?? viewHost(doc.defaultView);
  if (host === null) return;
  observeGrid(parent, CACHE_VERSION, host);
}

const page = globalThis.document;
if (page !== undefined) {
  const host = viewHost(globalThis);
  if (host !== null) runContentScript(page, globalThis.location.port, host);
}
