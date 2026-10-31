import { rmpProfileUrl, type RatingResult } from "../../shared/src/contract";
import { isPlaceholder } from "../../shared/src/placeholders";

export type ChipPaint = "loading" | RatingResult;

const ELEMENT_NODE = 1;

function scoreLabel(paint: Extract<RatingResult, { legacyId: number }>): string {
  if (paint.status === "unrated") return "No Ratings Yet";
  const reviews = paint.numRatings === 1 ? "review" : "reviews";
  return `${paint.quality.toFixed(1)}/5 · ${paint.numRatings} ${reviews}`;
}

function accessibleName(person: string, paint: ChipPaint): string | null {
  if (
    paint === "loading" ||
    paint.status === "not_listed" ||
    paint.status === "unavailable"
  )
    return null;
  const tail =
    paint.status === "unrated"
      ? "no ratings yet"
      : paint.match === "possible"
        ? "possible match"
        : `${paint.numRatings} ratings`;
  return `${person}, Rate My Professors, ${tail}`;
}

function isProfile(
  paint: ChipPaint,
): paint is Extract<RatingResult, { legacyId: number }> {
  return (
    paint !== "loading" &&
    (paint.status === "rated" || paint.status === "unrated")
  );
}

function stopRowEvent(event: Event): void {
  if (event.type === "keydown") {
    if ("key" in event && event.key === "Enter") event.stopPropagation();
    return;
  }
  event.stopPropagation();
}

function isChip(node: ChildNode): node is HTMLElement {
  return (
    node.nodeType === ELEMENT_NODE &&
    (node as Element)
      .getAttribute("class")
      ?.split(/\s+/)
      .includes("rspr-chip") === true
  );
}

function brAfter(anchor: Element): ChildNode | null {
  let node: ChildNode | null = anchor.nextSibling;
  while (node !== null) {
    if (node.nodeType === ELEMENT_NODE) {
      const name = node.nodeName.toUpperCase();
      if (name === "BR") return node;
      if (name === "A") return null;
    }
    node = node.nextSibling;
  }
  return null;
}

function createChip(
  doc: Document,
  person: string,
  paint: ChipPaint,
): HTMLElement {
  const profile = isProfile(paint);
  const chip = doc.createElement("span");
  chip.className = "rspr-chip";
  const mark = doc.createElement("span");
  mark.className = "rspr-mark";
  mark.setAttribute("aria-hidden", "true");
  chip.append(mark);
  const lines = doc.createElement("span");
  lines.className = "rspr-lines";
  if (profile && paint.match === "possible") {
    const note = doc.createElement("span");
    note.className = "rspr-note";
    note.textContent = "Possible Match";
    lines.append(note);
  }
  if (profile) {
    const link = doc.createElement("a");
    link.className = "rspr-score";
    link.append(doc.createTextNode(scoreLabel(paint)));
    if (paint.status === "rated") {
      const arrow = doc.createElement("span");
      arrow.className = "rspr-out";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      link.append(arrow);
    }
    const name = accessibleName(person, paint);
    if (name !== null) {
      link.setAttribute("aria-label", name);
      link.setAttribute("title", name);
    }
    link.setAttribute("href", rmpProfileUrl(paint.legacyId));
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    lines.append(link);
  } else if (paint !== "loading") {
    lines.append(
      doc.createTextNode(
        paint.status === "not_listed" ? "Not Listed" : "Ratings Unavailable",
      ),
    );
  }
  if (lines.childNodes.length > 0) chip.append(lines);
  if (paint === "loading") chip.setAttribute("aria-label", "Loading ratings");
  for (const type of ["click", "mousedown", "mouseup", "keydown"]) {
    chip.addEventListener(type, stopRowEvent);
  }
  return chip;
}

function instructorAnchors(cell: HTMLElement): Element[] {
  const anchors: Element[] = [];
  for (const node of cell.childNodes) {
    if (node.nodeType !== ELEMENT_NODE || node.nodeName.toUpperCase() !== "A")
      continue;
    const anchor = node as Element;
    const className = anchor.getAttribute("class") ?? "";
    if (!className.split(/\s+/).includes("instructor-contact-link")) continue;
    if (isPlaceholder(anchor.textContent)) continue;
    anchors.push(anchor);
  }
  return anchors;
}

function anchorAt(
  cell: HTMLElement,
  index: number,
): { anchor: Element; br: ChildNode } | null {
  const anchor = instructorAnchors(cell)[index];
  if (anchor === undefined || anchor.parentNode === null) return null;
  const br = brAfter(anchor);
  if (br === null) return null;
  return { anchor, br };
}

export function canPaintInstructor(cell: HTMLElement, index: number): boolean {
  return anchorAt(cell, index) !== null;
}

export function instructorChip(
  cell: HTMLElement,
  index: number,
): HTMLElement | null {
  const place = anchorAt(cell, index);
  if (place === null) return null;
  const next = place.br.nextSibling;
  return next !== null && isChip(next) ? next : null;
}

export function paintInstructorCell(
  cell: HTMLElement,
  paints: readonly ChipPaint[],
  refresh = false,
): HTMLElement[] {
  const chips: HTMLElement[] = [];
  for (let index = 0; index < paints.length; index += 1) {
    const paint = paints[index];
    const place = anchorAt(cell, index);
    if (paint === undefined || place === null) continue;
    const next = place.br.nextSibling;
    const person = (place.anchor.textContent ?? "").replace(/\s+/g, " ").trim();
    if (next !== null && isChip(next)) {
      if (!refresh) {
        chips.push(next);
        continue;
      }
      const chip = createChip(place.anchor.ownerDocument, person, paint);
      next.replaceWith(chip);
      chips.push(chip);
      continue;
    }
    const chip = createChip(place.anchor.ownerDocument, person, paint);
    place.anchor.parentNode?.insertBefore(chip, place.br.nextSibling);
    chips.push(chip);
  }
  return chips;
}
