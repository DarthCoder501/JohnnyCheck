import { cleanText, dropParentheticals, foldDiacritics } from "./normalize";

const PLACEHOLDER_PHRASES: ReadonlySet<string> = new Set([
  "tba",
  "tbd",
  "staff",
  "faculty",
  "to be announced",
  "to be determined",
  "n/a",
]);

const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  "tba",
  "tbd",
  "staff",
  "faculty",
]);

const BLANK_OR_DASHES = /^[\s\-\u2010-\u2015\u2212]*$/u;

/** True when the text names nobody: blank, only dashes, or a placeholder such as `TBA (Primary)`. */
export function isPlaceholder(text: string | null | undefined): boolean {
  if (text == null) {
    return true;
  }
  const withoutParentheticals = dropParentheticals(cleanText(text));
  if (BLANK_OR_DASHES.test(withoutParentheticals)) {
    return true;
  }
  const phrase = foldDiacritics(withoutParentheticals)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (PLACEHOLDER_PHRASES.has(phrase)) {
    return true;
  }
  const words = phrase.split(/[\s,;/]+/).filter((word) => word !== "");
  return words.length > 0 && words.every((word) => PLACEHOLDER_WORDS.has(word));
}
