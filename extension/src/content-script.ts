const CLASS_SEARCH_PORT = "8103";

export function runContentScript(doc: { getElementById(id: string): unknown }, port: string): void {
  if (port !== CLASS_SEARCH_PORT) return;
  if (doc.getElementById("searchResultsParent") === null) return;
  // shortcut: no paint until the real grid is read, extension-grid
}

const page = globalThis.document;
if (page !== undefined) runContentScript(page, globalThis.location.port);
