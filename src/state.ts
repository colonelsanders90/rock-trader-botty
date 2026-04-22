import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { createClient } from 'redis';
import {
  AppState,
  SymbolSignalState,
  VixState,
  WatchedSymbol,
} from './types.js';

const STATE_FILE = path.resolve(process.cwd(), 'state.json');
const REDIS_KEY = 'rtb:state';

const DEFAULT_STATE: AppState = {
  watchlist: {},
  signalState: {},
  vixState: { lastAlertPrice: null },
  vixSubscribers: [],
};

type RedisClient = ReturnType<typeof createClient>;
let redisPromise: Promise<RedisClient> | null = null;

function getRedis(): Promise<RedisClient> | null {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    redisPromise = (async () => {
      const client = createClient({ url: process.env.REDIS_URL });
      client.on('error', (err) => console.error('[state] Redis error:', err));
      await client.connect();
      console.log('[state] Connected to Redis');
      return client;
    })();
  }
  return redisPromise;
}

async function loadState(): Promise<AppState> {
  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<AppState>) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }
  if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    return {
      ...DEFAULT_STATE,
      ...(JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as Partial<AppState>),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: AppState): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.set(REDIS_KEY, JSON.stringify(state));
    return;
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// --- Watchlist ---

export async function addToWatchlist(chatId: string, symbol: string): Promise<boolean> {
  const state = await loadState();
  if (!state.watchlist[chatId]) state.watchlist[chatId] = [];
  if (state.watchlist[chatId].some((s) => s.symbol === symbol)) return false;
  state.watchlist[chatId].push({ symbol, addedAt: new Date().toISOString() });
  await saveState(state);
  return true;
}

export async function removeFromWatchlist(chatId: string, symbol: string): Promise<boolean> {
  const state = await loadState();
  if (!state.watchlist[chatId]) return false;
  const before = state.watchlist[chatId].length;
  state.watchlist[chatId] = state.watchlist[chatId].filter((s) => s.symbol !== symbol);
  if (state.watchlist[chatId].length === before) return false;
  await saveState(state);
  return true;
}

export async function getWatchlist(chatId: string): Promise<WatchedSymbol[]> {
  return (await loadState()).watchlist[chatId] ?? [];
}

export async function getSymbolSubscribers(): Promise<Record<string, string[]>> {
  const { watchlist } = await loadState();
  const result: Record<string, string[]> = {};
  for (const [chatId, symbols] of Object.entries(watchlist)) {
    for (const { symbol } of symbols) {
      if (!result[symbol]) result[symbol] = [];
      result[symbol].push(chatId);
    }
  }
  return result;
}

// --- Signal state ---

export async function getSignalState(symbol: string): Promise<SymbolSignalState> {
  return (
    (await loadState()).signalState[symbol] ?? {
      lastMacdHistogram: null,
      lastEma200AlertAt: null,
    }
  );
}

export async function updateSignalState(
  symbol: string,
  updates: Partial<SymbolSignalState>
): Promise<void> {
  const state = await loadState();
  state.signalState[symbol] = {
    ...(state.signalState[symbol] ?? {
      lastMacdHistogram: null,
      lastEma200AlertAt: null,
    }),
    ...updates,
  };
  await saveState(state);
}

// --- VIX state ---

export async function getVixState(): Promise<VixState> {
  return (await loadState()).vixState;
}

export async function updateVixState(updates: Partial<VixState>): Promise<void> {
  const state = await loadState();
  state.vixState = { ...state.vixState, ...updates };
  await saveState(state);
}

// --- VIX subscribers ---

export async function addVixSubscriber(chatId: string): Promise<void> {
  const state = await loadState();
  if (!state.vixSubscribers.includes(chatId)) {
    state.vixSubscribers.push(chatId);
    await saveState(state);
  }
}

export async function getVixSubscribers(): Promise<string[]> {
  return (await loadState()).vixSubscribers;
}
