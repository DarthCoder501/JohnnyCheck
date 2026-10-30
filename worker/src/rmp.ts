import type { CampusResolution } from "../../shared/src/campus";
import {
  MAX_PAGES_PER_SURNAME_SCHOOL,
  SURNAME_PAGE_SIZE,
  UPSTREAM_CONCURRENCY,
  schoolGraphqlId,
  unavailableResult,
  type RatingResult,
} from "../../shared/src/contract";
import {
  isNullableNumber,
  isNonNegativeInteger,
  isRecord,
} from "../../shared/src/guards";
import { rmpFamilyKey, type ParsedName } from "../../shared/src/names";
import { rankMatch, type Teacher } from "../../shared/src/rank";

const RMP_GRAPHQL = "https://www.ratemyprofessors.com/graphql";
const UPSTREAM_BLOCK_MS = 5 * 60 * 1000;

/** Public pagination query (ratemyprofessors.com, 2026-10-26). `first: 5` on the initial page cannot ask for 100. */
const TEACHER_QUERY = `query TeacherSearchPaginationQuery($count: Int!, $cursor: String, $query: TeacherSearchQuery!) {
  search: newSearch {
    teachers(query: $query, first: $count, after: $cursor) {
      edges { node { legacyId firstName lastName department numRatings avgRating avgDifficulty wouldTakeAgainPercent school { name legacyId } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export interface FetchBudget {
  used: number;
  max: number;
}

export interface SurnameSearchInput {
  name: ParsedName;
  campus: CampusResolution;
  subject: string | null;
  schoolId: number;
  token: string;
  fetch: typeof fetch;
  nowMs?: number;
  budget?: FetchBudget;
}

interface Page {
  teachers: Teacher[];
  hasNextPage: boolean;
  cursor: string | null;
}

interface Loaded {
  teachers: Teacher[];
  truncated: boolean;
}

let blockedUntil = 0;
let active = 0;
const waiters: Array<() => void> = [];
const flights = new Map<string, Promise<Loaded | null>>();
const truncatedLoads = new Map<string, { until: number; loaded: Loaded }>();

export function resetSurnameIsolate(): void {
  blockedUntil = 0;
  active = 0;
  waiters.length = 0;
  flights.clear();
  truncatedLoads.clear();
}

function blockUpstream(nowMs: number, status: number, reason: string): void {
  blockedUntil = nowMs + UPSTREAM_BLOCK_MS;
  console.warn(
    JSON.stringify({
      event: "rmp_blocked",
      status,
      reason,
      ms: UPSTREAM_BLOCK_MS,
    }),
  );
}

function acquire(): Promise<void> {
  if (active < UPSTREAM_CONCURRENCY) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next !== undefined) {
    next();
  }
}

function optionalScore(value: unknown): number | null {
  return isNullableNumber(value) && (value === null || value >= 0)
    ? value
    : null;
}

function teacherFrom(value: unknown, schoolId: number): Teacher | null {
  if (
    !isRecord(value) ||
    typeof value.firstName !== "string" ||
    typeof value.lastName !== "string"
  ) {
    return null;
  }
  if (
    !isNonNegativeInteger(value.legacyId) ||
    value.legacyId <= 0 ||
    !isNonNegativeInteger(value.numRatings)
  ) {
    return null;
  }
  const school = isRecord(value.school) ? value.school : null;
  const listedSchool =
    school !== null &&
    isNonNegativeInteger(school.legacyId) &&
    school.legacyId > 0
      ? school.legacyId
      : schoolId;
  return {
    legacyId: value.legacyId,
    schoolId: listedSchool,
    firstName: value.firstName,
    lastName: value.lastName,
    department:
      typeof value.department === "string" && value.department !== ""
        ? value.department
        : null,
    schoolName:
      school !== null && typeof school.name === "string" ? school.name : "",
    numRatings: value.numRatings,
    quality: optionalScore(value.avgRating),
    difficulty: optionalScore(value.avgDifficulty),
    wouldTakeAgain: optionalScore(value.wouldTakeAgainPercent),
  };
}

function pageFrom(value: unknown, schoolId: number): Page | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !isRecord(value.data.search)
  ) {
    return null;
  }
  const connection = value.data.search.teachers;
  if (
    !isRecord(connection) ||
    !Array.isArray(connection.edges) ||
    !isRecord(connection.pageInfo)
  ) {
    return null;
  }
  const teachers: Teacher[] = [];
  for (const edge of connection.edges) {
    const teacher = teacherFrom(isRecord(edge) ? edge.node : null, schoolId);
    if (teacher !== null) {
      teachers.push(teacher);
    }
  }
  const endCursor = connection.pageInfo.endCursor;
  return {
    teachers,
    hasNextPage: connection.pageInfo.hasNextPage === true,
    cursor:
      typeof endCursor === "string" && endCursor !== "" ? endCursor : null,
  };
}

async function readPage(
  response: Response,
  schoolId: number,
  nowMs: number,
): Promise<Page | "blocked" | null> {
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 403 || type.toLowerCase().includes("text/html")) {
    blockUpstream(
      nowMs,
      response.status,
      response.status === 403 ? "forbidden" : "html",
    );
    await response.body?.cancel();
    return "blocked";
  }
  const text = await response.text();
  if (text.trimStart().startsWith("<")) {
    blockUpstream(nowMs, response.status, "html");
    return "blocked";
  }
  if (response.status !== 200) {
    return null;
  }
  try {
    return pageFrom(JSON.parse(text) as unknown, schoolId);
  } catch {
    return null;
  }
}

function reserveFetch(input: SurnameSearchInput): boolean {
  const budget = input.budget;
  if (budget === undefined) {
    return true;
  }
  if (budget.used >= budget.max) {
    return false;
  }
  budget.used += 1;
  return true;
}

async function fetchPage(
  input: SurnameSearchInput,
  text: string,
  cursor: string,
  nowMs: number,
): Promise<Page | "blocked" | null> {
  if (!reserveFetch(input)) {
    return null;
  }
  await acquire();
  try {
    // Workers fetch throws unless it is called with the global this.
    const response = await Reflect.apply(input.fetch, globalThis, [
      RMP_GRAPHQL,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.token}`,
        },
        body: JSON.stringify({
          operationName: "TeacherSearchPaginationQuery",
          query: TEACHER_QUERY,
          variables: {
            count: SURNAME_PAGE_SIZE,
            cursor,
            query: {
              text,
              schoolID: schoolGraphqlId(input.schoolId),
              fallback: true,
            },
          },
        }),
      },
    ]);
    return await readPage(response, input.schoolId, nowMs);
  } catch {
    return null;
  } finally {
    release();
  }
}

function loadSurname(
  input: SurnameSearchInput,
  text: string,
  nowMs: number,
): Promise<Loaded | null> {
  const key = `${input.schoolId}:${text}`;
  const remembered = truncatedLoads.get(key);
  if (remembered !== undefined) {
    if (nowMs < remembered.until) {
      return Promise.resolve(remembered.loaded);
    }
    truncatedLoads.delete(key);
  }
  const existing = flights.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const remember = (loaded: Loaded): Loaded => {
    if (loaded.truncated) {
      truncatedLoads.set(key, { until: nowMs + UPSTREAM_BLOCK_MS, loaded });
    }
    return loaded;
  };
  const pending = (async () => {
    const teachers: Teacher[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_PAGES_PER_SURNAME_SCHOOL; page += 1) {
      const loaded = await fetchPage(input, text, cursor, nowMs);
      if (loaded === "blocked" || loaded === null) {
        return null;
      }
      teachers.push(...loaded.teachers);
      const lastPage = page === MAX_PAGES_PER_SURNAME_SCHOOL - 1;
      if (!loaded.hasNextPage) {
        return { teachers, truncated: false };
      }
      if (lastPage || loaded.cursor === null) {
        return remember({ teachers, truncated: true });
      }
      cursor = loaded.cursor;
    }
    return remember({ teachers, truncated: true });
  })().finally(() => {
    if (flights.get(key) === pending) {
      flights.delete(key);
    }
  });
  flights.set(key, pending);
  return pending;
}

function hasFamilyHit(
  teachers: readonly Teacher[],
  familyKey: string,
): boolean {
  return teachers.some(
    (teacher) => rmpFamilyKey(teacher.lastName) === familyKey,
  );
}

/** Teachers from one school. The final-token query runs only after a completed full-family miss. */
export async function loadSchoolTeachers(
  input: SurnameSearchInput,
): Promise<Loaded | null> {
  const nowMs = input.nowMs ?? Date.now();
  if (nowMs < blockedUntil) {
    return null;
  }
  const full = await loadSurname(input, input.name.family, nowMs);
  if (full === null) {
    return null;
  }
  if (full.truncated) {
    return full;
  }
  const ranked = rankMatch(
    input.name,
    input.campus,
    input.subject,
    full.teachers,
  );
  const needsFinal =
    ranked.status === "not_listed" &&
    input.name.familyFinalKey !== input.name.familyKey &&
    !hasFamilyHit(full.teachers, input.name.familyKey);
  if (!needsFinal) {
    return full;
  }
  const finalToken = await loadSurname(input, input.name.familyFinal, nowMs);
  if (finalToken === null) {
    return null;
  }
  return {
    teachers: [...full.teachers, ...finalToken.teachers],
    truncated: finalToken.truncated,
  };
}

export async function searchSurname(
  input: SurnameSearchInput,
): Promise<RatingResult> {
  const loaded = await loadSchoolTeachers(input);
  if (loaded === null) {
    return unavailableResult();
  }
  const ranked = rankMatch(
    input.name,
    input.campus,
    input.subject,
    loaded.teachers,
  );
  if (loaded.truncated && ranked.status === "not_listed") {
    return unavailableResult();
  }
  return ranked;
}
