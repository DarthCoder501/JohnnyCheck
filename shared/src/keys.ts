import { primarySchoolKey, resolveCampus } from "./campus";
import type { PersonKeys } from "./names";
import { normalizeSubject } from "./subject";

export const RATING_KEY_PREFIX = "r";

const RATING_KEY_VERSION = /^r(\d+):/;

/** Subject segment of a cache key; `_` when the Subject Description column is hidden or blank. */
export function subjectKey(subjectText: string | null | undefined): string {
  return normalizeSubject(subjectText)?.replace(/ /g, "-") ?? "_";
}

/**
 * `r{cacheVersion}:{schoolId}:{subjectKey}:{familyKey}:{givenKey}:{middleKey}`.
 * The middle segment is `_` when the Banner name has none, so Joan E. and Joan L. do not share a row.
 */
export function localCacheKey(
  cacheVersion: number,
  campusText: string | null | undefined,
  subjectText: string | null | undefined,
  name: Pick<PersonKeys, "familyKey" | "givenKey" | "middleKeys">,
): string {
  const school = primarySchoolKey(resolveCampus(campusText));
  const middle = name.middleKeys.filter((key) => key !== "").join("-") || "_";
  return `${RATING_KEY_PREFIX}${cacheVersion}:${school}:${subjectKey(subjectText)}:${name.familyKey}:${name.givenKey}:${middle}`;
}

export function isRatingKey(key: string): boolean {
  return RATING_KEY_VERSION.test(key);
}

export function ratingKeyVersion(key: string): number | null {
  const digits = RATING_KEY_VERSION.exec(key)?.[1];
  return digits === undefined ? null : Number(digits);
}

export function withCacheVersion(key: string, cacheVersion: number): string {
  return key.replace(RATING_KEY_VERSION, `${RATING_KEY_PREFIX}${cacheVersion}:`);
}
