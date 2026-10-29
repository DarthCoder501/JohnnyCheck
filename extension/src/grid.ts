import { type RatingRequestItem, type RatingsResponse } from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { instructorTextsFromCell, parseInstructor, type InstructorCellNode } from "../../shared/src/names";
import { paintInstructorCell } from "./chip";

/** Content script to service worker. The service worker answers with `RatingsQueryReply`. */
export interface RatingsQueryMessage {
  items: RatingRequestItem[];
}

export type RatingsQueryReply = RatingsResponse;

export interface ViewHost {
  requestAnimationFrame(callback: () => void): number;
  MutationObserver: typeof MutationObserver;
}

const GRID_SELECTOR = 'ssb-class-search-results .class-search-results-grid > table.grid[role="grid"]';

function headerLabel(header: Element): string {
  return (header.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function columnCell(
  row: Element,
  headers: readonly Element[],
  property: string,
  label: string,
  keyed: boolean,
): Element | null {
  if (keyed) return row.querySelector(`:scope > td[data-property="${property}"]`);
  const index = headers.findIndex((header) => headerLabel(header) === label);
  if (index < 0) return null;
  return row.querySelectorAll(":scope > td")[index] ?? null;
}

function columnText(cell: Element | null): string | null {
  if (cell === null) return null;
  const text = cell.textContent ?? "";
  return text.trim() === "" ? null : text;
}

/** Loading diamonds for real names, plus the request the service worker will answer. No fetch. */
export function scanGrid(root: ParentNode, cacheVersion: number): RatingsQueryMessage {
  const items: RatingRequestItem[] = [];
  const seen = new Set<string>();
  for (const table of root.querySelectorAll(GRID_SELECTOR)) {
    const headers = [...table.querySelectorAll(":scope > thead > tr > th")];
    const keyed = table.querySelector("[data-property]") !== null;
    const instructorHeader = keyed
      ? headers.some((header) => header.getAttribute("data-property") === "instructor")
      : headers.some((header) => headerLabel(header) === "instructor");
    if (!instructorHeader) continue;
    for (const row of table.querySelectorAll(':scope > tbody > tr[role="row"]')) {
      const instructor = columnCell(row, headers, "instructor", "instructor", keyed);
      if (instructor === null) continue;
      const names = instructorTextsFromCell(instructor as unknown as InstructorCellNode);
      if (names.length === 0) continue;
      const chips = paintInstructorCell(
        instructor as HTMLElement,
        names.map(() => "loading"),
      );
      const campus = columnText(columnCell(row, headers, "campus", "campus", keyed));
      const subject = columnText(
        columnCell(row, headers, "subjectDescription", "subject description", keyed),
      );
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        // shortcut: plain text has no anchor or br, so it is not requested
        if (name === undefined || chips[index] === undefined) continue;
        const parsed = parseInstructor(name);
        if (parsed === null) continue;
        const key = localCacheKey(cacheVersion, campus, subject, parsed);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ key, name, campus, subject });
      }
    }
  }
  return { items };
}

/** One frame per burst. Banner replaces the results subtree and fills instructor HTML after the cells. */
export function observeGrid(
  parent: Element,
  cacheVersion: number,
  view: ViewHost,
): { disconnect(): void } {
  let frame: number | null = null;
  let stopped = false;
  const scan = () => {
    frame = null;
    if (stopped) return;
    scanGrid(parent, cacheVersion);
  };
  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = view.requestAnimationFrame(scan);
  };
  const observer = new view.MutationObserver(schedule);
  observer.observe(parent, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  schedule();
  return {
    disconnect() {
      stopped = true;
      observer.disconnect();
    },
  };
}
