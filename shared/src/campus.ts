import { ALL_SCHOOL_IDS, SCHOOL_IDS } from "./contract";
import { cleanText, foldDiacritics } from "./normalize";

export interface CampusResolution {
  known: boolean;
  /** Search order for the row. The first entry is the campus's own listing when `known`. */
  schools: readonly number[];
}

function resolution(known: boolean, schools: readonly number[]): CampusResolution {
  return Object.freeze({ known, schools: Object.freeze([...schools]) });
}

const QUEENS = resolution(true, [SCHOOL_IDS.queens, SCHOOL_IDS.generic]);
const STATEN_ISLAND = resolution(true, [SCHOOL_IDS.statenIsland, SCHOOL_IDS.queens, SCHOOL_IDS.generic]);
const MANHATTAN = resolution(true, [SCHOOL_IDS.manhattan, SCHOOL_IDS.queens, SCHOOL_IDS.generic]);
const UNKNOWN = resolution(false, ALL_SCHOOL_IDS);

/** Rome, `Online Learning`, a hidden Campus column, or any other text searches all four listings. */
export function resolveCampus(text: string | null | undefined): CampusResolution {
  if (text == null) {
    return UNKNOWN;
  }
  const folded = foldDiacritics(cleanText(text)).toLowerCase();
  if (/\b(queens|jamaica)\b/.test(folded)) {
    return QUEENS;
  }
  if (/\bstaten\b/.test(folded)) {
    return STATEN_ISLAND;
  }
  if (/\bmanhattan\b/.test(folded)) {
    return MANHATTAN;
  }
  return UNKNOWN;
}

/** School segment of a cache key: the campus's own listing id, or `_` when the campus is unknown. */
export function primarySchoolKey(campus: CampusResolution): string {
  const [primary] = campus.schools;
  return campus.known && primary !== undefined ? String(primary) : "_";
}

/** Listings that count as the row's own campus; the generic listing always does. */
export function ownCampusSchools(campus: CampusResolution): readonly number[] {
  const [primary] = campus.schools;
  if (!campus.known || primary === undefined) {
    return campus.schools;
  }
  return [primary, SCHOOL_IDS.generic];
}
