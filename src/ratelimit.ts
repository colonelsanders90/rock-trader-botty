/** Sliding-window in-memory rate limiter. */

interface Bucket {
  timestamps: number[];
}

const store = new Map<string, Bucket>();

/**
 * Returns true if the caller is over the limit.
 * @param key       Unique key (e.g. `"chatId:action"`)
 * @param max       Max allowed calls in the window
 * @param windowMs  Window size in milliseconds
 */
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  const bucket = store.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= max) {
    store.set(key, bucket);
    return true;
  }

  bucket.timestamps.push(now);
  store.set(key, bucket);
  return false;
}

/**
 * Valid Yahoo Finance ticker: 1–15 uppercase letters/digits, optionally
 * prefixed with ^ (indices like ^VIX) or containing . / - / = (e.g. BRK.B,
 * GC=F, 005930.KS).
 */
const SYMBOL_RE = /^\^?[A-Z0-9]{1,10}([.\-=][A-Z0-9]{1,5})?$/;

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_RE.test(symbol);
}

// Rate limit presets
export const LIMITS = {
  /** /price and /check — each hits Yahoo Finance */
  api: { max: 3, windowMs: 30_000 },
  /** /watch and /unwatch — writes to state */
  watchlist: { max: 5, windowMs: 60_000 },
  /** catch-all flood guard per user */
  global: { max: 20, windowMs: 60_000 },
} as const;

export const MAX_WATCHLIST_SIZE = 20;
