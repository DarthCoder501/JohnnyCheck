const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

const ENTITY_PATTERN = /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi;

const LETTERS_WITHOUT_DECOMPOSITION: ReadonlyMap<string, string> = new Map([
  ["ø", "o"],
  ["Ø", "O"],
  ["ł", "l"],
  ["Ł", "L"],
  ["đ", "d"],
  ["Đ", "D"],
  ["ð", "d"],
  ["Ð", "D"],
  ["þ", "th"],
  ["Þ", "Th"],
  ["ß", "ss"],
  ["æ", "ae"],
  ["Æ", "Ae"],
  ["œ", "oe"],
  ["Œ", "Oe"],
  ["ı", "i"],
]);

const UNDECOMPOSED_PATTERN = /[øØłŁđĐðÐþÞßæÆœŒı]/g;

function decodeEntity(match: string, body: string): string {
  if (body.startsWith("#")) {
    const isHex = body[1] === "x" || body[1] === "X";
    const codePoint = Number.parseInt(
      body.slice(isHex ? 2 : 1),
      isHex ? 16 : 10,
    );
    if (
      !Number.isInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff
    ) {
      return match;
    }
    return String.fromCodePoint(codePoint);
  }
  return NAMED_ENTITIES.get(body.toLowerCase()) ?? match;
}

/** Banner double-escapes some text, so a cell can literally read `DATA SECURITY &amp; CRYPTOGRAPHY`. */
export function decodeEntities(text: string): string {
  let current = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = current.replace(ENTITY_PATTERN, decodeEntity);
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

export function collapseWhitespace(text: string): string {
  return text.replace(/[\s\u200b-\u200d]+/g, " ").trim();
}

export function cleanText(text: string): string {
  return collapseWhitespace(decodeEntities(text));
}

export function foldDiacritics(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(
      UNDECOMPOSED_PATTERN,
      (letter) => LETTERS_WITHOUT_DECOMPOSITION.get(letter) ?? letter,
    );
}

/** Comparison key: folded, lowercased, and stripped of everything but letters and digits. */
export function nameKey(text: string): string {
  return foldDiacritics(cleanText(text))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function dropParentheticals(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/\([^()]*\)/g, " ");
  } while (current !== previous);
  return collapseWhitespace(current.replace(/\(.*$/s, " ").replace(/\)/g, " "));
}
