import { cleanText, dropParentheticals, nameKey } from "./normalize";
import { isPlaceholder } from "./placeholders";

export interface PersonKeys {
  givenKey: string;
  middleKeys: string[];
  familyKey: string;
}

export interface ParsedName extends PersonKeys {
  given: string;
  middles: string[];
  family: string;
  /** Last space- or hyphen-separated part of `family`: `Nguyen` for `Van Nguyen`, `Jones` for `Smith-Jones`. */
  familyFinal: string;
  familyFinalKey: string;
  display: string;
}

export interface InstructorSegment {
  text: string;
  start: number;
  end: number;
}

const COMMA = ",";

const PARTICLE_PHRASES: readonly (readonly string[])[] = [
  ["de", "la"],
  ["de", "los"],
  ["de", "las"],
  ["van", "der"],
  ["van", "den"],
  ["van", "de"],
  ["von", "der"],
  ["de"],
  ["del"],
  ["di"],
  ["da"],
  ["van"],
  ["von"],
  ["st"],
  ["san"],
  ["santa"],
];

const SUFFIXES: ReadonlySet<string> = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "phd",
  "edd",
  "psyd",
  "pharmd",
  "dnp",
  "dds",
  "dmd",
  "dba",
  "llm",
  "esq",
  "cpa",
  "mfa",
  "lcsw",
]);

const SUFFIXES_NEEDING_DOTS_OR_COMMA: ReadonlySet<string> = new Set([
  "md",
  "jd",
  "mba",
  "ma",
  "ms",
  "rn",
  "cm",
  "sj",
]);

const LEADING_TITLES: ReadonlySet<string> = new Set([
  "dr",
  "doctor",
  "prof",
  "professor",
  "rev",
  "reverend",
  "fr",
  "father",
  "sr",
  "sister",
  "br",
  "brother",
  "msgr",
  "mr",
  "mrs",
  "ms",
  "mx",
]);

const SEGMENT_TRIM = /[\s,;/|]/;

function bareForm(token: string): string {
  return token.toLowerCase().replace(/\./g, "");
}

function tokenize(text: string): string[] {
  return text
    .replace(/,/g, " , ")
    .split(/\s+/)
    .filter((token) => token === COMMA || nameKey(token) !== "");
}

function countWords(tokens: readonly string[]): number {
  return tokens.filter((token) => token !== COMMA).length;
}

/** `C.M.`, `O.P.`, `O.F.M.`, `R.Ph.`, `D.Min.` A single `P.` or `St.` does not match. */
function isDottedInitialism(token: string): boolean {
  return /^(?:\p{L}{1,3}\.)+\p{L}{1,3}\.?$/u.test(token);
}

function isSuffix(token: string, precededByComma: boolean, wordsBeforeComma: number, minWordsBeforeComma: number): boolean {
  if (isDottedInitialism(token)) {
    return true;
  }
  const form = bareForm(token);
  if (SUFFIXES.has(form)) {
    return true;
  }
  if (!SUFFIXES_NEEDING_DOTS_OR_COMMA.has(form)) {
    return false;
  }
  return /\p{L}\.\p{L}/u.test(token) || (precededByComma && wordsBeforeComma >= minWordsBeforeComma);
}

/** Bare `MA`, `MS`, or `MBA` stay unless dotted or after a comma, because Ma and Mba are also surnames. */
function stripTrailingSuffixes(tokens: string[], minWordsBeforeComma: number): void {
  for (;;) {
    while (tokens.at(-1) === COMMA) {
      tokens.pop();
    }
    const last = tokens.at(-1);
    if (last === undefined) {
      return;
    }
    const precededByComma = tokens.at(-2) === COMMA;
    const wordsBeforeComma = precededByComma ? countWords(tokens.slice(0, -2)) : 0;
    if (!isSuffix(last, precededByComma, wordsBeforeComma, minWordsBeforeComma)) {
      return;
    }
    tokens.pop();
  }
}

function stripLeadingTitles(words: string[], minRemaining: number): void {
  while (words.length > minRemaining && LEADING_TITLES.has(bareForm(words[0] ?? ""))) {
    words.shift();
  }
}

/** Absorption never reaches index 0, so `Di Chen` keeps `Di` as the given name. */
function familyStartIndex(words: readonly string[]): number {
  let start = words.length - 1;
  let absorbed = true;
  while (absorbed) {
    absorbed = false;
    for (const phrase of PARTICLE_PHRASES) {
      const phraseStart = start - phrase.length;
      if (phraseStart < 1) {
        continue;
      }
      if (phrase.every((part, offset) => bareForm(words[phraseStart + offset] ?? "") === part)) {
        start = phraseStart;
        absorbed = true;
        break;
      }
    }
  }
  return start;
}

function buildParsedName(given: string, middles: readonly string[], familyWords: readonly string[]): ParsedName | null {
  const family = familyWords.join(" ");
  const givenKey = nameKey(given);
  const familyKey = nameKey(family);
  if (givenKey === "" || familyKey === "") {
    return null;
  }
  const familyParts = family.split(/[\s\-\u2010-\u2015]+/).filter((part) => nameKey(part) !== "");
  const familyFinal = familyParts.at(-1) ?? family;
  return {
    given,
    middles: [...middles],
    family,
    familyFinal,
    display: [given, ...middles, family].join(" "),
    givenKey,
    middleKeys: middles.map(nameKey),
    familyKey,
    familyFinalKey: nameKey(familyFinal),
  };
}

/**
 * Parses one instructor as shown in a Banner cell, e.g. `John A. Smith, Jr. (Primary)`.
 * Returns null for placeholders and for text that does not hold both a given and a family name.
 */
export function parseInstructor(raw: string): ParsedName | null {
  const text = cleanText(raw);
  if (isPlaceholder(text)) {
    return null;
  }
  const tokens = tokenize(dropParentheticals(text).replace(/\b(Ph|Ed)\.\s+D\b\.?/gi, "$1.D."));
  stripTrailingSuffixes(tokens, 2);

  const commaIndex = tokens.indexOf(COMMA);
  if (commaIndex !== -1 && tokens.indexOf(COMMA, commaIndex + 1) === -1) {
    const familyWords = tokens.slice(0, commaIndex);
    const givenWords = tokens.slice(commaIndex + 1);
    stripLeadingTitles(givenWords, 1);
    const [given, ...middles] = givenWords;
    if (familyWords.length > 0 && given !== undefined) {
      return buildParsedName(given, middles, familyWords);
    }
  }

  const words = tokens.filter((token) => token !== COMMA);
  stripLeadingTitles(words, 2);
  const [given] = words;
  if (given === undefined || words.length < 2) {
    return null;
  }
  const familyStart = familyStartIndex(words);
  return buildParsedName(given, words.slice(1, familyStart), words.slice(familyStart));
}

/** Family-name key for a Rate My Professors `lastName` field, which can carry its own suffix. */
export function rmpFamilyKey(lastName: string): string {
  const tokens = tokenize(dropParentheticals(cleanText(lastName)));
  stripTrailingSuffixes(tokens, 1);
  return nameKey(tokens.filter((token) => token !== COMMA).join(" "));
}

export function rmpNameKeys(firstName: string, lastName: string): PersonKeys | null {
  const givenWords = tokenize(dropParentheticals(cleanText(firstName)).replace(/"[^"]*"|“[^”]*”/g, " "))
    .filter((token) => token !== COMMA);
  stripLeadingTitles(givenWords, 1);
  const [given, ...middles] = givenWords;
  const familyKey = rmpFamilyKey(lastName);
  if (given === undefined || familyKey === "") {
    return null;
  }
  return { givenKey: nameKey(given), middleKeys: middles.map(nameKey), familyKey };
}

function isTrimmable(char: string | undefined): boolean {
  return char !== undefined && SEGMENT_TRIM.test(char);
}

function pushSegment(segments: InstructorSegment[], text: string, from: number, to: number): void {
  let start = from;
  let end = to;
  while (start < end && isTrimmable(text[start])) {
    start += 1;
  }
  while (end > start && isTrimmable(text[end - 1])) {
    end -= 1;
  }
  if (end > start) {
    segments.push({ text: text.slice(start, end), start, end });
  }
}

function startsAnotherInstructor(text: string, from: number): boolean {
  let index = from;
  while (index < text.length && isTrimmable(text[index])) {
    index += 1;
  }
  return index < text.length && text[index] !== "(";
}

function countNameWords(text: string): number {
  return text.split(/[\s,]+/).filter((word) => /\p{L}/u.test(word)).length;
}

/**
 * Splits one text node that may hold several instructors. Splits on `;`, newlines, and right after a
 * parenthetical such as `(Primary)` when another multi-word name follows. A comma alone never splits.
 * A nickname in parentheses stays inside the name (`John (Jack) Smith`, `Mary Ann (Annie) Smith`).
 * Offsets index into `text`, so a caller can split a DOM text node at `end`.
 * A Banner cell is not one text node: walk `a.instructor-contact-link` children. `<br>` is not in
 * `textContent`, so co-teachers separated only by a break fuse if this is given the whole cell.
 */
export function instructorSegments(text: string): InstructorSegment[] {
  const segments: InstructorSegment[] = [];
  let segmentStart = 0;
  let depth = 0;
  let openIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      if (depth === 0) {
        openIndex = index;
      }
      depth += 1;
    } else if (char === ")" && depth > 0) {
      depth -= 1;
      if (
        depth === 0 &&
        startsAnotherInstructor(text, index + 1) &&
        countNameWords(text.slice(segmentStart, openIndex)) >= 2 &&
        countNameWords(text.slice(index + 1)) >= 2
      ) {
        pushSegment(segments, text, segmentStart, index + 1);
        segmentStart = index + 1;
      }
    } else if ((char === ";" || char === "\n" || char === "\r") && depth === 0) {
      pushSegment(segments, text, segmentStart, index);
      segmentStart = index + 1;
    }
  }
  pushSegment(segments, text, segmentStart, text.length);
  return segments;
}

export function splitInstructorText(text: string): string[] {
  return instructorSegments(text).map((segment) => segment.text);
}

const ELEMENT_NODE = 1;

/** Structural view of a Banner instructor cell. No href, banner id, or term is read. */
export interface InstructorCellNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  className?: string;
  childNodes?: ArrayLike<InstructorCellNode>;
}

function isInstructorAnchor(node: InstructorCellNode): boolean {
  if (node.nodeType !== ELEMENT_NODE || node.nodeName.toUpperCase() !== "A" || typeof node.className !== "string") {
    return false;
  }
  return node.className.split(/\s+/).includes("instructor-contact-link");
}

/**
 * Instructor names in one cell. Banner puts each person in `a.instructor-contact-link`, then a text
 * node (` (Primary)` or a single space) and a `<br>`. Those siblings are not part of the name.
 * An empty cell, or a placeholder with no link, returns nothing. Plain text is used only when the
 * cell has no instructor link.
 */
export function instructorTextsFromCell(cell: InstructorCellNode): string[] {
  const children = cell.childNodes === undefined ? [] : Array.from(cell.childNodes);
  let sawAnchor = false;
  const names: string[] = [];
  for (const child of children) {
    if (!isInstructorAnchor(child)) {
      continue;
    }
    sawAnchor = true;
    const text = child.textContent ?? "";
    if (!isPlaceholder(text)) {
      names.push(text);
    }
  }
  if (sawAnchor) {
    return names;
  }
  const text = cell.textContent ?? "";
  if (isPlaceholder(text)) {
    return [];
  }
  return splitInstructorText(text);
}
