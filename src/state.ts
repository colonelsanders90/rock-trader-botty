import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  AppState,
  SymbolSignalState,
  WatchedSymbol,
  Watchlist,
} from './types.js';

const STATE_FILE = path.resolve(process.cwd(), 'state.json');

function loadState(): AppState {
  if (!existsSync(STATE_FILE)) {
    return { watchlist: {}, signalState: {} };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as AppState;
  } catch {
    return { watchlist: {}, signalState: {} };
  }
}

function saveState(state: AppState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// --- Watchlist ---

export function addToWatchlist(chatId: string, symbol: string): boolean {
  const state = loadState();
  if (!state.watchlist[chatId]) state.watchlist[chatId] = [];
  if (state.watchlist[chatId].some((s) => s.symbol === symbol)) return false;
  state.watchlist[chatId].push({ symbol, addedAt: new Date().toISOString() });
  saveState(state);
  return true;
}

export function removeFromWatchlist(chatId: string, symbol: string): boolean {
  const state = loadState();
  if (!state.watchlist[chatId]) return false;
  const before = state.watchlist[chatId].length;
  state.watchlist[chatId] = state.watchlist[chatId].filter(
    (s) => s.symbol !== symbol
  );
  if (state.watchlist[chatId].length === before) return false;
  saveState(state);
  return true;
}

export function getWatchlist(chatId: string): WatchedSymbol[] {
  return loadState().watchlist[chatId] ?? [];
}

/** Returns a map of symbol -> chatIds that subscribe to it */
export function getSymbolSubscribers(): Record<string, string[]> {
  const { watchlist } = loadState();
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

export function getSignalState(symbol: string): SymbolSignalState {
  return (
    loadState().signalState[symbol] ?? {
      lastMacdHistogram: null,
      lastEma200AlertAt: null,
    }
  );
}

export function updateSignalState(
  symbol: string,
  updates: Partial<SymbolSignalState>
): void {
  const state = loadState();
  state.signalState[symbol] = {
    ...(state.signalState[symbol] ?? {
      lastMacdHistogram: null,
      lastEma200AlertAt: null,
    }),
    ...updates,
  };
  saveState(state);
}
