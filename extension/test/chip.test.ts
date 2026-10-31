import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  rmpProfileUrl,
  type RatedResult,
  type RatingResult,
} from "../../shared/src/contract";
import { paintInstructorCell, type ChipPaint } from "../src/chip";

const CONTENT_CSS = `.rspr-chip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  box-sizing: border-box;
  min-height: 24px;
  margin: 0;
  padding: 4px 0;
  background: transparent;
  color: #5c6570;
  font-family: Arial, sans-serif;
  font-size: 12px;
  line-height: 16px;
  white-space: normal;
  text-decoration: none;
}
.rspr-lines {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.rspr-note {
  color: #6b6258;
}
a.rspr-score {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  min-height: 24px;
  color: #148280;
  cursor: pointer;
  text-decoration: underline;
}
.rspr-out {
  text-decoration: none;
}
.rspr-chip:focus-visible,
a.rspr-score:focus-visible {
  outline: 2px solid #000;
  outline-offset: 2px;
}
.rspr-mark {
  display: block;
  flex: none;
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  margin-top: 5px;
  background: #148280;
  transform: rotate(45deg);
}
td.rspr-open {
  height: auto;
  max-height: none;
}
@media (forced-colors: active) {
  .rspr-mark {
    background: CanvasText;
    border: 1px solid CanvasText;
  }
  .rspr-note,
  a.rspr-score {
    color: CanvasText;
  }
}
`;

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
      { paint: rated("exact"), text: "4.5/5 · 28 reviews↗" },
      { paint: rated("possible"), text: "Possible Match4.5/5 · 28 reviews↗" },
      { paint: rated("exact", 1), text: "4.5/5 · 1 review↗" },
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
      expect(markFill(chip!)).toMatch(/rgb\(20,\s*130,\s*128\)|#148280/i);
      const view = chip?.ownerDocument.defaultView;
      const score = chip?.querySelector("a.rspr-score");
      const painted =
        score !== null && score !== undefined
          ? view?.getComputedStyle(score).color
          : view?.getComputedStyle(chip!).color;
      const expected =
        score !== null && score !== undefined
          ? /rgb\(20,\s*130,\s*128\)|#148280/i
          : /rgb\(92,\s*101,\s*112\)|#5c6570/i;
      expect(painted ?? "").toMatch(expected);
    }
    expect(paint("<td></td>", ["loading"])).toEqual([]);
    expect(paint("<td>TBA</td>", ["loading"])).toEqual([]);
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
    expect(chips[1]?.textContent).toContain("4.5/5 · 4 reviews");
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
