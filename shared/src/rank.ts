import { ownCampusSchools, type CampusResolution } from "./campus";
import {
  TTL_RATED_SECONDS,
  TTL_SHORT_SECONDS,
  notListedResult,
  unavailableResult,
  type MatchReason,
  type RatingResult,
} from "./contract";
import { isNonNegativeInteger } from "./guards";
import { rmpNameKeys, type ParsedName } from "./names";

/** A Rate My Professors teacher already loaded for this campus. `rankMatch` does not fetch. */
export interface Teacher {
  legacyId: number;
  schoolId: number;
  firstName: string;
  lastName: string;
  department: string | null;
  schoolName: string;
  numRatings: number;
  quality: number | null;
  difficulty: number | null;
  wouldTakeAgain: number | null;
}

/** Both sides empty or equal is exact. One side only is `initial`. Differing middles are not exact. */
function exactReasons(banner: readonly string[], profile: readonly string[]): MatchReason[] | null {
  const left = banner.filter((key) => key !== "");
  const right = profile.filter((key) => key !== "");
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? [] : ["initial"];
  }
  const same = left.length === right.length && left.every((key, index) => key === right[index]);
  return same ? [] : null;
}

function exactResult(teacher: Teacher, reasons: MatchReason[]): RatingResult {
  if (!isNonNegativeInteger(teacher.legacyId) || teacher.legacyId <= 0 || !isNonNegativeInteger(teacher.numRatings)) {
    return unavailableResult();
  }
  const fields = {
    match: "exact" as const,
    reasons,
    legacyId: teacher.legacyId,
    rmpName: `${teacher.firstName} ${teacher.lastName}`.trim(),
    department: teacher.department,
    schoolName: teacher.schoolName,
    numRatings: teacher.numRatings,
  };
  if (teacher.numRatings === 0) {
    return {
      ...fields,
      status: "unrated",
      quality: null,
      difficulty: null,
      wouldTakeAgain: null,
      ttlSeconds: TTL_SHORT_SECONDS,
    };
  }
  if (teacher.quality === null) {
    return unavailableResult();
  }
  return {
    ...fields,
    status: "rated",
    quality: teacher.quality,
    difficulty: teacher.difficulty,
    wouldTakeAgain: teacher.wouldTakeAgain,
    ttlSeconds: TTL_RATED_SECONDS,
  };
}

/** shortcut: subjectText and every non-unique family hit are ignored, worker-rank-possible */
export function rankMatch(
  name: ParsedName,
  campus: CampusResolution,
  subjectText: string | null,
  teachers: readonly Teacher[],
): RatingResult {
  void subjectText;
  const ownSchools = new Set(ownCampusSchools(campus));
  const familyHits = [];
  for (const teacher of teachers) {
    const keys = rmpNameKeys(teacher.firstName, teacher.lastName);
    if (keys !== null && keys.familyKey === name.familyKey) {
      familyHits.push({ teacher, ...keys });
    }
  }
  if (familyHits.length === 0) {
    return notListedResult();
  }
  const exactHits = [];
  for (const row of familyHits) {
    if (!ownSchools.has(row.teacher.schoolId) || row.givenKey !== name.givenKey) {
      continue;
    }
    const reasons = exactReasons(name.middleKeys, row.middleKeys);
    if (reasons !== null) {
      exactHits.push({ teacher: row.teacher, reasons });
    }
  }
  const [hit, another] = exactHits;
  if (hit === undefined || another !== undefined) {
    return unavailableResult();
  }
  return exactResult(hit.teacher, hit.reasons);
}
