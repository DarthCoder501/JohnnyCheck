import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { runContentScript } from "../src/content-script";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[] }[];
};

const BANNER = "https://reg-prod.stjohns.elluciancloud.com/StudentRegistrationSsb/*";
const WORKER = "https://red-storm-prof-ratings.johnnycheck.workers.dev/*";

function page(port: string, html: string) {
  const window = new Window({
    url: `https://reg-prod.stjohns.elluciancloud.com:${port}/StudentRegistrationSsb/ssb/classSearch/classSearch`,
  });
  window.document.body.innerHTML = html;
  return window.document;
}

function paint(port: string, html: string) {
  const doc = page(port, html);
  const before = doc.body.innerHTML;
  runContentScript(doc, port);
  expect(doc.body.innerHTML).toBe(before);
  expect(doc.querySelectorAll(".rspr-chip")).toHaveLength(0);
}

describe("extension scaffold", () => {
  it("declares storage and the two hosts, with no port and no broad permissions", () => {
    const text = readFileSync(new URL("../manifest.json", import.meta.url), "utf8");
    expect(text).not.toContain(":8103");
    expect(text).not.toContain("<all_urls>");
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.host_permissions).toEqual([BANNER, WORKER]);
    expect(manifest.content_scripts[0]?.matches).toEqual([BANNER]);
    const declared = JSON.stringify(manifest);
    expect(declared).not.toContain("tabs");
    expect(declared).not.toContain("cookies");
    expect(declared).not.toContain("webRequest");
  });

  it("returns without writing when the port is not 8103 or the results parent is missing", () => {
    paint("443", `<div id="searchResultsParent"></div>`);
    paint("8103", "");
    paint("8103", `<div id="other"></div>`);
  });

  it("does not add a chip when class search only has #table1", () => {
    paint("8103", `<div id="searchResultsParent"><table id="table1"></table></div>`);
  });

  it("ships no Rate My Professors token", () => {
    const source = [
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
      readFileSync(new URL("../src/content-script.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).not.toMatch(/rmpToken|Bearer /);
  });
});
