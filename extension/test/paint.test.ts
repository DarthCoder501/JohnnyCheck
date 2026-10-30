import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  TTL_SHORT_SECONDS,
  notListedResult,
  unavailableResult,
  type RatedResult,
} from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { parseInstructor } from "../../shared/src/names";
import { runContentScript } from "../src/content-script";
import { type RatingsQueryMessage } from "../src/grid";
import { type LocalRatings } from "../src/paint";

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
    ttlSeconds: TTL_SHORT_SECONDS,
  };
}

function instructorHtml(name: string): string {
  return `<a class="email instructor-contact-link" href="mailto:secret@example.edu">${name}</a> (Primary)<br>`;
}

function grid(name: string, subject: string): string {
  return `<ssb-class-search-results><div class="class-search-results-grid"><table class="grid" role="grid"><thead><tr><th data-property="instructor">Instructor</th><th data-property="campus">Campus</th><th data-property="subjectDescription">Subject Description</th></tr></thead><tbody><tr role="row"><td data-property="instructor">${instructorHtml(name)}</td><td data-property="campus"> Queens Campus</td><td data-property="subjectDescription">${subject}</td></tr></tbody></table></div></ssb-class-search-results>`;
}

function mount(name: string, subject: string): Window {
  const window = new Window({
    url: "https://reg-prod.stjohns.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  });
  const style = window.document.createElement("style");
  style.textContent = readFileSync(new URL("../content.css", import.meta.url), "utf8");
  window.document.head.append(style);
  window.document.body.innerHTML = `<div id="searchResultsParent">${grid(name, subject)}</div>`;
  return window;
}

function keyFor(name: string, subject: string): string {
  const parsed = parseInstructor(name);
  if (parsed === null) throw new Error("name did not parse");
  return localCacheKey(1, " Queens Campus", subject, parsed);
}

interface MemoryLocal extends LocalRatings {
  values: { [key: string]: unknown };
  sets: { [key: string]: unknown }[];
}

function memoryLocal(initial: { [key: string]: unknown } = {}): MemoryLocal {
  const values = { ...initial };
  const sets: { [key: string]: unknown }[] = [];
  return {
    values,
    sets,
    get: (keys) => {
      const stored: { [key: string]: unknown } = {};
      for (const key of keys) {
        if (key in values) stored[key] = values[key];
      }
      return Promise.resolve(stored);
    },
    set: (items) => {
      Object.assign(values, items);
      sets.push(items);
      return Promise.resolve();
    },
  };
}

function chip(window: Window) {
  const found = window.document.querySelector(".rspr-chip");
  if (found === null) throw new Error("chip missing");
  return found;
}

async function shown(
  window: Window,
  local: LocalRatings,
  deliver: (message: RatingsQueryMessage) => void,
) {
  const session = runContentScript(window.document, "8103", undefined, undefined, local, deliver);
  if (session === null) throw new Error("content script did not start");
  await window.happyDOM.waitUntilComplete();
  return session;
}

describe("extension paint", () => {
  it("paints a local hit on one insert and does not message the service worker", async () => {
    const source = [
      readFileSync(new URL("../src/paint.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/content-script.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/grid.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).not.toMatch(/fetch\(/);

    const key = keyFor("John Smith", "HISTORY");
    const local = memoryLocal({
      [key]: { result: rated(), expiresAt: Date.now() + 60_000 },
    });
    const messages: RatingsQueryMessage[] = [];
    const texts: string[] = [];
    const window = mount("John Smith", "HISTORY");
    const parent = window.document.getElementById("searchResultsParent");
    if (parent === null) throw new Error("parent missing");
    const observer = new window.MutationObserver(() => {
      const painted = parent.querySelector(".rspr-chip");
      if (painted !== null) texts.push(painted.textContent ?? "");
    });
    observer.observe(parent, { childList: true, subtree: true });
    await shown(window, local, (message) => messages.push(message));

    expect(messages).toEqual([]);
    expect(texts.some((text) => text.includes("4.5"))).toBe(true);
    expect(texts.some((text) => text === "")).toBe(false);
    const painted = chip(window);
    expect(painted.querySelector(".rspr-mark")).not.toBeNull();
    expect(painted.textContent).toContain("4.5");
    expect(painted.textContent).toContain("28");
  });

  it("paints the diamond first on a miss, then the text, without a second height change", async () => {
    const local = memoryLocal();
    const messages: RatingsQueryMessage[] = [];
    const window = mount("John Smith", "HISTORY");
    const session = await shown(window, local, (message) => messages.push(message));

    const loading = chip(window);
    expect(loading.querySelector(".rspr-mark")).not.toBeNull();
    expect(loading.textContent).toBe("");
    const style = window.getComputedStyle(loading);
    expect(style.minHeight).toBe("24px");
    const before = style.height;
    expect(messages).toHaveLength(1);
    const key = messages[0]?.items[0]?.key;
    if (key === undefined) throw new Error("miss was not requested");

    session.applyReply({ cacheVersion: 1, results: { [key]: rated() } });

    const filled = chip(window);
    expect(window.document.querySelectorAll(".rspr-chip")).toHaveLength(1);
    expect(filled.querySelector(".rspr-mark")).not.toBeNull();
    expect(filled.textContent).toContain("4.5");
    expect(window.getComputedStyle(filled).height).toBe(before);
    expect(window.getComputedStyle(filled).minHeight).toBe("24px");
  });

  it("does not paint an Accounting entry on a History row, and ignores a detached cell", async () => {
    const name = "John Smith";
    const history = keyFor(name, "HISTORY");
    const accounting = keyFor(name, "ACCOUNTING");
    expect(history).not.toBe(accounting);
    const local = memoryLocal({
      [accounting]: { result: rated(), expiresAt: Date.now() + 60_000 },
    });
    const messages: RatingsQueryMessage[] = [];
    const window = mount(name, "HISTORY");
    const cell = window.document.querySelector("td[data-property='instructor']");
    if (cell === null) throw new Error("cell missing");
    const session = await shown(window, local, (message) => messages.push(message));

    expect(chip(window).textContent).toBe("");
    expect(messages.flatMap((message) => message.items.map((item) => item.key))).toEqual([history]);

    cell.remove();
    session.applyReply({ cacheVersion: 1, results: { [history]: rated() } });
    expect(cell.textContent).not.toContain("4.5");
    expect(window.document.body.textContent).not.toContain("4.5");
  });

  it("keeps not_listed for 24 hours and does not store unavailable", async () => {
    const key = keyFor("John Smith", "HISTORY");
    const local = memoryLocal();
    const messages: RatingsQueryMessage[] = [];
    const window = mount("John Smith", "HISTORY");
    const session = await shown(window, local, (message) => messages.push(message));
    const before = Date.now();
    session.applyReply({ cacheVersion: 1, results: { [key]: notListedResult() } });
    const after = Date.now();

    expect(chip(window).textContent).toContain("not listed");
    expect(local.sets).toHaveLength(1);
    const stored = local.values[key] as { expiresAt: number };
    expect(stored.expiresAt).toBeGreaterThanOrEqual(before + TTL_SHORT_SECONDS * 1000);
    expect(stored.expiresAt).toBeLessThanOrEqual(after + TTL_SHORT_SECONDS * 1000);

    const parent = window.document.getElementById("searchResultsParent");
    if (parent === null) throw new Error("parent missing");
    parent.innerHTML = grid("John Smith", "HISTORY");
    await window.happyDOM.waitUntilComplete();
    expect(chip(window).textContent).toContain("not listed");
    expect(messages).toHaveLength(1);

    const again = memoryLocal();
    const second = mount("John Smith", "HISTORY");
    const missed = await shown(second, again, () => undefined);
    missed.applyReply({ cacheVersion: 1, results: { [key]: unavailableResult() } });
    expect(chip(second).textContent).toContain("ratings unavailable");
    expect(again.sets).toEqual([]);

    const expired = memoryLocal({
      [key]: { result: notListedResult(), expiresAt: Date.now() - 1 },
    });
    const expiredMessages: RatingsQueryMessage[] = [];
    const cold = mount("John Smith", "HISTORY");
    await shown(cold, expired, (message) => expiredMessages.push(message));
    expect(chip(cold).textContent).toBe("");
    expect(expiredMessages).toHaveLength(1);
  });
});
