import { chunkRequestItems } from "../../shared/src/batch";
import {
  API_PATHS,
  CLIENT_ID_HEADER,
  STORAGE_KEYS,
  VERSION_CHECK_INTERVAL_MS,
  parseRatingsResponse,
  parseVersionResponse,
  unavailableResult,
  type RatingRequestItem,
  type RatingResult,
  type RatingsResponse,
} from "../../shared/src/contract";
import { isRatingKey } from "../../shared/src/keys";

const ORIGIN = "https://red-storm-prof-ratings.johnnycheck.workers.dev";
export const RATINGS_ENDPOINT = `${ORIGIN}${API_PATHS.ratings}`;
export const VERSION_ENDPOINT = `${ORIGIN}${API_PATHS.version}`;

const BLOCKED_UNTIL_KEY = "meta:ratingsBlockedUntil";
const BLOCK_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Stored {
  get(key: string): Promise<{ [key: string]: unknown }>;
  set(items: { [key: string]: unknown }): Promise<void>;
}

/** Local or session storage, including a full read and a key delete. */
export interface Area extends Stored {
  get(key: string | null): Promise<{ [key: string]: unknown }>;
  remove(keys: string[]): Promise<void>;
}

const inflight = new Map<string, Promise<RatingsResponse>>();

function wire(items: readonly RatingRequestItem[]): RatingRequestItem[] {
  return items.map((item) => ({
    key: item.key,
    name: item.name,
    campus: item.campus,
    subject: item.subject,
  }));
}

function unavailableFor(items: readonly RatingRequestItem[]): RatingsResponse {
  const results: Record<string, RatingResult> = {};
  for (const item of items) results[item.key] = unavailableResult();
  return { cacheVersion: 1, results };
}

async function readClientId(local: Stored): Promise<string> {
  try {
    const stored = await local.get(STORAGE_KEYS.clientId);
    const existing = stored[STORAGE_KEYS.clientId];
    if (typeof existing === "string" && UUID.test(existing)) return existing;
  } catch {
    // storage can throw; a new id still lets this page load
  }
  const created = crypto.randomUUID();
  try {
    await local.set({ [STORAGE_KEYS.clientId]: created });
  } catch {
    // shortcut: two tabs can each mint an id before the first write lands; the last write wins
  }
  return created;
}

async function coolingDown(session: Stored): Promise<boolean> {
  try {
    const stored = await session.get(BLOCKED_UNTIL_KEY);
    const until = stored[BLOCKED_UNTIL_KEY];
    return typeof until === "number" && Date.now() < until;
  } catch {
    return false;
  }
}

async function sendChunk(
  items: readonly RatingRequestItem[],
  clientId: string,
  session: Stored,
  fetchImpl: typeof fetch,
): Promise<RatingsResponse> {
  let response: Response;
  try {
    response = await fetchImpl(RATINGS_ENDPOINT, {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        [CLIENT_ID_HEADER]: clientId,
      },
      body: JSON.stringify({ items }),
    });
  } catch {
    console.warn(JSON.stringify({ event: "ratings_fetch", status: 0 }));
    return unavailableFor(items);
  }
  if (response.status === 429) {
    try {
      await session.set({ [BLOCKED_UNTIL_KEY]: Date.now() + BLOCK_MS });
    } catch {
      // this call was still rejected
    }
    console.warn(JSON.stringify({ event: "ratings_fetch", status: 429 }));
    return unavailableFor(items);
  }
  if (response.status !== 200) {
    console.warn(
      JSON.stringify({ event: "ratings_fetch", status: response.status }),
    );
    return unavailableFor(items);
  }
  try {
    const parsed = parseRatingsResponse(await response.json());
    if (parsed === null) return unavailableFor(items);
    for (const item of items) {
      if (parsed.results[item.key] === undefined)
        parsed.results[item.key] = unavailableResult();
    }
    return parsed;
  } catch {
    return unavailableFor(items);
  }
}

function postChunk(
  items: readonly RatingRequestItem[],
  clientId: string,
  session: Stored,
  fetchImpl: typeof fetch,
): Promise<RatingsResponse> {
  const key = JSON.stringify(items);
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = sendChunk(items, clientId, session, fetchImpl).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** One client id, chunked posts, and a shared in-flight batch. A 429 waits out the minute. */
export async function fetchRatings(
  items: readonly RatingRequestItem[],
  local: Stored,
  session: Stored,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<RatingsResponse> {
  const wired = wire(items);
  if (wired.length === 0) return { cacheVersion: 1, results: {} };
  const clientId = await readClientId(local);
  const results: Record<string, RatingResult> = {};
  let cacheVersion = 1;
  for (const chunk of chunkRequestItems(wired)) {
    if (await coolingDown(session)) {
      for (const item of chunk) results[item.key] = unavailableResult();
      continue;
    }
    const reply = await postChunk(chunk, clientId, session, fetchImpl);
    cacheVersion = reply.cacheVersion;
    Object.assign(results, reply.results);
  }
  return { cacheVersion, results };
}

let versionInflight: Promise<void> | null = null;

async function stamp(session: Area, nowMs: number): Promise<void> {
  try {
    await session.set({ [STORAGE_KEYS.versionCheckedAt]: nowMs });
  } catch {
    // the next grid scan can try again
  }
}

/** `GET /v1/version` at most once per interval. A newer cache version drops `r*` keys only. */
export function checkVersion(
  local: Area,
  session: Area,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<void> {
  if (versionInflight !== null) return versionInflight;
  const run = (async () => {
    try {
      const checked = await session.get(STORAGE_KEYS.versionCheckedAt);
      const at = checked[STORAGE_KEYS.versionCheckedAt];
      if (typeof at === "number" && nowMs - at < VERSION_CHECK_INTERVAL_MS) {
        console.log(JSON.stringify({ event: "version_check", skipped: true }));
        return;
      }
    } catch {
      return;
    }
    let response: Response;
    try {
      response = await fetchImpl(VERSION_ENDPOINT, {
        method: "GET",
        credentials: "omit",
      });
    } catch {
      console.warn(JSON.stringify({ event: "version_check", status: 0 }));
      return;
    }
    if (response.status !== 200) {
      await stamp(session, nowMs);
      console.warn(
        JSON.stringify({ event: "version_check", status: response.status }),
      );
      return;
    }
    let parsed: { cacheVersion: number } | null;
    try {
      parsed = parseVersionResponse(await response.json());
    } catch {
      await stamp(session, nowMs);
      return;
    }
    if (parsed === null) {
      await stamp(session, nowMs);
      return;
    }
    let flushed = false;
    try {
      const stored = await local.get(STORAGE_KEYS.cacheVersion);
      const current = stored[STORAGE_KEYS.cacheVersion];
      const localVersion = typeof current === "number" ? current : 1;
      flushed = parsed.cacheVersion > localVersion;
      if (flushed) {
        const all = await local.get(null);
        const stale = Object.keys(all).filter((key) => isRatingKey(key));
        if (stale.length > 0) await local.remove(stale);
        await local.set({ [STORAGE_KEYS.cacheVersion]: parsed.cacheVersion });
      }
      await stamp(session, nowMs);
    } catch {
      console.warn(
        JSON.stringify({ event: "version_check", status: "storage" }),
      );
      return;
    }
    console.log(
      JSON.stringify({
        event: "version_check",
        cacheVersion: parsed.cacheVersion,
        flushed,
      }),
    );
  })().finally(() => {
    if (versionInflight === run) versionInflight = null;
  });
  versionInflight = run;
  return run;
}

function isItem(value: unknown): value is RatingRequestItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as {
    key?: unknown;
    name?: unknown;
    campus?: unknown;
    subject?: unknown;
  };
  return (
    typeof item.key === "string" &&
    typeof item.name === "string" &&
    (typeof item.campus === "string" || item.campus === null) &&
    (typeof item.subject === "string" || item.subject === null)
  );
}

function itemsFrom(message: unknown): RatingRequestItem[] | null {
  if (typeof message !== "object" || message === null || !("items" in message))
    return null;
  const { items } = message;
  if (!Array.isArray(items) || !items.every(isItem)) return null;
  return items;
}

function storedArea(area: chrome.storage.StorageArea): Area {
  return {
    get: (key) => (key === null ? area.get(null) : area.get(key)),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
  };
}

function isVersionCheck(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "checkVersion" in message &&
    message.checkVersion === true
  );
}

function listen(): void {
  const local = chrome.storage?.local;
  const session = chrome.storage?.session;
  if (
    chrome.runtime?.onMessage === undefined ||
    local === undefined ||
    session === undefined
  )
    return;
  // Chrome drops this worker after 30 idle seconds, so the 429 minute lives in session storage.
  // shortcut: a fetch that takes longer than 30s is killed with the worker, upgrade if a cold batch exceeds that
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isVersionCheck(message)) {
      void checkVersion(
        storedArea(local),
        storedArea(session),
        globalThis.fetch,
        Date.now(),
      );
      return;
    }
    const items = itemsFrom(message);
    if (items === null) return;
    void fetchRatings(items, storedArea(local), storedArea(session)).then(
      (reply) => sendResponse(reply),
      () => sendResponse(unavailableFor(items)),
    );
    return true;
  });
}

if (typeof chrome !== "undefined") listen();
