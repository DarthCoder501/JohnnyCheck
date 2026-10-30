import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  STORAGE_KEYS,
  VERSION_CHECK_INTERVAL_MS,
  type RatedResult,
} from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { parseInstructor } from "../../shared/src/names";
import { runContentScript, type SyncListen } from "../src/content-script";
import {
  checkVersion,
  VERSION_ENDPOINT,
  type Area,
} from "../src/service-worker";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function rated(): RatedResult {
  return {
    status: "rated",
    match: "exact",
    reasons: ["initial"],
    legacyId: 4242,
    rmpName: "John Smith",
    department: "History",
    schoolName: "Queens",
    numRatings: 28,
    quality: 4.5,
    difficulty: null,
    wouldTakeAgain: null,
    ttlSeconds: 60,
  };
}

function memory(
  initial: { [key: string]: unknown } = {},
): Area & { values: { [key: string]: unknown } } {
  const values = { ...initial };
  return {
    values,
    get: (key) => {
      if (key === null) return Promise.resolve({ ...values });
      return Promise.resolve(key in values ? { [key]: values[key] } : {});
    },
    set: (items) => {
      Object.assign(values, items);
      return Promise.resolve();
    },
    remove: (keys) => {
      for (const key of keys) delete values[key];
      return Promise.resolve();
    },
  };
}

function mount(name: string): Window {
  const window = new Window({
    url: "https://reg-prod.stjohns.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  });
  window.document.body.innerHTML = `<div id="searchResultsParent"><ssb-class-search-results><div class="class-search-results-grid"><table class="grid" role="grid"><thead><tr><th data-property="instructor">Instructor</th><th data-property="subjectDescription">Subject</th></tr></thead><tbody><tr role="row"><td data-property="instructor"><a class="email instructor-contact-link" href="mailto:secret@example.edu">${name}</a> (Primary)<br></td><td data-property="subjectDescription">HISTORY</td></tr></tbody></table></div></ssb-class-search-results></div>`;
  return window;
}

describe("extension version", () => {
  it("uses a six hour interval", () => {
    expect(VERSION_CHECK_INTERVAL_MS).toBe(SIX_HOURS_MS);
  });

  it("asks the deployed worker once, then skips until the session timestamp is six hours old", async () => {
    const local = memory({
      [STORAGE_KEYS.cacheVersion]: 1,
      [STORAGE_KEYS.enabled]: true,
    });
    const session = memory();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(String(input));
      return fetch(input, init);
    };
    const now = Date.now();
    await checkVersion(local, session, fetchImpl, now);
    expect(calls).toEqual([VERSION_ENDPOINT]);
    expect(session.values[STORAGE_KEYS.versionCheckedAt]).toBe(now);
    expect(local.values[STORAGE_KEYS.enabled]).toBe(true);

    await checkVersion(local, session, fetchImpl, now + SIX_HOURS_MS - 1);
    expect(calls).toEqual([VERSION_ENDPOINT]);

    await checkVersion(local, session, fetchImpl, now + SIX_HOURS_MS);
    expect(calls).toEqual([VERSION_ENDPOINT, VERSION_ENDPOINT]);
  });

  it("drops rating keys for a newer cache version and keeps the toggle", async () => {
    const parsed = parseInstructor("John Smith");
    if (parsed === null) throw new Error("name did not parse");
    const stale = localCacheKey(1, "Queens", "HISTORY", parsed);
    const local = memory({
      [STORAGE_KEYS.cacheVersion]: 1,
      [STORAGE_KEYS.clientId]: "11111111-1111-1111-1111-111111111111",
      [STORAGE_KEYS.enabled]: true,
      [stale]: { result: rated(), expiresAt: Date.now() + 60_000 },
    });
    const session = memory();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ cacheVersion: 4 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await checkVersion(local, session, fetchImpl, 1_000);
    expect(local.values[stale]).toBeUndefined();
    expect(local.values[STORAGE_KEYS.enabled]).toBe(true);
    expect(local.values[STORAGE_KEYS.clientId]).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(local.values[STORAGE_KEYS.cacheVersion]).toBe(4);
    expect(session.values[STORAGE_KEYS.versionCheckedAt]).toBe(1_000);
  });

  it("paints a cached name before a version request finishes, then rescans when the version changes", async () => {
    const parsed = parseInstructor("John Smith");
    if (parsed === null) throw new Error("name did not parse");
    const key = localCacheKey(1, null, "HISTORY", parsed);
    const stored: { [key: string]: unknown } = {
      [STORAGE_KEYS.cacheVersion]: 1,
      [key]: { result: rated(), expiresAt: Date.now() + 60_000 },
    };
    const listeners: Array<
      (
        changes: { [key: string]: { newValue?: unknown } },
        areaName: string,
      ) => void
    > = [];
    const local = {
      get: (keys: readonly string[]) => {
        const found: { [key: string]: unknown } = {};
        for (const item of keys) if (item in stored) found[item] = stored[item];
        return Promise.resolve(found);
      },
      set: (items: { [key: string]: unknown }) => {
        Object.assign(stored, items);
        return Promise.resolve();
      },
    };
    const sync: SyncListen = {
      get: () => Promise.resolve({ [STORAGE_KEYS.enabled]: true }),
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    };
    let release: (response: Response) => void = () => undefined;
    const hanging = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let fetches = 0;
    const fetchImpl: typeof fetch = () => {
      fetches += 1;
      return hanging;
    };
    const area = memory();
    const session = memory();
    const window = mount("John Smith");
    const content = runContentScript(
      window.document,
      "8103",
      undefined,
      sync,
      local,
      undefined,
      () => {
        void checkVersion(area, session, fetchImpl, Date.now());
      },
    );
    if (content === null) throw new Error("content script did not start");
    await window.happyDOM.waitUntilComplete();
    const chip = window.document.querySelector(".rspr-chip");
    expect(chip?.textContent).toContain("4.5");
    expect(fetches).toBe(1);
    let settled = false;
    void hanging.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    listeners[0]?.({ [STORAGE_KEYS.cacheVersion]: { newValue: 2 } }, "local");
    await window.happyDOM.waitUntilComplete();
    const rescanned = window.document.querySelector(".rspr-chip");
    expect(rescanned?.textContent).toBe("");
    expect(localCacheKey(2, null, "HISTORY", parsed)).not.toBe(key);
    release(new Response(JSON.stringify({ cacheVersion: 1 }), { status: 200 }));
    await hanging;
  });
});
