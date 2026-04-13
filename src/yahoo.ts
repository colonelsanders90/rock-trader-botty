/**
 * Minimal Yahoo Finance v8 chart API client.
 * Fetches daily OHLCV candles for any symbol Yahoo Finance supports.
 */

export interface OHLCVBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

interface YFChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
        adjclose?: Array<{ adjclose: (number | null)[] }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

export async function fetchDailyBars(
  symbol: string,
  lookbackDays: number
): Promise<OHLCVBar[]> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - lookbackDays * 86400;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${start}&period2=${now}&interval=1d&includeAdjustedClose=true`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);
  }

  const json = (await res.json()) as YFChartResponse;

  if (json.chart.error) {
    throw new Error(
      `Yahoo Finance error for ${symbol}: ${json.chart.error.description}`
    );
  }

  const result = json.chart.result?.[0];
  if (!result) throw new Error(`No data returned for ${symbol}`);

  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];
  const ac = result.indicators.adjclose?.[0]?.adjclose ?? [];

  const bars: OHLCVBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = q.close[i];
    const open = q.open[i];
    const high = q.high[i];
    const low = q.low[i];
    const volume = q.volume[i];
    const adjClose = ac[i] ?? close;

    // Skip null/NaN rows (market holidays that sneak through)
    if (
      close == null || open == null || high == null ||
      low == null || !isFinite(close)
    ) continue;

    bars.push({
      date: new Date(timestamps[i] * 1000),
      open,
      high,
      low,
      close,
      adjClose: adjClose ?? close,
      volume: volume ?? 0,
    });
  }

  return bars;
}
