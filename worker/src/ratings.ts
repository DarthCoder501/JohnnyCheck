import { parseRatingsRequest } from "../../shared/src/batch";
import { resolveCampus } from "../../shared/src/campus";
import {
  MAX_UPSTREAM_FETCHES,
  isFreshStoredRating,
  notListedResult,
  toStoredRating,
  unavailableResult,
  type MatchReason,
  type RatingRequestItem,
  type RatingResult,
  type RatingsResponse,
} from "../../shared/src/contract";
import { localCacheKey } from "../../shared/src/keys";
import { parseInstructor, type ParsedName } from "../../shared/src/names";
import { rankMatch, type Teacher } from "../../shared/src/rank";
import { loadSchoolTeachers, type FetchBudget } from "./rmp";

export interface RatingsKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  cacheVersion: number;
  rmpToken: string;
  RATINGS: RatingsKv;
}

function isHit(result: RatingResult): result is Extract<RatingResult, { status: "rated" | "unrated" }> {
  return result.status === "rated" || result.status === "unrated";
}

function deduped(teachers: readonly Teacher[]): Teacher[] {
  const seen = new Set<number>();
  const unique: Teacher[] = [];
  for (const teacher of teachers) {
    if (seen.has(teacher.legacyId)) {
      continue;
    }
    seen.add(teacher.legacyId);
    unique.push(teacher);
  }
  return unique;
}

/** One person on an unfinished broad search is not unique across the four listings. */
function asPossible(result: Extract<RatingResult, { status: "rated" | "unrated" }>): RatingResult {
  if (result.match === "possible") {
    return result;
  }
  const reasons: MatchReason[] = result.reasons.includes("unknown_campus")
    ? result.reasons
    : [...result.reasons, "unknown_campus"];
  return { ...result, match: "possible", reasons };
}

async function readFresh(kv: RatingsKv, key: string, nowMs: number): Promise<RatingResult | null> {
  let raw: string | null;
  try {
    raw = await kv.get(key);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isFreshStoredRating(parsed, nowMs) || !isHit(parsed.result)) {
      return null;
    }
    return parsed.result;
  } catch {
    return null;
  }
}

async function storeHit(
  kv: RatingsKv,
  key: string,
  result: RatingResult,
  nowMs: number,
  written: Set<string>,
): Promise<void> {
  if (!isHit(result) || written.has(key)) {
    return;
  }
  const stored = toStoredRating(result, nowMs);
  if (stored === null) {
    return;
  }
  try {
    await kv.put(key, JSON.stringify(stored), { expirationTtl: result.ttlSeconds });
    written.add(key);
  } catch {
    console.warn(JSON.stringify({ event: "kv_write_failed" }));
  }
}

async function searchSchools(
  item: RatingRequestItem,
  name: ParsedName,
  env: Env,
  budget: FetchBudget,
  nowMs: number,
): Promise<RatingResult> {
  const campus = resolveCampus(item.campus);
  const gathered: Teacher[] = [];
  let sawTruncation = false;
  let ranked: RatingResult = notListedResult();
  for (const schoolId of campus.schools) {
    const loaded = await loadSchoolTeachers({
      name,
      campus,
      subject: item.subject,
      schoolId,
      token: env.rmpToken,
      fetch,
      nowMs,
      budget,
    });
    if (loaded === null) {
      if (!isHit(ranked)) {
        return unavailableResult();
      }
      return campus.known ? ranked : asPossible(ranked);
    }
    gathered.push(...loaded.teachers);
    const previous: RatingResult = ranked;
    ranked = rankMatch(name, campus, item.subject, deduped(gathered));
    if (loaded.truncated && isHit(previous) && !isHit(ranked)) {
      ranked = previous;
    }
    if (loaded.truncated) {
      sawTruncation = true;
    }
    if (campus.known && isHit(ranked) && ranked.match === "exact") {
      return ranked;
    }
  }
  if (!isHit(ranked) && sawTruncation) {
    return unavailableResult();
  }
  if (!campus.known && sawTruncation && isHit(ranked)) {
    return asPossible(ranked);
  }
  return ranked;
}

export async function handleRatings(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseRatingsRequest(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const nowMs = Date.now();
  const budget: FetchBudget = { used: 0, max: MAX_UPSTREAM_FETCHES };
  const written = new Set<string>();
  const results: Record<string, RatingResult> = {};
  const counts = { skipped: 0, rated: 0, unrated: 0, not_listed: 0, unavailable: 0 };

  for (const item of parsed.request.items) {
    const name = parseInstructor(item.name);
    if (name === null) {
      counts.skipped += 1;
      continue;
    }
    const key = localCacheKey(env.cacheVersion, item.campus, item.subject, name);
    const cached = await readFresh(env.RATINGS, key, nowMs);
    const result = cached ?? (await searchSchools(item, name, env, budget, nowMs));
    if (cached === null) {
      await storeHit(env.RATINGS, key, result, nowMs, written);
    }
    results[item.key] = result;
    counts[result.status] += 1;
  }

  console.log(
    JSON.stringify({
      event: "ratings",
      items: parsed.request.items.length,
      upstream: budget.used,
      ...counts,
    }),
  );

  const response: RatingsResponse = { cacheVersion: env.cacheVersion, results };
  return Response.json(response);
}
