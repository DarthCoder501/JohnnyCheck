import { cleanText, foldDiacritics } from "./normalize";

const COLLEGE_CODE_SUFFIX = /\s+[-\u2013\u2014]\s+[\p{L}&.]{2,6}$/u;

const STOPWORDS: ReadonlySet<string> = new Set(["a", "an", "and", "amp", "for", "in", "of", "on", "the", "to", "with"]);

const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "science",
  "study",
  "general",
  "department",
  "dept",
  "program",
  "intro",
  "introduction",
  "topic",
  "special",
]);

const ABBREVIATIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["cs", ["computer", "science"]],
  ["comp", ["computer"]],
  ["sci", ["science"]],
  ["acct", ["accounting"]],
  ["acctg", ["accounting"]],
  ["hist", ["history"]],
  ["math", ["mathematics"]],
  ["maths", ["mathematics"]],
  ["econ", ["economics"]],
  ["psych", ["psychology"]],
  ["bio", ["biology"]],
  ["chem", ["chemistry"]],
  ["phys", ["physics"]],
  ["engl", ["english"]],
  ["lit", ["literature"]],
  ["phil", ["philosophy"]],
  ["theo", ["theology"]],
  ["soc", ["sociology"]],
  ["govt", ["government"]],
  ["intl", ["international"]],
  ["info", ["information"]],
  ["mgmt", ["management"]],
  ["mgt", ["management"]],
  ["mktg", ["marketing"]],
  ["fin", ["finance"]],
  ["stat", ["statistics"]],
  ["stats", ["statistics"]],
  ["educ", ["education"]],
]);

const UMBRELLA_DEPARTMENTS: ReadonlySet<string> = new Set([
  "business",
  "business administration",
  "science",
  "sciences",
  "humanities",
  "liberal arts",
  "liberal studies",
  "arts sciences",
  "social science",
  "social sciences",
  "natural sciences",
  "general",
  "general studies",
  "interdisciplinary studies",
  "not specified",
  "other",
]);

/**
 * Lowercased, punctuation-free subject text with a trailing college code dropped:
 * `COMPUTER SCIENCE - CCPS` becomes `computer science`, `PHARMACY - PHARMD` becomes `pharmacy`.
 */
export function normalizeSubject(text: string | null | undefined): string | null {
  if (text == null) {
    return null;
  }
  const normalized = foldDiacritics(cleanText(text).replace(COLLEGE_CODE_SUFFIX, ""))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’ʼ`.]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized === "" ? null : normalized;
}

function singular(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

/** Tokens that carry department meaning: stopwords and generic words removed, abbreviations expanded. */
export function subjectTokens(text: string | null | undefined): string[] {
  const normalized = normalizeSubject(text);
  if (normalized === null) {
    return [];
  }
  const tokens = new Set<string>();
  for (const word of normalized.split(" ")) {
    if (STOPWORDS.has(word)) {
      continue;
    }
    for (const expanded of ABBREVIATIONS.get(word) ?? [word]) {
      const token = singular(expanded);
      if (!GENERIC_TOKENS.has(token)) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

/** Departments such as `Business` or `Arts & Sciences` that cover too much to contradict a subject. */
export function isUmbrellaDepartment(department: string | null | undefined): boolean {
  const normalized = normalizeSubject(department);
  if (normalized === null) {
    return false;
  }
  const phrase = normalized
    .split(" ")
    .filter((word) => !STOPWORDS.has(word))
    .join(" ");
  return UMBRELLA_DEPARTMENTS.has(phrase);
}

export function subjectOverlap(subject: string | null | undefined, department: string | null | undefined): number {
  const departmentTokens = new Set(subjectTokens(department));
  return subjectTokens(subject).filter((token) => departmentTokens.has(token)).length;
}

export type SubjectAgreement = "match" | "conflict" | "unknown";

export interface SubjectComparison {
  agreement: SubjectAgreement;
  overlap: number;
}

export function compareSubject(
  subject: string | null | undefined,
  department: string | null | undefined,
): SubjectComparison {
  if (subjectTokens(subject).length === 0 || isUmbrellaDepartment(department) || subjectTokens(department).length === 0) {
    return { agreement: "unknown", overlap: 0 };
  }
  const overlap = subjectOverlap(subject, department);
  return overlap > 0 ? { agreement: "match", overlap } : { agreement: "conflict", overlap: 0 };
}
