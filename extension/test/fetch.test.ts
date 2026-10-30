import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  CLIENT_ID_HEADER,
  STORAGE_KEYS,
  isRatingResult,
} from "../../shared/src/contract";
import { scanGrid } from "../src/grid";
import {
  RATINGS_ENDPOINT,
  fetchRatings,
  type Stored,
} from "../src/service-worker";

const NAME = "Zzyzx Qalph Notapersonzz";
const STUDENT_ID = "800123456";
const EMAIL = "secret-student@stjohns.edu";
const COOKIE = "JSESSIONID=secret-cookie";
const BANNER_SEARCH = "searchResults/searchResults";

interface Call {
  url: string;
  body: string;
  headers: Headers;
  status: number;
  errorText: string;
}

function memory(
  initial: { [key: string]: unknown } = {},
): Stored & { values: { [key: string]: unknown } } {
  const values = { ...initial };
  return {
    values,
    get: (key) => Promise.resolve(key in values ? { [key]: values[key] } : {}),
    set: (items) => {
      Object.assign(values, items);
      return Promise.resolve();
    },
  };
}

function liveFetch(calls: Call[]): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      headers,
      status: response.status,
      errorText: response.status === 200 ? "" : await response.clone().text(),
    });
    return response;
  };
}

function row(
  key: string,
  campus: string | null,
): { key: string; name: string; campus: string | null; subject: string } {
  return { key, name: NAME, campus, subject: "Computer Science" };
}

function lengths(calls: readonly Call[]): number[] {
  return calls.map((call) => {
    const body = JSON.parse(call.body) as { items: unknown[] };
    return body.items.length;
  });
}

function assertPosts(calls: readonly Call[], clientId: string): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.url).toBe(RATINGS_ENDPOINT);
    expect(call.status, call.errorText).toBe(200);
    expect(call.headers.get(CLIENT_ID_HEADER)).toBe(clientId);
    expect(call.body).not.toContain(STUDENT_ID);
    expect(call.body).not.toContain(EMAIL);
    expect(call.body).not.toContain(COOKIE);
    const body = JSON.parse(call.body) as {
      items: { [key: string]: unknown }[];
    };
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        "campus",
        "key",
        "name",
        "subject",
      ]);
    }
  }
}

describe("extension fetch against the deployed worker", () => {
  it("chunks a Queens page and a hidden campus, and keeps student fields off the wire", async () => {
    const local = memory();
    const session = memory();
    const calls: Call[] = [];
    const fetchImpl = liveFetch(calls);
    const queens = Array.from({ length: 8 }, () =>
      [0, 1, 2, 3, 4, 5].map((index) => row(`q${index}`, " Queens Campus")),
    ).flat();
    queens.push(row("q0", " Queens Campus"), row("q1", " Queens Campus"));
    expect(queens).toHaveLength(50);

    const queensReply = await fetchRatings(queens, local, session, fetchImpl);
    expect(lengths(calls)).toEqual([6, 6, 6, 6, 6, 6, 6, 6, 2]);
    expect(queensReply.cacheVersion).toBe(1);
    for (const key of ["q0", "q1", "q2", "q3", "q4", "q5"]) {
      expect(
        isRatingResult(queensReply.results[key]),
        JSON.stringify(queensReply.results[key]),
      ).toBe(true);
    }

    const hiddenAt = calls.length;
    const hiddenReply = await fetchRatings(
      [0, 1, 2, 3].map((index) => row(`h${index}`, null)),
      local,
      session,
      fetchImpl,
    );
    expect(lengths(calls.slice(hiddenAt))).toEqual([3, 1]);
    expect(
      hiddenReply.results.h0 && isRatingResult(hiddenReply.results.h0),
    ).toBe(true);

    const manhattanAt = calls.length;
    await fetchRatings(
      [0, 1, 2, 3, 4].map((index) => row(`m${index}`, "Manhattan Campus")),
      local,
      session,
      fetchImpl,
    );
    expect(lengths(calls.slice(manhattanAt))).toEqual([4, 1]);

    const statenAt = calls.length;
    await fetchRatings(
      [0, 1, 2, 3, 4].map((index) => row(`s${index}`, "Staten Island")),
      local,
      session,
      fetchImpl,
    );
    expect(lengths(calls.slice(statenAt))).toEqual([4, 1]);

    const clientId = local.values[STORAGE_KEYS.clientId];
    expect(clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    assertPosts(calls, clientId as string);

    const window = new Window();
    window.document.body.innerHTML = `<div id="searchResultsParent"><ssb-class-search-results><div class="class-search-results-grid"><table class="grid" role="grid"><thead><tr><th data-property="courseReferenceNumber">CRN</th><th data-property="status">Status</th><th data-property="instructor">Instructor</th><th data-property="campus">Campus</th><th data-property="subjectDescription">Subject Description</th></tr></thead><tbody><tr role="row"><td data-property="courseReferenceNumber">${STUDENT_ID}</td><td data-property="status">${COOKIE}</td><td data-property="instructor"><a class="instructor-contact-link" href="mailto:${EMAIL}">${NAME}</a> (Primary)<br></td><td data-property="campus"> Queens Campus</td><td data-property="subjectDescription">Computer Science</td></tr></tbody></table></div></ssb-class-search-results></div>`;
    const parent = window.document.getElementById("searchResultsParent");
    if (parent === null) throw new Error("missing parent");
    const message = scanGrid(parent as unknown as ParentNode, 1);
    expect(JSON.stringify(message)).not.toContain(STUDENT_ID);
    expect(JSON.stringify(message)).not.toContain(EMAIL);
    expect(JSON.stringify(message)).not.toContain(COOKIE);
    const fixtureAt = calls.length;
    const fixtureReply = await fetchRatings(
      message.items,
      local,
      session,
      fetchImpl,
    );
    expect(calls.length - fixtureAt).toBe(1);
    expect(isRatingResult(Object.values(fixtureReply.results)[0])).toBe(true);
    assertPosts(calls.slice(fixtureAt), clientId as string);
  }, 180_000);

  it("shares one in-flight request across two callers", async () => {
    const local = memory();
    const session = memory();
    const calls: Call[] = [];
    const item = row("shared", " Queens Campus");
    const [first, second] = await Promise.all([
      fetchRatings([item], local, session, liveFetch(calls)),
      fetchRatings([item], local, session, liveFetch(calls)),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status, calls[0]?.errorText).toBe(200);
    expect(first).toEqual(second);
    expect(isRatingResult(first.results.shared)).toBe(true);
  }, 90_000);

  it("turns a live 429 into ratings unavailable and does not call again that minute", async () => {
    const clientId = crypto.randomUUID();
    const local = memory({ [STORAGE_KEYS.clientId]: clientId });
    const session = memory();
    const item = row("shared", " Queens Campus");
    const body = JSON.stringify({ items: [item] });
    const post = async () => {
      const response = await fetch(RATINGS_ENDPOINT, {
        method: "POST",
        credentials: "omit",
        headers: {
          "content-type": "application/json",
          [CLIENT_ID_HEADER]: clientId,
        },
        body,
      });
      const text = response.status === 200 ? "" : await response.text();
      expect(response.status, text).toBe(200);
    };
    const started = Date.now();
    await post();
    const elapsed = Date.now() - started;
    if (elapsed > 5_000) {
      const remain = 60_000 - elapsed + 500;
      if (remain > 0)
        await new Promise((resolve) => setTimeout(resolve, remain));
    }
    for (let index = elapsed > 5_000 ? 0 : 1; index < 30; index += 1)
      await post();

    const calls: Call[] = [];
    const blocked = await fetchRatings(
      [item],
      local,
      session,
      liveFetch(calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe(429);
    expect(blocked.cacheVersion).toBe(1);
    expect(blocked.results.shared).toEqual({ status: "unavailable" });
    expect(local.values[STORAGE_KEYS.clientId]).toBe(clientId);
    expect(JSON.stringify(blocked)).not.toContain(clientId);

    const until = session.values["meta:ratingsBlockedUntil"];
    expect(typeof until).toBe("number");
    expect((until as number) - Date.now()).toBeGreaterThan(50_000);

    calls.length = 0;
    const held = await fetchRatings([item], local, session, liveFetch(calls));
    expect(calls).toHaveLength(0);
    expect(held.results.shared).toEqual({ status: "unavailable" });

    await new Promise((resolve) =>
      setTimeout(resolve, (until as number) - Date.now() + 500),
    );
    const resumed = await fetchRatings(
      [item],
      local,
      session,
      liveFetch(calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status, calls[0]?.errorText).toBe(200);
    expect(isRatingResult(resumed.results.shared)).toBe(true);
  }, 240_000);

  it("keeps fetch and the Banner search URL out of the content script bundle", () => {
    execFileSync(process.execPath, ["extension/build.mjs"], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
    });
    const root = new URL("..", import.meta.url);
    for (const name of [
      "content-script.ts",
      "grid.ts",
      "paint.ts",
      "chip.ts",
      "popup.ts",
    ]) {
      expect(readFileSync(new URL(`src/${name}`, root), "utf8")).not.toMatch(
        /\bfetch\s*\(/,
      );
    }
    const content = readFileSync(
      new URL("dist/content-script.js", root),
      "utf8",
    );
    const worker = readFileSync(
      new URL("dist/service-worker.js", root),
      "utf8",
    );
    const popup = readFileSync(new URL("dist/popup.js", root), "utf8");
    expect(content).not.toContain(BANNER_SEARCH);
    expect(worker).not.toContain(BANNER_SEARCH);
    expect(popup).not.toContain(BANNER_SEARCH);
    expect(content).not.toMatch(/\bfetch\s*\(/);
    expect(worker).toContain("globalThis.fetch");
    const manifest = readFileSync(new URL("manifest.json", root), "utf8");
    expect(manifest).toContain('"service_worker": "dist/service-worker.js"');
    expect(manifest).not.toContain(BANNER_SEARCH);
  });
});
