import {
  isCacheable,
  isRatingResult,
  parseRatingsResponse,
  toStoredRating,
  type RatingRequestItem,
  type RatingResult,
  type RatingsResponse,
} from "../../shared/src/contract";
import { type ChipPaint } from "./chip";

export interface LocalRatings {
  get(keys: readonly string[]): Promise<{ [key: string]: unknown }>;
  set(items: { [key: string]: unknown }): Promise<void>;
}

export interface Paintable {
  key: string;
  item: RatingRequestItem;
  cell: HTMLElement;
  hasChip(): boolean;
  show(paint: ChipPaint, refresh?: boolean): void;
}

/** A stored `not_listed`, `rated`, or `unrated` entry that has not expired. */
export function storedResult(value: unknown, nowMs: number): RatingResult | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("expiresAt" in value) || !("result" in value)) return null;
  const { expiresAt, result } = value;
  if (typeof expiresAt !== "number" || expiresAt <= nowMs) return null;
  if (!isRatingResult(result) || !isCacheable(result)) return null;
  return result;
}

/**
 * Read local hits and misses, then paint once.
 * shortcut: a chip already on screen stays until Banner replaces the cell, including after its entry expires
 */
export async function paintSlots(
  slots: readonly Paintable[],
  local: LocalRatings | undefined,
  deliver: ((message: { items: RatingRequestItem[] }) => void) | undefined,
  stale: () => boolean,
  wake?: () => void,
): Promise<Map<string, Paintable[]>> {
  if (stale()) return new Map();
  const keys = [...new Set(slots.map((slot) => slot.key))];
  let stored: { [key: string]: unknown } = {};
  if (local !== undefined && keys.length > 0) {
    try {
      stored = await local.get(keys);
    } catch {
      stored = {};
    }
    if (stale()) return new Map();
  }
  const pending = new Map<string, Paintable[]>();
  const misses: RatingRequestItem[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const slot of slots) {
    if (!slot.cell.isConnected) continue;
    const hit = storedResult(stored[slot.key], now);
    const fresh = !slot.hasChip();
    if (fresh) slot.show(hit ?? "loading");
    if (hit !== null) continue;
    const waiting = pending.get(slot.key) ?? [];
    waiting.push(slot);
    pending.set(slot.key, waiting);
    if (!fresh || seen.has(slot.key)) continue;
    seen.add(slot.key);
    misses.push(slot.item);
  }
  if (misses.length > 0 && deliver !== undefined) deliver({ items: misses });
  if (!stale()) wake?.();
  return pending;
}

export function paintReply(
  reply: RatingsResponse,
  cacheVersion: number,
  pending: ReadonlyMap<string, readonly Paintable[]>,
  local: LocalRatings | undefined,
  nowMs: number,
): void {
  if (reply.cacheVersion !== cacheVersion) return;
  const items: { [key: string]: unknown } = {};
  for (const [key, result] of Object.entries(reply.results)) {
    if (!isRatingResult(result)) continue;
    for (const slot of pending.get(key) ?? []) {
      if (!slot.cell.isConnected) continue;
      slot.show(result, true);
    }
    const stored = toStoredRating(result, nowMs);
    if (stored !== null) items[key] = stored;
  }
  if (local === undefined || Object.keys(items).length === 0) return;
  void local.set(items).catch(() => undefined);
}

export function pageLocal(): LocalRatings | undefined {
  if (typeof chrome === "undefined" || chrome.storage?.local === undefined) return undefined;
  const area = chrome.storage.local;
  return {
    get: (keys) => area.get([...keys]),
    set: (items) => area.set(items),
  };
}

/** Asks the service worker to check `/v1/version` without waiting on the paint. */
export function pageWake(): (() => void) | undefined {
  if (typeof chrome === "undefined" || chrome.runtime?.sendMessage === undefined) return undefined;
  return () => {
    void chrome.runtime.sendMessage({ checkVersion: true });
  };
}

/** Content script to service worker. The listener's return value is the ratings body. */
export function pageDeliver(
  onReply: (reply: RatingsResponse) => void,
): (message: { items: RatingRequestItem[] }) => void {
  return (message) => {
    if (typeof chrome === "undefined" || chrome.runtime?.sendMessage === undefined) return;
    void chrome.runtime.sendMessage(message).then(
      (value: unknown) => {
        const parsed = parseRatingsResponse(value);
        if (parsed !== null) onReply(parsed);
      },
      () => undefined,
    );
  };
}
