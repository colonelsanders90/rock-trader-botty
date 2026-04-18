/**
 * Twelve Data API client — replaces Yahoo Finance.
 *
 * Why: Yahoo Finance blocks outbound requests from cloud provider IPs
 * (Railway, Heroku, AWS, GCP, etc.) with ETIMEDOUT errors.
 * Twelve Data works from any IP and has a generous free tier (800 req/day).
 *
 * Free tier: https://twelvedata.com/pricing
 * Get a key:  https://twelvedata.com/register
 */

const BASE_URL = 'https://api.twelvedata.com';

export interface OHLCVBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

interface TDTimeSeries {
  status?: string;
  code?: number;
  message?: string;
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
}

/**
 * Convert Yahoo-Finance-style symbols to Twelve Data format.
 *   BTC-USD  →  BTC/USD
 *   ^VIX     →  VIX
 *   ^GSPC    →  SPX
 *   AAPL     →  AAPL   (no change)
 */
function toTwelveDataSymbol(symbol: string): string {
  if (symbol.startsWith('^')) return symbol.slice(1).replace('GSPC', 'SPX');
  if (symbol.includes('-')) return symbol.replace('-', '/');
  return symbol;
}

export async function fetchDailyBars(
  symbol: string,
  lookbackDays: number
): Promise<OHLCVBar[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not set in environment variables');

  const tdSymbol = toTwelveDataSymbol(symbol);

  // outputsize = trading days needed. ~252 trading days per year.
  // lookbackDays is calendar days so multiply by 252/365 ≈ 0.69, add buffer.
  const outputsize = Math.min(Math.ceil(lookbackDays * 0.75) + 20, 5000);

  const url =
    `${BASE_URL}/time_series` +
    `?symbol=${encodeURIComponent(tdSymbol)}` +
    `&interval=1day` +
    `&outputsize=${outputsize}` +
    `&order=ASC` +
    `&apikey=${apiKey}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status} for ${symbol}`);
  }

  const json = (await res.json()) as TDTimeSeries;

  if (json.status === 'error' || json.code != null) {
    throw new Error(`Twelve Data error for ${symbol}: ${json.message ?? 'unknown'}`);
  }

  if (!json.values || json.values.length === 0) {
    throw new Error(`No data returned by Twelve Data for ${symbol}`);
  }

  return json.values.map((v) => {
    const close = parseFloat(v.close);
    return {
      date: new Date(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close,
      adjClose: close, // Twelve Data free tier doesn't split-adjust; close is fine for signals
      volume: parseFloat(v.volume),
    };
  });
}
