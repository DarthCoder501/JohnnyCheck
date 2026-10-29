import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { parseRatingsRequest } from "../../shared/src/batch";
import { SCHOOL_IDS, type RatingsResponse } from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { parseInstructor } from "../../shared/src/names";
import { runContentScript } from "../src/content-script";
import { scanGrid, type RatingsQueryReply } from "../src/grid";

const SECRET_HREF = "mailto:secret@example.edu";
const SECRET_ID = "BANNER-SECRET";
const SECRET_TERM = "TERM-SECRET";

const MOVED = ["courseReferenceNumber", "status", "instructor", "campus", "subjectDescription"] as const;

const MOVED_LABELS = ["CRN", "Status", "Instructor", "Campus", "Subject Description"] as const;

function instructorHtml(name: string): string {
  return `<a class="email instructor-contact-link" aria-haspopup="true" data-banner-id="${SECRET_ID}" data-term="${SECRET_TERM}" href="${SECRET_HREF}">${name}</a> (Primary)<br>`;
}

function results(head: string, rows: string): string {
  return `<ssb-class-search-results><div class="class-search-results-grid"><table class="ui-widget grid resizable" role="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></ssb-class-search-results>`;
}

function propertyHead(): string {
  return MOVED.map(
    (property, index) =>
      `<th data-property="${property}" role="columnheader">${MOVED_LABELS[index]}<span class="col-resize-handle"></span></th>`,
  ).join("");
}

function propertyRow(cells: Record<(typeof MOVED)[number], string>): string {
  const tds = MOVED.map(
    (property) => `<td data-property="${property}" role="gridcell">${cells[property]}</td>`,
  ).join("");
  return `<tr role="row">${tds}</tr>`;
}

function textHead(): string {
  return MOVED_LABELS.map(
    (label) => `<th role="columnheader">${label}<span class="col-resize-handle"></span></th>`,
  ).join("");
}

function textRow(values: readonly string[]): string {
  return `<tr role="row">${values.map((value) => `<td role="gridcell">${value}</td>`).join("")}</tr>`;
}

function mount(html: string): Window {
  const window = new Window({
    url: "https://reg-prod.stjohns.elluciancloud.com:8103/StudentRegistrationSsb/ssb/classSearch/classSearch",
  });
  window.document.body.innerHTML = html;
  return window;
}

async function mutationsSettled(): Promise<void> {
  await Promise.resolve();
}

async function frameSettled(window: Window): Promise<void> {
  await window.happyDOM.waitUntilComplete();
}

function chips(window: Window) {
  return [...window.document.querySelectorAll(".rspr-chip")];
}

function messageFrom(window: Window) {
  const parent = window.document.getElementById("searchResultsParent");
  if (parent === null) throw new Error("parent missing");
  return scanGrid(parent as unknown as ParentNode, 1);
}

describe("extension grid", () => {
  it("paints the class-search grid only, and ignores #table1 and a summary table", async () => {
    const source = [
      readFileSync(new URL("../src/grid.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/content-script.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).not.toContain("searchResultsTable");
    expect(source).not.toContain("searchResultsHolder");
    expect(source).not.toContain("nth-child");
    expect(source).not.toMatch(/mailto:|data-banner-id|data-term/);
    expect(source).not.toMatch(/fetch\(|sendMessage|chrome\.runtime/);

    const geoffrey = propertyRow({
      courseReferenceNumber: "10946",
      status: "25 of 25 seats remain.",
      instructor: instructorHtml("Geoffrey Norman Dick"),
      campus: " Queens Campus",
      subjectDescription: "COMPUTER SCIENCE - CCPS",
    });
    const empty = propertyRow({
      courseReferenceNumber: "10947",
      status: "1 of 25 seats remain.",
      instructor: "",
      campus: " Queens Campus",
      subjectDescription: "COMPUTER SCIENCE - CCPS",
    });
    const tba = propertyRow({
      courseReferenceNumber: "10948",
      status: "FULL",
      instructor: "TBA",
      campus: " Queens Campus",
      subjectDescription: "COMPUTER SCIENCE - CCPS",
    });
    const grid = results(propertyHead(), geoffrey + empty + tba);
    const summary = `<table class="registration-summary" role="grid"><thead><tr><th>Instructor</th><th>Status</th></tr></thead><tbody><tr role="row"><td>${instructorHtml("Joan E. DeBello")}</td><td>Registered</td></tr></tbody></table>`;
    const window = mount(
      `<div id="outside">${grid}</div><div id="searchResultsParent"><table id="table1"><tbody><tr><td>${instructorHtml("Geoffrey Norman Dick")}</td></tr></tbody></table>${summary}<div class="ui-widget-content">${grid}</div></div>`,
    );
    runContentScript(window.document, "8103");
    await mutationsSettled();
    expect(chips(window)).toHaveLength(0);
    await frameSettled(window);

    const painted = chips(window);
    expect(painted).toHaveLength(1);
    expect(painted[0]?.getAttribute("aria-label")).toBe("Loading ratings");
    expect(painted[0]?.querySelector(".rspr-mark")).not.toBeNull();
    expect(window.document.querySelector("#table1 .rspr-chip")).toBeNull();
    expect(window.document.querySelector(".registration-summary .rspr-chip")).toBeNull();
    expect(window.document.querySelector("#outside .rspr-chip")).toBeNull();
    const instructor = window.document.querySelector(
      "#searchResultsParent td[data-property='instructor'] .rspr-chip",
    );
    expect(instructor).toBe(painted[0]);
  });

  it("leaves a hidden Instructor column alone and does not read CRN or Status after a column move", async () => {
    const hidden = results(
      `<th data-property="courseReferenceNumber" role="columnheader">CRN</th><th data-property="status" role="columnheader">Status</th>`,
      `<tr role="row"><td data-property="courseReferenceNumber" role="gridcell">${instructorHtml("Geoffrey Norman Dick")}</td><td data-property="status" role="gridcell">FULL</td></tr>`,
    );
    const hiddenWindow = mount(`<div id="searchResultsParent">${hidden}</div>`);
    runContentScript(hiddenWindow.document, "8103");
    await frameSettled(hiddenWindow);
    expect(chips(hiddenWindow)).toHaveLength(0);

    const moved = propertyRow({
      courseReferenceNumber: "10946",
      status: "FULL",
      instructor: instructorHtml("Geoffrey Norman Dick"),
      campus: " Queens Campus",
      subjectDescription: "COMPUTER SCIENCE - CCPS",
    });
    const byProperty = mount(
      `<div id="searchResultsParent">${results(propertyHead(), moved)}</div>`,
    );
    runContentScript(byProperty.document, "8103");
    await frameSettled(byProperty);
    const propertyChip = byProperty.document.querySelector("#searchResultsParent .rspr-chip");
    expect(propertyChip?.parentElement?.getAttribute("data-property")).toBe("instructor");
    expect(
      byProperty.document.querySelector("td[data-property='courseReferenceNumber'] .rspr-chip"),
    ).toBeNull();
    expect(byProperty.document.querySelector("td[data-property='status'] .rspr-chip")).toBeNull();
    const propertyMessage = messageFrom(byProperty);
    expect(propertyMessage.items[0]?.campus).toBe(" Queens Campus");
    expect(propertyMessage.items[0]?.key).toContain(`:${SCHOOL_IDS.queens}:`);
    expect(propertyMessage.items[0]?.name).toBe("Geoffrey Norman Dick");
    expect(JSON.stringify(propertyMessage)).not.toContain(SECRET_HREF);
    expect(JSON.stringify(propertyMessage)).not.toContain(SECRET_ID);
    expect(JSON.stringify(propertyMessage)).not.toContain(SECRET_TERM);

    const byHeader = textRow([
      "10946",
      "FULL",
      instructorHtml("Geoffrey Norman Dick"),
      " Queens Campus",
      "COMPUTER SCIENCE - CCPS",
    ]);
    const headerWindow = mount(
      `<div id="searchResultsParent">${results(textHead(), byHeader)}</div>`,
    );
    runContentScript(headerWindow.document, "8103");
    await frameSettled(headerWindow);
    const headerChip = headerWindow.document.querySelector("#searchResultsParent .rspr-chip");
    expect(headerChip?.parentElement?.textContent).toContain("Geoffrey Norman Dick");
    expect(headerWindow.document.querySelector("#searchResultsParent td")?.querySelector(".rspr-chip")).toBeNull();
    expect(headerWindow.document.querySelector("#searchResultsParent td")?.textContent).toBe("10946");
    const headerMessage = messageFrom(headerWindow);
    expect(headerMessage.items[0]?.campus).toBe(" Queens Campus");
    expect(headerMessage.items[0]?.key).toContain(`:${SCHOOL_IDS.queens}:`);
    expect(headerMessage.items[0]?.subject).toBe("COMPUTER SCIENCE - CCPS");
  });

  it("repaints a swapped subtree once, and two CRNs share one cache key", async () => {
    const habibeh = (crn: string) =>
      propertyRow({
        courseReferenceNumber: crn,
        status: "10 of 25 seats remain.",
        instructor: "",
        campus: " Queens Campus",
        subjectDescription: "THEOLOGY",
      });
    const window = mount(
      `<div id="searchResultsParent"><div class="ui-widget-content">${results(propertyHead(), habibeh("12738") + habibeh("12740"))}</div></div>`,
    );
    const parent = window.document.getElementById("searchResultsParent");
    if (parent === null) throw new Error("parent missing");
    runContentScript(window.document, "8103");
    const instructorCells = [...parent.querySelectorAll("td[data-property='instructor']")];
    expect(instructorCells).toHaveLength(2);
    for (const cell of instructorCells) cell.innerHTML = instructorHtml("Habibeh Rahim");
    await mutationsSettled();
    expect(chips(window)).toHaveLength(0);
    await frameSettled(window);
    expect(chips(window)).toHaveLength(2);

    const parsed = parseInstructor("Habibeh Rahim");
    if (parsed === null) throw new Error("name did not parse");
    const key = localCacheKey(1, " Queens Campus", "THEOLOGY", parsed);
    const message = scanGrid(parent as unknown as ParentNode, 1);
    expect(message.items.map((item) => item.key)).toEqual([key]);
    expect(new Set(message.items.map((item) => item.key)).size).toBe(1);
    expect(key).not.toContain("12738");
    expect(key).not.toContain("12740");
    const request = parseRatingsRequest({ items: message.items });
    expect(request.ok).toBe(true);

    const table = parent.querySelector("table");
    table?.setAttribute("data-pass", "again");
    await frameSettled(window);
    expect(chips(window)).toHaveLength(2);

    const oldCell = instructorCells[0];
    const holder = parent.querySelector(".ui-widget-content");
    if (holder === null || oldCell === undefined) throw new Error("swap fixture missing");
    holder.innerHTML = results(
      propertyHead(),
      propertyRow({
        courseReferenceNumber: "10943",
        status: "8 of 25 seats remain.",
        instructor: instructorHtml("Christopher P. Vogt"),
        campus: " Queens Campus",
        subjectDescription: "THEOLOGY",
      }),
    );
    expect(parent.contains(oldCell)).toBe(false);
    await mutationsSettled();
    expect(chips(window)).toHaveLength(0);
    await frameSettled(window);
    expect(chips(window)).toHaveLength(1);
    expect(chips(window)[0]?.parentElement?.textContent).toContain("Christopher P. Vogt");
    expect(oldCell.querySelectorAll(".rspr-chip")).toHaveLength(1);

    const reply: RatingsQueryReply = { cacheVersion: 1, results: {} } satisfies RatingsResponse;
    expect(reply.cacheVersion).toBe(1);
  });
});
