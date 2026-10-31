import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  rmpProfileUrl,
  type RatedResult,
  type RatingResult,
} from "../../shared/src/contract";
import { paintInstructorCell, type ChipPaint } from "../src/chip";

const CONTENT_CSS = readFileSync(
  new URL("../content.css", import.meta.url),
  "utf8",
);

const CAPTURED = `<td data-property="instructor"><a class="email instructor-contact-link" aria-haspopup="true" data-banner-id="REDACTED" data-term="REDACTED" href="mailto:REDACTED">Geoffrey Norman Dick</a> (Primary)<br></td>`;

function rated(match: RatedResult["match"], numRatings = 28): RatedResult {
  return {
    status: "rated",
    match,
    reasons: match === "possible" ? ["nickname"] : ["initial"],
    legacyId: 4242,
    rmpName: "Geoffrey Dick",
    department: "Computer Science",
    schoolName: "Queens",
    numRatings,
    quality: 4.5,
    difficulty: null,
    wouldTakeAgain: null,
    ttlSeconds: 1,
  };
}

function cell(html: string): HTMLElement {
  const window = new Window();
  window.document.body.innerHTML = `<table><tbody><tr>${html}</tr></tbody></table>`;
  const style = window.document.createElement("style");
  style.textContent = readFileSync(
    new URL("../content.css", import.meta.url),
    "utf8",
  );
  window.document.head.append(style);
  const found = window.document.querySelector("td");
  if (found === null) throw new Error("fixture cell missing");
  return found as unknown as HTMLElement;
}

function paint(html: string, paints: readonly ChipPaint[]): HTMLElement[] {
  const td = cell(html);
  return paintInstructorCell(td, paints);
}

function markFill(chip: HTMLElement): string {
  const mark = chip.querySelector(".rspr-mark");
  if (mark === null) return "";
  return (
    chip.ownerDocument.defaultView?.getComputedStyle(mark).backgroundColor ?? ""
  );
}

describe("extension chip", () => {
  it("copies content.css and nothing else", () => {
    const css = readFileSync(
      new URL("../content.css", import.meta.url),
      "utf8",
    );
    expect(css).toBe(CONTENT_CSS);
    expect(css).not.toMatch(/#C12F33|#C64C44|#214A80/);
    expect(css).not.toMatch(/td\.rspr-open\s*\{[^}]*overflow/s);
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as {
      content_scripts: { css?: string[] }[];
    };
    expect(manifest.content_scripts[0]?.css).toEqual(["content.css"]);
  });

  it("renders every painted state with the same teal diamond and no RMP prefix", () => {
    const states: { paint: ChipPaint; text: string }[] = [
      { paint: "loading", text: "" },
      { paint: rated("exact"), text: "4.5/5 · 28 Reviews↗" },
      { paint: rated("possible"), text: "4.5/5 · 28 Reviews↗Possible Match" },
      { paint: rated("exact", 1), text: "4.5/5 · 1 Review↗" },
      {
        paint: {
          status: "unrated",
          match: "exact",
          reasons: ["initial"],
          legacyId: 4242,
          rmpName: "Geoffrey Dick",
          department: null,
          schoolName: "Queens",
          numRatings: 0,
          quality: null,
          difficulty: null,
          wouldTakeAgain: null,
          ttlSeconds: 1,
        },
        text: "No Ratings Yet",
      },
      { paint: { status: "not_listed", ttlSeconds: 1 }, text: "Not Listed" },
      { paint: { status: "unavailable" }, text: "Ratings Unavailable" },
    ];
    for (const state of states) {
      const [chip] = paint(CAPTURED, [state.paint]);
      expect(chip, state.text).toBeDefined();
      expect(chip?.textContent?.trim().startsWith("RMP")).toBe(false);
      expect(chip?.textContent?.replace(/\s+/g, " ").trim()).toBe(state.text);
      expect(chip?.querySelectorAll(".rspr-mark")).toHaveLength(1);
      if (state.paint === "loading")
        expect(chip?.getAttribute("aria-label")).toBe("Loading ratings");
      const quiet =
        state.paint !== "loading" && state.paint.status === "not_listed";
      expect(markFill(chip!)).toMatch(
        quiet
          ? /rgb\(197,\s*203,\s*211\)|#c5cbd3/i
          : /rgb\(20,\s*130,\s*128\)|#148280/i,
      );
      const view = chip?.ownerDocument.defaultView;
      const grade = chip?.querySelector(".rspr-grade");
      const painted =
        grade !== null && grade !== undefined
          ? view?.getComputedStyle(grade).color
          : view?.getComputedStyle(chip!).color;
      const expected =
        grade !== null && grade !== undefined
          ? /rgb\(15,\s*107,\s*58\)|#0f6b3a/i
          : /rgb\(92,\s*101,\s*112\)|#5c6570/i;
      expect(painted ?? "").toMatch(expected);
      expect(chip?.parentElement?.classList.contains("rspr-cell")).toBe(true);
    }
    expect(paint("<td></td>", ["loading"])).toEqual([]);
    expect(paint("<td>TBA</td>", ["loading"])).toEqual([]);
  });

  it("keeps Possible Match gray and Not Listed on the diamond row against Banner bold teal", () => {
    const td = cell(CAPTURED);
    const hostile = td.ownerDocument.createElement("style");
    hostile.textContent =
      "td, td a, td span { color: #148280 !important; font-weight: 700 !important; display: block !important; }";
    td.ownerDocument.head.append(hostile);
    const possible = paintInstructorCell(td, [rated("possible")])[0]!;
    const view = possible.ownerDocument.defaultView!;
    const note = possible.querySelector(".rspr-note")!;
    expect(view.getComputedStyle(note).color).toMatch(
      /rgb\(122,\s*78,\s*0\)|#7a4e00/i,
    );
    expect(Number.parseInt(view.getComputedStyle(note).fontWeight, 10)).toBe(
      400,
    );
    expect(view.getComputedStyle(note).display).toBe("inline-flex");
    const noteBox = note.getBoundingClientRect();
    const scoreBox = possible.querySelector(".rspr-score")!.getBoundingClientRect();
    expect(Math.abs(noteBox.top - scoreBox.top)).toBeLessThan(8);
    expect(
      view.getComputedStyle(possible.querySelector(".rspr-row")!).display,
    ).toBe("inline-flex");
    const missingTd = cell(CAPTURED);
    const missHostile = missingTd.ownerDocument.createElement("style");
    missHostile.textContent = hostile.textContent;
    missingTd.ownerDocument.head.append(missHostile);
    const missing = paintInstructorCell(missingTd, [
      { status: "not_listed", ttlSeconds: 1 },
    ])[0]!;
    const missView = missing.ownerDocument.defaultView!;
    expect(
      missView.getComputedStyle(missing.querySelector(".rspr-plain")!).color,
    ).toMatch(/rgb\(92,\s*101,\s*112\)|#5c6570/i);
    expect(
      missView.getComputedStyle(missing.querySelector(".rspr-row")!).whiteSpace,
    ).toBe("nowrap");
    expect(
      Number.parseInt(
        missView.getComputedStyle(missing.querySelector(".rspr-plain")!).fontWeight,
        10,
      ),
    ).toBe(400);
    expect(markFill(missing)).toMatch(/rgb\(197,\s*203,\s*211\)|#c5cbd3/i);
  });

  it("colors the shown score green, amber, or red and keeps the band with the tenth", () => {
    const bands: { quality: number; color: RegExp }[] = [
      { quality: 4, color: /rgb\(15,\s*107,\s*58\)|#0f6b3a/i },
      { quality: 3.95, color: /rgb\(15,\s*107,\s*58\)|#0f6b3a/i },
      { quality: 3.9, color: /rgb\(122,\s*78,\s*0\)|#7a4e00/i },
      { quality: 3, color: /rgb\(122,\s*78,\s*0\)|#7a4e00/i },
      { quality: 2.94, color: /rgb\(159,\s*29,\s*28\)|#9f1d1c/i },
    ];
    for (const band of bands) {
      const paintResult = rated("exact");
      paintResult.quality = band.quality;
      const chip = paint(CAPTURED, [paintResult])[0]!;
      const grade = chip.querySelector(".rspr-grade")!;
      expect(grade.textContent).toBe(`${band.quality.toFixed(1)}/5`);
      expect(
        chip.ownerDocument.defaultView?.getComputedStyle(grade).color ?? "",
      ).toMatch(band.color);
    }
    const padded = paint(CAPTURED, [rated("exact")])[0]!.parentElement!;
    expect(
      padded.ownerDocument.defaultView?.getComputedStyle(padded).paddingTop,
    ).toBe("8px");
    expect(
      padded.ownerDocument.defaultView?.getComputedStyle(padded).paddingBottom,
    ).toBe("8px");
    expect(
      padded.ownerDocument.defaultView?.getComputedStyle(padded).verticalAlign,
    ).toBe("middle");
  });

  it("underlines only the review count and keeps the score outside the link", () => {
    const chip = paint(CAPTURED, [rated("exact")])[0]!;
    const view = chip.ownerDocument.defaultView!;
    const link = chip.querySelector("a.rspr-score")!;
    const grade = chip.querySelector(".rspr-grade")!;
    const meta = chip.querySelector(".rspr-meta")!;
    const arrow = chip.querySelector(".rspr-out")!;
    expect(link.contains(grade)).toBe(false);
    expect(link.contains(meta)).toBe(true);
    expect(link.contains(arrow)).toBe(true);
    expect(meta.textContent).toBe("28 Reviews");
    const deco = (el: Element) => {
      const style = view.getComputedStyle(el);
      return `${style.textDecoration} ${style.textDecorationLine}`;
    };
    expect(deco(meta)).toMatch(/underline/);
    expect(deco(grade)).not.toMatch(/underline/);
    expect(deco(arrow)).not.toMatch(/underline/);
  });

  it("links a profile and leaves not listed and ratings unavailable as spans", () => {
    const profile = paint(CAPTURED, [rated("exact")])[0]?.querySelector("a");
    expect(profile?.tagName).toBe("A");
    expect(profile?.getAttribute("href")).toBe(rmpProfileUrl(4242));
    expect(profile?.getAttribute("target")).toBe("_blank");
    expect(profile?.getAttribute("rel")).toBe("noopener noreferrer");
    const name = "Geoffrey Norman Dick, Rate My Professors, 28 ratings";
    expect(profile?.getAttribute("aria-label")).toBe(name);
    expect(profile?.getAttribute("title")).toBe(name);

    const possible = paint(CAPTURED, [rated("possible")])[0];
    expect(possible?.querySelector(".rspr-note")?.textContent).toBe(
      "Possible Match",
    );
    expect(possible?.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Geoffrey Norman Dick, Rate My Professors, possible match",
    );

    const unrated = paint(CAPTURED, [
      {
        status: "unrated",
        match: "exact",
        reasons: ["initial"],
        legacyId: 7,
        rmpName: "Geoffrey Dick",
        department: null,
        schoolName: "Queens",
        numRatings: 0,
        quality: null,
        difficulty: null,
        wouldTakeAgain: null,
        ttlSeconds: 1,
      },
    ])[0];
    expect(unrated?.querySelector("a")?.tagName).toBe("A");
    expect(unrated?.querySelector(".rspr-out")).toBeNull();
    expect(unrated?.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Geoffrey Norman Dick, Rate My Professors, no ratings yet",
    );

    for (const result of [
      { status: "not_listed", ttlSeconds: 1 },
      { status: "unavailable" },
    ] as const satisfies readonly RatingResult[]) {
      const chip = paint(CAPTURED, [result])[0];
      expect(chip?.tagName).toBe("SPAN");
      expect(chip?.getAttribute("href")).toBeNull();
      expect(chip?.getAttribute("aria-label")).toBeNull();
    }
  });

  it("inserts each chip after that instructor's br and leaves the faculty link alone", () => {
    const td = cell(
      `<td data-property="instructor"><a class="email instructor-contact-link" href="mailto:REDACTED">Geoffrey Norman Dick</a> (Primary)<br><a class="email instructor-contact-link" href="mailto:OTHER">Joan E. DeBello</a> <br></td>`,
    );
    const faculty = [...td.querySelectorAll("a.instructor-contact-link")];
    const before = faculty.map((link) => link.outerHTML);
    const chips = paintInstructorCell(td, [
      rated("exact"),
      rated("possible", 4),
    ]);
    expect(chips).toHaveLength(2);
    const breaks = [...td.querySelectorAll("br")];
    expect(breaks[0]?.nextSibling).toBe(chips[0]);
    expect(breaks[1]?.nextSibling).toBe(chips[1]);
    expect(faculty.map((link) => link.outerHTML)).toEqual(before);
    expect(
      td.querySelector("a.instructor-contact-link")?.getAttribute("href"),
    ).toBe("mailto:REDACTED");
    expect(chips[1]?.textContent).toContain("Possible Match");
    expect(chips[1]?.textContent).toContain("4.5/5 · 4 Reviews");
  });

  it("stops click, mousedown, mouseup, and Enter without canceling Enter", () => {
    const td = cell(CAPTURED);
    const [link] = paintInstructorCell(td, [rated("exact")]);
    const seen: string[] = [];
    td.addEventListener("click", () => seen.push("click"));
    td.addEventListener("mousedown", () => seen.push("mousedown"));
    td.addEventListener("mouseup", () => seen.push("mouseup"));
    td.addEventListener("keydown", () => seen.push("keydown"));
    const view = td.ownerDocument.defaultView!;
    for (const type of ["click", "mousedown", "mouseup"] as const) {
      const event = new view.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
      });
      link?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const enter = new view.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    link?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(link?.querySelector("a")?.tagName).toBe("A");
    const other = new view.KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    link?.dispatchEvent(other);
    expect(seen).toEqual(["keydown"]);

    const plain = cell(CAPTURED);
    const [span] = paintInstructorCell(plain, [
      { status: "not_listed", ttlSeconds: 1 },
    ]);
    const enterSpan = new plain.ownerDocument.defaultView!.KeyboardEvent(
      "keydown",
      {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      },
    );
    let followed = false;
    plain.addEventListener("keydown", () => {
      followed = true;
    });
    span?.dispatchEvent(enterSpan);
    expect(span?.tagName).toBe("SPAN");
    expect(enterSpan.defaultPrevented).toBe(false);
    expect(followed).toBe(false);
  });
});
