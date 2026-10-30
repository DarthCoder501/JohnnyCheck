import { type RatingRequestItem, type RatingsResponse } from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { instructorTextsFromCell, parseInstructor, type InstructorCellNode } from "../../shared/src/names";
import { canPaintInstructor, instructorChip, paintInstructorCell, type ChipPaint } from "./chip";
import { paintReply, paintSlots, type LocalRatings, type Paintable } from "./paint";

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

function collectSlots(root: ParentNode, cacheVersion: number): Paintable[] {
  const slots: Paintable[] = [];
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
      const cell = instructor as HTMLElement;
      const names = instructorTextsFromCell(cell as unknown as InstructorCellNode);
      const campus = columnText(columnCell(row, headers, "campus", "campus", keyed));
      const subject = columnText(
        columnCell(row, headers, "subjectDescription", "subject description", keyed),
      );
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        // shortcut: plain text has no anchor or br, so it is not requested
        if (name === undefined || !canPaintInstructor(cell, index)) continue;
        const parsed = parseInstructor(name);
        if (parsed === null) continue;
        const key = localCacheKey(cacheVersion, campus, subject, parsed);
        const item: RatingRequestItem = { key, name, campus, subject };
        slots.push({
          key,
          item,
          cell,
          hasChip: () => instructorChip(cell, index) !== null,
          show(paint: ChipPaint, refresh?: boolean) {
            const paints: ChipPaint[] = [];
            paints[index] = paint;
            paintInstructorCell(cell, paints, refresh === true);
          },
        });
      }
    }
  }
  return slots;
}

/** Loading diamonds for real names, plus the request the service worker will answer. No fetch. */
export function scanGrid(root: ParentNode, cacheVersion: number): RatingsQueryMessage {
  const items: RatingRequestItem[] = [];
  const seen = new Set<string>();
  for (const slot of collectSlots(root, cacheVersion)) {
    slot.show("loading");
    if (seen.has(slot.key)) continue;
    seen.add(slot.key);
    items.push(slot.item);
  }
  return { items };
}

/** One frame per burst. Banner replaces the results subtree and fills instructor HTML after the cells. */
export function observeGrid(
  parent: Element,
  cacheVersion: number,
  view: ViewHost,
  local?: LocalRatings,
  deliver?: (message: RatingsQueryMessage) => void,
): { disconnect(): void; applyReply(reply: RatingsQueryReply): void } {
  let frame: number | null = null;
  let stopped = false;
  let pass = 0;
  let pending = new Map<string, Paintable[]>();
  const scan = () => {
    frame = null;
    if (stopped) return;
    const mine = ++pass;
    const slots = collectSlots(parent, cacheVersion);
    void paintSlots(slots, local, deliver, () => stopped || mine !== pass).then((next) => {
      if (stopped || mine !== pass) return;
      pending = next;
    });
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
    applyReply(reply) {
      if (stopped) return;
      paintReply(reply, cacheVersion, pending, local, Date.now());
    },
  };
}
