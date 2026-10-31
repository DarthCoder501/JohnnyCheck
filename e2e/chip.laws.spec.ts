import path from "node:path";
import { expect, test } from "@playwright/test";
import type { RatedResult } from "../shared/src/contract";

const root = process.cwd();

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

const unrated = {
  status: "unrated" as const,
  match: "exact" as const,
  reasons: ["initial" as const],
  legacyId: 7,
  rmpName: "Geoffrey Dick",
  department: null,
  schoolName: "Queens",
  numRatings: 0,
  quality: null,
  difficulty: null,
  wouldTakeAgain: null,
  ttlSeconds: 1,
};

function cell(id: string, inner: string): string {
  return `<tr><td id="${id}">${inner}</td></tr>`;
}

const captured = `<a class="email instructor-contact-link" href="mailto:redacted">Geoffrey Norman Dick</a> (Primary)<br>`;

test("chip states, hit size, and keyboard behavior", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body><table><tbody>
    ${cell("loading", captured)}
    ${cell("rated", captured)}
    ${cell("possible", captured)}
    ${cell("unrated", captured)}
    ${cell("missing", captured)}
    ${cell("down", captured)}
    ${cell("empty", "")}
    ${cell("tba", "TBA")}
    ${cell("two", `<a class="email instructor-contact-link" href="mailto:redacted">Geoffrey Norman Dick</a> (Primary)<br><a class="email instructor-contact-link" href="mailto:other">Joan E. DeBello</a> <br>`)}
  </tbody></table></body></html>`);
  await page.addStyleTag({ path: path.join(root, "extension/content.css") });
  await page.addScriptTag({ path: path.join(root, "e2e/dist/chip-hook.js") });
  await page.evaluate(
    ({ ratedExact, ratedPossible, unratedResult }) => {
      const paint = (window as unknown as { paintInstructorCell: (cell: Element, paints: unknown[]) => unknown }).paintInstructorCell;
      const cellOf = (id: string) => document.getElementById(id) as HTMLElement;
      paint(cellOf("loading"), ["loading"]);
      paint(cellOf("rated"), [ratedExact]);
      paint(cellOf("possible"), [ratedPossible]);
      paint(cellOf("unrated"), [unratedResult]);
      paint(cellOf("missing"), [{ status: "not_listed", ttlSeconds: 1 }]);
      paint(cellOf("down"), [{ status: "unavailable" }]);
      paint(cellOf("empty"), ["loading"]);
      paint(cellOf("tba"), ["loading"]);
      paint(cellOf("two"), [ratedExact, ratedPossible]);
    },
    { ratedExact: rated("exact"), ratedPossible: rated("possible", 4), unratedResult: unrated },
  );

  await expect(page.locator("#loading .rspr-chip")).toHaveAttribute("aria-label", "Loading ratings");
  await expect(page.locator("#rated .rspr-score")).toHaveText("4.5/5 · 28 reviews↗");
  await expect(page.locator("#possible .rspr-chip")).toContainText("Possible Match");
  await expect(page.locator("#possible .rspr-score")).toHaveText("4.5/5 · 4 reviews↗");
  await expect(page.locator("#unrated .rspr-chip")).toHaveText("No Ratings Yet");
  await expect(page.locator("#unrated .rspr-out")).toHaveCount(0);
  await expect(page.locator("#missing .rspr-chip")).toHaveText("Not Listed");
  await expect(page.locator("#down .rspr-chip")).toHaveText("Ratings Unavailable");
  await expect(page.locator("#empty .rspr-mark, #tba .rspr-mark")).toHaveCount(0);
  await expect(page.locator("#two .rspr-chip")).toHaveCount(2);
  await expect(page.locator("#rated a.instructor-contact-link")).toHaveAttribute("href", "mailto:redacted");
  await expect(page.locator("#rated .rspr-score")).toHaveAttribute("href", "https://www.ratemyprofessors.com/professor/4242");
  await expect(page.locator("#missing .rspr-chip")).toHaveJSProperty("tagName", "SPAN");
  await expect(page.locator("#rated .rspr-score")).toHaveAttribute(
    "aria-label",
    "Geoffrey Norman Dick, Rate My Professors, 28 ratings",
  );
  for (const id of ["rated", "missing"]) {
    const mark = page.locator(`#${id} .rspr-mark`);
    await expect(mark).toHaveCSS("background-color", "rgb(20, 130, 128)");
    const box = await page.locator(`#${id} .rspr-chip`).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(24);
  }
  await expect(page.locator("#rated .rspr-score")).toHaveCSS("color", "rgb(20, 130, 128)");
  await expect(page.locator("#missing .rspr-chip")).toHaveCSS("color", "rgb(92, 101, 112)");
  const scoreBox = await page.locator("#rated .rspr-score").boundingBox();
  expect(scoreBox?.height).toBeGreaterThanOrEqual(24);
  expect(await page.locator("#rated .rspr-chip").innerText()).not.toMatch(/^RMP/);

  const bubbled = await page.evaluate(() => {
    const cell = document.getElementById("rated");
    const chip = cell?.querySelector(".rspr-chip");
    let clicks = 0;
    cell?.addEventListener("click", () => {
      clicks += 1;
    });
    chip?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    chip?.dispatchEvent(enter);
    return { clicks, canceled: enter.defaultPrevented };
  });
  expect(bubbled).toEqual({ clicks: 0, canceled: false });

  const popupPromise = page.waitForEvent("popup");
  await page.locator("#rated .rspr-score").focus();
  await page.keyboard.press("Enter");
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/ratemyprofessors\.com\/(professor\/4242|teacher-not-found)/);
  await popup.close();
});
