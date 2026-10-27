import { resolveCampus } from "./campus";
import {
  FETCHES_PER_SCHOOL,
  MAX_ITEM_CAMPUS_LENGTH,
  MAX_ITEM_KEY_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_SUBJECT_LENGTH,
  MAX_UPSTREAM_FETCHES,
  type RatingRequestItem,
  type RatingsRequest,
} from "./contract";
import { isBoundedString, isRecord } from "./guards";

type CampusCarrier = Pick<RatingRequestItem, "campus">;

/** 48 fetches divided by four fetches per school. Queens is largest because it searches two schools. */
export function batchSizeFor(campusText: string | null | undefined): number {
  const schools = resolveCampus(campusText).schools.length;
  return Math.floor(MAX_UPSTREAM_FETCHES / (schools * FETCHES_PER_SCHOOL));
}

/** A request is capped at the smallest campus size in it. */
export function batchLimit(items: readonly CampusCarrier[]): number {
  return items.reduce((limit, item) => Math.min(limit, batchSizeFor(item.campus)), batchSizeFor("Queens"));
}

/** Items that share a batch size travel together, in page order. */
export function chunkRequestItems<T extends CampusCarrier>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  const openChunks = new Map<number, T[]>();
  for (const item of items) {
    const size = batchSizeFor(item.campus);
    let chunk = openChunks.get(size);
    if (!chunk) {
      chunk = [];
      openChunks.set(size, chunk);
      chunks.push(chunk);
    }
    chunk.push(item);
    if (chunk.length === size) {
      openChunks.delete(size);
    }
  }
  return chunks;
}

export type RatingsRequestParse =
  | { ok: true; request: RatingsRequest }
  | { ok: false; error: string };

function parseOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    return undefined;
  }
  return value;
}

function parseItem(value: unknown): RatingRequestItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const { key, name } = value;
  const campus = parseOptionalText(value.campus, MAX_ITEM_CAMPUS_LENGTH);
  const subject = parseOptionalText(value.subject, MAX_ITEM_SUBJECT_LENGTH);
  if (
    !isBoundedString(key, MAX_ITEM_KEY_LENGTH) ||
    typeof name !== "string" ||
    name.length > MAX_ITEM_NAME_LENGTH ||
    campus === undefined ||
    subject === undefined
  ) {
    return null;
  }
  return { key, name, campus, subject };
}

/** Validates a `POST /v1/ratings` body, including the per-request batch limits. */
export function parseRatingsRequest(body: unknown): RatingsRequestParse {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return { ok: false, error: "Body must be an object with an items array." };
  }
  if (body.items.length === 0) {
    return { ok: false, error: "items must not be empty." };
  }
  const maxBatch = batchSizeFor("Queens");
  if (body.items.length > maxBatch) {
    return { ok: false, error: `At most ${maxBatch} items fit in one request.` };
  }
  const items: RatingRequestItem[] = [];
  for (const value of body.items) {
    const item = parseItem(value);
    if (!item) {
      return { ok: false, error: "Each item needs a key and name string plus campus and subject (string or null)." };
    }
    items.push(item);
  }
  const limit = batchLimit(items);
  if (items.length > limit) {
    return { ok: false, error: `At most ${limit} items fit in this request.` };
  }
  return { ok: true, request: { items } };
}
