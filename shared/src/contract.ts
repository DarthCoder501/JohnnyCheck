import {
  isFiniteNumber,
  isNonNegativeInteger,
  isNullableNumber,
  isNullableString,
  isRecord,
} from "./guards";

export const API_PATHS = {
  ratings: "/v1/ratings",
  version: "/v1/version",
} as const;

export const CLIENT_ID_HEADER = "X-Client-ID";

export const SCHOOL_IDS = {
  queens: 842,
  statenIsland: 3991,
  manhattan: 4909,
  generic: 17687,
} as const;

export type SchoolLegacyId = (typeof SCHOOL_IDS)[keyof typeof SCHOOL_IDS];

export const ALL_SCHOOL_IDS: readonly SchoolLegacyId[] = Object.freeze([
  SCHOOL_IDS.queens,
  SCHOOL_IDS.statenIsland,
  SCHOOL_IDS.manhattan,
  SCHOOL_IDS.generic,
]);

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Ascii(text: string): string {
  let output = "";
  for (let index = 0; index < text.length; index += 3) {
    const remaining = text.length - index;
    const triple =
      (text.charCodeAt(index) << 16) |
      ((remaining > 1 ? text.charCodeAt(index + 1) : 0) << 8) |
      (remaining > 2 ? text.charCodeAt(index + 2) : 0);
    output += BASE64_ALPHABET.charAt((triple >> 18) & 63);
    output += BASE64_ALPHABET.charAt((triple >> 12) & 63);
    output += remaining > 1 ? BASE64_ALPHABET.charAt((triple >> 6) & 63) : "=";
    output += remaining > 2 ? BASE64_ALPHABET.charAt(triple & 63) : "=";
  }
  return output;
}

/** Relay-style node id that the Rate My Professors GraphQL API expects for `schoolID`. */
export function schoolGraphqlId(legacyId: number): string {
  return base64Ascii(`School-${legacyId}`);
}

export const SCHOOL_GRAPHQL_IDS: Readonly<Record<SchoolLegacyId, string>> =
  Object.freeze({
    [SCHOOL_IDS.queens]: schoolGraphqlId(SCHOOL_IDS.queens),
    [SCHOOL_IDS.statenIsland]: schoolGraphqlId(SCHOOL_IDS.statenIsland),
    [SCHOOL_IDS.manhattan]: schoolGraphqlId(SCHOOL_IDS.manhattan),
    [SCHOOL_IDS.generic]: schoolGraphqlId(SCHOOL_IDS.generic),
  });

export function rmpProfileUrl(legacyId: number): string {
  return `https://www.ratemyprofessors.com/professor/${legacyId}`;
}

export const TTL_RATED_SECONDS = 7 * 24 * 60 * 60;
export const TTL_SHORT_SECONDS = 24 * 60 * 60;
export const VERSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SURNAME_PAGE_SIZE = 100;
export const MAX_PAGES_PER_SURNAME_SCHOOL = 2;
export const UPSTREAM_CONCURRENCY = 6;
/** Two pages for the family name and two for the final token. */
export const FETCHES_PER_SCHOOL = MAX_PAGES_PER_SURNAME_SCHOOL * 2;
/** Free plan allows 50 external fetches. Two are left unused. */
export const MAX_UPSTREAM_FETCHES = 48;

export const MAX_ITEM_KEY_LENGTH = 300;
export const MAX_ITEM_NAME_LENGTH = 200;
export const MAX_ITEM_CAMPUS_LENGTH = 100;
export const MAX_ITEM_SUBJECT_LENGTH = 200;

export type MatchConfidence = "exact" | "possible";

export type MatchReason =
  | "initial"
  | "nickname"
  | "given_prefix"
  | "given_spelling"
  | "middle_conflict"
  | "surname_fallback"
  | "department_conflict"
  | "cross_campus"
  | "unknown_campus"
  | "same_name";

export interface RunnerUp {
  rmpName: string;
  department: string | null;
  schoolName: string;
}

interface MatchedFields {
  match: MatchConfidence;
  reasons: MatchReason[];
  legacyId: number;
  rmpName: string;
  department: string | null;
  schoolName: string;
  numRatings: number;
  runnerUp?: RunnerUp;
  ttlSeconds: number;
}

export interface RatedResult extends MatchedFields {
  status: "rated";
  quality: number;
  difficulty: number | null;
  wouldTakeAgain: number | null;
}

export interface UnratedResult extends MatchedFields {
  status: "unrated";
  quality: null;
  difficulty: null;
  wouldTakeAgain: null;
}

export interface NotListedResult {
  status: "not_listed";
  ttlSeconds: number;
}

export interface UnavailableResult {
  status: "unavailable";
}

export type RatingResult =
  | RatedResult
  | UnratedResult
  | NotListedResult
  | UnavailableResult;
export type RatingStatus = RatingResult["status"];
export type CacheableRatingResult = Exclude<RatingResult, UnavailableResult>;
export type MatchedRatingResult = RatedResult | UnratedResult;

export interface RatingRequestItem {
  key: string;
  name: string;
  campus: string | null;
  subject: string | null;
}

export interface RatingsRequest {
  items: RatingRequestItem[];
}

export interface RatingsResponse {
  cacheVersion: number;
  results: Record<string, RatingResult>;
}

export interface VersionResponse {
  cacheVersion: number;
}

export const STORAGE_KEYS = {
  cacheVersion: "meta:cacheVersion",
  clientId: "meta:clientId",
  enabled: "enabled",
  versionCheckedAt: "meta:versionCheckedAt",
} as const;

export const STORAGE_AREAS = {
  cacheVersion: "local",
  clientId: "local",
  enabled: "sync",
  versionCheckedAt: "session",
  ratings: "local",
} as const;

export const ENABLED_DEFAULT = true;

export interface StoredRating {
  result: CacheableRatingResult;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export function notListedResult(): NotListedResult {
  return { status: "not_listed", ttlSeconds: TTL_SHORT_SECONDS };
}

export function unavailableResult(): UnavailableResult {
  return { status: "unavailable" };
}

export function isCacheable(
  result: RatingResult,
): result is CacheableRatingResult {
  return result.status !== "unavailable";
}

export function toStoredRating(
  result: RatingResult,
  nowMs: number,
): StoredRating | null {
  if (!isCacheable(result) || !isRatingResult(result)) {
    return null;
  }
  return { result, expiresAt: nowMs + result.ttlSeconds * 1000 };
}

function isRunnerUp(value: unknown): value is RunnerUp {
  return (
    isRecord(value) &&
    typeof value.rmpName === "string" &&
    isNullableString(value.department) &&
    typeof value.schoolName === "string"
  );
}

function isTtl(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

const EXACT_FORBIDDEN_REASONS: ReadonlySet<string> = new Set([
  "nickname",
  "given_prefix",
  "middle_conflict",
  "surname_fallback",
  "department_conflict",
  "cross_campus",
  "unknown_campus",
  "same_name",
]);

function countAgrees(
  status: "rated" | "unrated",
  numRatings: unknown,
): boolean {
  return status === "rated"
    ? isNonNegativeInteger(numRatings) && numRatings > 0
    : numRatings === 0;
}

/**
 * Accepts reason codes this build does not know. Known uncertainty reasons cannot be `exact`:
 * an exact surname fallback or nickname would cache the wrong person for seven days.
 */
export function isRatingResult(value: unknown): value is RatingResult {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.status) {
    case "unavailable":
      return true;
    case "not_listed":
      return isTtl(value.ttlSeconds);
    case "rated":
    case "unrated": {
      const matched =
        (value.match === "exact" || value.match === "possible") &&
        Array.isArray(value.reasons) &&
        value.reasons.every((reason) => typeof reason === "string") &&
        isNonNegativeInteger(value.legacyId) &&
        value.legacyId > 0 &&
        typeof value.rmpName === "string" &&
        isNullableString(value.department) &&
        typeof value.schoolName === "string" &&
        isNonNegativeInteger(value.numRatings) &&
        isTtl(value.ttlSeconds) &&
        (value.runnerUp === undefined || isRunnerUp(value.runnerUp));
      if (!matched || !countAgrees(value.status, value.numRatings)) {
        return false;
      }
      if (value.match === "exact" && Array.isArray(value.reasons)) {
        if (
          value.reasons.some(
            (reason) =>
              typeof reason === "string" && EXACT_FORBIDDEN_REASONS.has(reason),
          )
        ) {
          return false;
        }
      }
      return value.status === "rated"
        ? isFiniteNumber(value.quality) &&
            isNullableNumber(value.difficulty) &&
            isNullableNumber(value.wouldTakeAgain)
        : value.quality === null &&
            value.difficulty === null &&
            value.wouldTakeAgain === null;
    }
    default:
      return false;
  }
}

/** Drops individual results that fail validation; the caller treats a missing key as unavailable. */
export function parseRatingsResponse(value: unknown): RatingsResponse | null {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.cacheVersion) ||
    !isRecord(value.results)
  ) {
    return null;
  }
  const results = Object.fromEntries(
    Object.entries(value.results).filter(
      (entry): entry is [string, RatingResult] => isRatingResult(entry[1]),
    ),
  );
  return { cacheVersion: value.cacheVersion, results };
}

export function parseVersionResponse(value: unknown): VersionResponse | null {
  if (!isRecord(value) || !isNonNegativeInteger(value.cacheVersion)) {
    return null;
  }
  return { cacheVersion: value.cacheVersion };
}

export function isStoredRating(value: unknown): value is StoredRating {
  return (
    isRecord(value) &&
    isFiniteNumber(value.expiresAt) &&
    isRatingResult(value.result) &&
    isCacheable(value.result)
  );
}

export function isFreshStoredRating(
  value: unknown,
  nowMs: number,
): value is StoredRating {
  return isStoredRating(value) && value.expiresAt > nowMs;
}
