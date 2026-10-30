import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { STORAGE_KEYS, type RatedResult } from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { parseInstructor } from "../../shared/src/names";
import { runContentScript, type SyncListen } from "../src/content-script";

function rated(): RatedResult {
  return {
    status: "rated",
    match: "exact",
    reasons: ["initial"],
    legacyId: 4242,
    rmpName: "Geoffrey Dick",
    department: "Computer Science",
    schoolName: "Queens",
    numRatings: 28,
    quality: 4.5,
    difficulty: null,
    wouldTakeAgain: null,
    ttlSeconds: 60,
  };
}

function instructorHtml(name: string): string {
  return `<a class="email instructor-contact-link" href="mailto:secret@example.edu">${name}</a> (Primary)<br>`;
}

function grid(name: string): string {
  return `<ssb-class-search-results><div class="class-search-results-grid"><table class="grid" role="grid"><thead><tr><th data-property="instructor">Instructor</th></tr></thead><tbody><tr role="row"><td data-property="instructor">${instructorHtml(name)}</td></tr></tbody></table></div></ssb-class-search-results>`;
}

function mount(name: string): Window {
  const window = new Window({
    url: "https://reg-prod.stjohns.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  });
  window.document.body.innerHTML = `<div id="searchResultsParent">${grid(name)}</div>`;
  return window;
}

function chips(window: Window) {
  return [...window.document.querySelectorAll(".rspr-chip")];
}

interface MemorySync extends SyncListen {
  emit(areaName: string, enabled: boolean): void;
}

function memorySync(enabled: boolean | undefined): MemorySync {
  const values: { [key: string]: unknown } = {};
  if (enabled !== undefined) values[STORAGE_KEYS.enabled] = enabled;
  const listeners: Array<
    (changes: { [key: string]: { newValue?: unknown } }, areaName: string) => void
  > = [];
  return {
    get: (key) => Promise.resolve({ [key]: values[key] }),
    onChanged: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
    emit(areaName, next) {
      values[STORAGE_KEYS.enabled] = next;
      for (const listener of listeners) {
        listener({ [STORAGE_KEYS.enabled]: { newValue: next } }, areaName);
      }
    },
  };
}

async function painted(window: Window, area: MemorySync) {
  const session = runContentScript(window.document, "8103", undefined, area);
  if (session === null) throw new Error("content script did not start");
  await Promise.resolve();
  await window.happyDOM.waitUntilComplete();
  return session;
}

describe("extension toggle", () => {
  it("removes every chip and ignores later grid edits when ratings turn off", async () => {
    const window = mount("Geoffrey Norman Dick");
    const area = memorySync(true);
    await painted(window, area);
    expect(chips(window)).toHaveLength(1);

    area.emit("local", false);
    expect(chips(window)).toHaveLength(1);

    const cell = window.document.querySelector("td[data-property='instructor']");
    if (cell === null) throw new Error("cell missing");
    cell.setAttribute("data-pass", "edit");
    area.emit("sync", false);
    expect(chips(window)).toHaveLength(0);
    cell.innerHTML = instructorHtml("Joan E. DeBello");
    await window.happyDOM.waitUntilComplete();
    expect(chips(window)).toHaveLength(0);
    expect(window.document.querySelectorAll(".rspr-chip")).toHaveLength(0);
  });

  it("does not insert a chip when a ratings reply arrives after the observer stops", async () => {
    const window = mount("Geoffrey Norman Dick");
    const area = memorySync(true);
    const session = await painted(window, area);
    const parsed = parseInstructor("Geoffrey Norman Dick");
    if (parsed === null) throw new Error("name did not parse");
    const reply = {
      cacheVersion: 1,
      results: { [localCacheKey(1, null, null, parsed)]: rated() },
    };
    session.applyReply(reply);
    expect(chips(window)[0]?.textContent).toContain("4.5");

    area.emit("sync", false);
    expect(chips(window)).toHaveLength(0);
    session.applyReply(reply);
    expect(chips(window)).toHaveLength(0);
  });

  it("rescans the current grid on the next frame when ratings turn on", async () => {
    const window = mount("Geoffrey Norman Dick");
    const area = memorySync(false);
    const session = runContentScript(window.document, "8103", undefined, area);
    if (session === null) throw new Error("content script did not start");
    await Promise.resolve();
    await window.happyDOM.waitUntilComplete();
    expect(chips(window)).toHaveLength(0);

    area.emit("sync", true);
    expect(chips(window)).toHaveLength(0);
    await window.happyDOM.waitUntilComplete();
    expect(chips(window)).toHaveLength(1);
    expect(chips(window)[0]?.querySelector(".rspr-mark")).not.toBeNull();
  });
});
