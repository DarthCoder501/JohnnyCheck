import { resolveCampus } from "./campus";
import {
  BATCH_SIZE_KNOWN_CAMPUS,
  BATCH_SIZE_UNKNOWN_CAMPUS,
  MAX_ITEM_CAMPUS_LENGTH,
  MAX_ITEM_KEY_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_SUBJECT_LENGTH,
  type RatingRequestItem,
  type RatingsRequest,
} from "./contract";
import { isBoundedString, isRecord } from "./guards";

type CampusCarrier = Pick<RatingRequestItem, "campus">;

export function batchSizeFor(campusText: string | null | undefined): number {
  return resolveCampus(campusText).known ? BATCH_SIZE_KNOWN_CAMPUS : BATCH_SIZE_UNKNOWN_CAMPUS;
}

/** A request holding any unknown-campus item is capped at the smaller batch size. */
export function batchLimit(items: readonly CampusCarrier[]): number {
  return items.reduce((limit, item) => Math.min(limit, batchSizeFor(item.campus)), BATCH_SIZE_KNOWN_CAMPUS);
}

/** Known-campus items travel in chunks of 8 and unknown-campus items in chunks of 4, in page order. */
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
    !isBoundedString(name, MAX_ITEM_NAME_LENGTH) ||
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
  if (body.items.length > BATCH_SIZE_KNOWN_CAMPUS) {
    return { ok: false, error: `At most ${BATCH_SIZE_KNOWN_CAMPUS} items fit in one request.` };
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
