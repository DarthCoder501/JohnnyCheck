import { ownCampusSchools, type CampusResolution } from "./campus";
import {
  TTL_RATED_SECONDS,
  TTL_SHORT_SECONDS,
  notListedResult,
  unavailableResult,
  type MatchConfidence,
  type MatchReason,
  type RatingResult,
} from "./contract";
import { isNonNegativeInteger } from "./guards";
import { rmpNameKeys, type ParsedName } from "./names";
import { areNicknames } from "./nicknames";
import { compareSubject } from "./subject";

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

const UNCERTAIN_REASONS: ReadonlySet<string> = new Set([
  "nickname",
  "middle_conflict",
  "surname_fallback",
  "department_conflict",
  "cross_campus",
  "unknown_campus",
  "same_name",
]);

interface Candidate {
  teacher: Teacher;
  reasons: MatchReason[];
  overlap: number;
  departmentConflict: boolean;
}

/** Both sides empty or equal is exact. One side only is `initial`. Differing middles are not exact. */
function exactReasons(
  banner: readonly string[],
  profile: readonly string[],
): MatchReason[] | null {
  const left = banner.filter((key) => key !== "");
  const right = profile.filter((key) => key !== "");
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? [] : ["initial"];
  }
  const same =
    left.length === right.length &&
    left.every((key, index) => key === right[index]);
  return same ? [] : null;
}

function scoredResult(
  teacher: Teacher,
  match: MatchConfidence,
  reasons: MatchReason[],
): RatingResult {
  if (
    !isNonNegativeInteger(teacher.legacyId) ||
    teacher.legacyId <= 0 ||
    !isNonNegativeInteger(teacher.numRatings)
  ) {
    return unavailableResult();
  }
  const fields = {
    match,
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

function candidatesFor(
  name: ParsedName,
  campus: CampusResolution,
  subjectText: string | null,
  teachers: readonly Teacher[],
): Candidate[] {
  const ownSchools = new Set(ownCampusSchools(campus));
  const full = [];
  const fallback = [];
  for (const teacher of teachers) {
    const keys = rmpNameKeys(teacher.firstName, teacher.lastName);
    if (keys === null) {
      continue;
    }
    const row = { teacher, keys };
    if (keys.familyKey === name.familyKey) {
      full.push(row);
    } else if (
      name.familyFinalKey !== name.familyKey &&
      keys.familyKey === name.familyFinalKey
    ) {
      fallback.push(row);
    }
  }
  const pool = full.length > 0 ? full : fallback;
  const candidates: Candidate[] = [];
  for (const row of pool) {
    const reasons: MatchReason[] = [];
    if (row.keys.givenKey !== name.givenKey) {
      if (!areNicknames(name.givenKey, row.keys.givenKey)) {
        continue;
      }
      reasons.push("nickname");
    }
    const middles = exactReasons(name.middleKeys, row.keys.middleKeys);
    if (middles === null) {
      reasons.push("middle_conflict");
    } else {
      reasons.push(...middles);
    }
    if (full.length === 0) {
      reasons.push("surname_fallback");
    }
    if (!ownSchools.has(row.teacher.schoolId)) {
      reasons.push("cross_campus");
    }
    const subject = compareSubject(subjectText, row.teacher.department);
    candidates.push({
      teacher: row.teacher,
      reasons,
      overlap: subject.overlap,
      departmentConflict: subject.agreement === "conflict",
    });
  }
  return candidates;
}

function choose(
  candidates: readonly Candidate[],
  campusKnown: boolean,
): Candidate | null {
  const ownCampus = candidates.filter(
    (candidate) => !candidate.reasons.includes("cross_campus"),
  );
  const pool = ownCampus.length > 0 ? ownCampus : candidates;
  const [first] = pool;
  if (first === undefined) {
    return null;
  }
  let bestOverlap = first.overlap;
  for (const candidate of pool) {
    if (candidate.overlap > bestOverlap) {
      bestOverlap = candidate.overlap;
    }
  }
  const top = pool.filter((candidate) => candidate.overlap === bestOverlap);
  const chosen = top[0];
  if (chosen === undefined) {
    return null;
  }
  if (!campusKnown && pool.length > 1) {
    return { ...chosen, reasons: [...chosen.reasons, "unknown_campus"] };
  }
  if (top.length > 1) {
    return { ...chosen, reasons: [...chosen.reasons, "same_name"] };
  }
  if (chosen.departmentConflict) {
    return { ...chosen, reasons: [...chosen.reasons, "department_conflict"] };
  }
  return chosen;
}

export function rankMatch(
  name: ParsedName,
  campus: CampusResolution,
  subjectText: string | null,
  teachers: readonly Teacher[],
): RatingResult {
  const chosen = choose(
    candidatesFor(name, campus, subjectText, teachers),
    campus.known,
  );
  if (chosen === null) {
    return notListedResult();
  }
  const match = chosen.reasons.some((reason) => UNCERTAIN_REASONS.has(reason))
    ? "possible"
    : "exact";
  return scoredResult(chosen.teacher, match, chosen.reasons);
}
