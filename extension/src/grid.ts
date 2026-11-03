import {
  type RatingRequestItem,
  type RatingsResponse,
} from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import {
  instructorTextsFromCell,
  parseInstructor,
  type InstructorCellNode,
} from "../../shared/src/names";
import {
  canPaintInstructor,
  instructorChip,
  paintInstructorCell,
  plainInstructorCell,
  type ChipPaint,
} from "./chip";
import {
  paintReply,
  paintSlots,
  type LocalRatings,
  type Paintable,
} from "./paint";

/** Content script to service worker. The service worker answers with `RatingsQueryReply`. */
export interface RatingsQueryMessage {
  items: RatingRequestItem[];
}

export type RatingsQueryReply = RatingsResponse;

export interface ViewHost {
  requestAnimationFrame(callback: () => void): number;
  MutationObserver: typeof MutationObserver;
}

/** Browse uses `table.grid`. The registration view uses `table.search-results-table`. */
const GRID_SELECTOR =
  'table.grid[role="grid"], table.search-results-table';

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
  if (keyed)
    return row.querySelector(`:scope > td[data-property="${property}"]`);
  const index = headers.findIndex((header) => headerLabel(header) === label);
  if (index < 0) return null;
  return row.querySelectorAll(":scope > td")[index] ?? null;
}

function columnText(cell: Element | null): string | null {
  if (cell === null) return null;
  const text = cell.textContent ?? "";
  return text.trim() === "" ? null : text;
}

function dataRows(table: Element): Element[] {
  const marked = [
    ...table.querySelectorAll(':scope > tbody > tr[role="row"]'),
  ];
  if (marked.length > 0) return marked;
  return [...table.querySelectorAll(":scope > tbody > tr")].filter(
    (row) => row.querySelector(":scope > td") !== null,
  );
}

function instructorNames(cell: HTMLElement): string[] {
  if (cell.querySelector("a.instructor-contact-link") !== null) {
    return instructorTextsFromCell(cell as unknown as InstructorCellNode);
  }
  const copy = cell.cloneNode(true) as HTMLElement;
  for (const chip of copy.querySelectorAll(".rspr-chip")) chip.remove();
  return instructorTextsFromCell(copy as unknown as InstructorCellNode);
}

function resultTables(root: ParentNode): Element[] {
  const tables = [...root.querySelectorAll(GRID_SELECTOR)];
  if (isGrid(root)) tables.unshift(root);
  return tables;
}

function isGrid(root: ParentNode): root is Element {
  return (
    typeof (root as Element).matches === "function" &&
    (root as Element).matches(GRID_SELECTOR)
  );
}

function collectSlots(root: ParentNode, cacheVersion: number): Paintable[] {
  const slots: Paintable[] = [];
  for (const table of resultTables(root)) {
    const headers = [...table.querySelectorAll(":scope > thead > tr > th")];
    const keyed = table.querySelector("[data-property]") !== null;
    const instructorHeader = keyed
      ? headers.some(
          (header) => header.getAttribute("data-property") === "instructor",
        )
      : headers.some((header) => headerLabel(header) === "instructor");
    if (!instructorHeader) continue;
    for (const row of dataRows(table)) {
      const instructor = columnCell(
        row,
        headers,
        "instructor",
        "instructor",
        keyed,
      );
      if (instructor === null) continue;
      const cell = instructor as HTMLElement;
      const names = instructorNames(cell);
      const campus = columnText(
        columnCell(row, headers, "campus", "campus", keyed),
      );
      const subjectCell =
        columnCell(
          row,
          headers,
          "subjectDescription",
          "subject description",
          keyed,
        ) ??
        (keyed
          ? null
          : columnCell(row, headers, "subject", "subject", false));
      const subject = columnText(subjectCell);
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        const linked = canPaintInstructor(cell, index);
        if (name === undefined || (!linked && !plainInstructorCell(cell)))
          continue;
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
export function scanGrid(
  root: ParentNode,
  cacheVersion: number,
): RatingsQueryMessage {
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
  wake?: () => void,
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
    void paintSlots(
      slots,
      local,
      deliver,
      () => stopped || mine !== pass,
      wake,
    ).then((next) => {
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
