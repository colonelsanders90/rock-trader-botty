export interface WatchedSymbol {
  symbol: string;   // Yahoo Finance symbol e.g. "AAPL", "BTC-USD", "^GSPC"
  addedAt: string;  // ISO timestamp
}

// chatId (string) -> list of watched symbols
export type Watchlist = Record<string, WatchedSymbol[]>;

export interface SymbolSignalState {
  lastMacdHistogram: number | null;   // histogram value from previous scan
  lastEma200AlertAt: number | null;   // ms timestamp of last EMA200 proximity alert
}

// symbol -> signal tracking state
export type SignalState = Record<string, SymbolSignalState>;

export interface VixState {
  lastAlertPrice: number | null;  // VIX price at the time of the last alert (or first-seen)
}

export interface AppState {
  watchlist: Watchlist;
  signalState: SignalState;
  vixState: VixState;
  vixSubscribers: string[];  // chat IDs that receive VIX alerts
}

// --- Analysis ---

export interface MACDValues {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export interface AnalysisResult {
  symbol: string;
  price: number;
  timestamp: Date;
  macd: MACDValues | null;  // null if not enough data
  ema200: number | null;    // null if < 200 candles available
}

// --- Signals ---

export type SignalType = 'MACD_BUY' | 'MACD_SELL' | 'EMA200_PROXIMITY' | 'VIX_SPIKE';

export interface TradingSignal {
  type: SignalType;
  symbol: string;
  price: number;
  timestamp: Date;
  macd?: MACDValues;
  ema200?: {
    value: number;
    percentDiff: number;     // positive = above EMA200, negative = below
    direction: 'ABOVE' | 'BELOW';
  };
  vix?: {
    previousPrice: number;
    changePercent: number;   // positive = up, negative = down
  };
}
