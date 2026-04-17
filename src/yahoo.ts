/**
 * Minimal Yahoo Finance v8 chart API client.
 * Fetches daily OHLCV candles for any symbol Yahoo Finance supports.
 *
 * Yahoo Finance requires a crumb + session cookie for all API calls.
 * We fetch and cache them on first use, refreshing on auth errors.
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

let cachedCrumb: string | null = null;
let cachedCookie: string | null = null;

async function fetchCrumb(): Promise<{ crumb: string; cookie: string }> {
  // Step 1: hit the consent/home page to get a session cookie
  const consentRes = await fetch('https://finance.yahoo.com/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
    redirect: 'follow',
  });

  const rawCookies = consentRes.headers.getSetCookie?.() ??
    (consentRes.headers.get('set-cookie') ? [consentRes.headers.get('set-cookie')!] : []);

  const cookie = rawCookies
    .map((c) => c.split(';')[0])
    .join('; ');

  // Step 2: exchange cookie for a crumb
  const crumbRes = await fetch(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: '*/*',
        Cookie: cookie,
      },
    }
  );

  if (!crumbRes.ok) {
    throw new Error(`Failed to fetch Yahoo Finance crumb: HTTP ${crumbRes.status}`);
  }

  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('<')) {
    throw new Error('Yahoo Finance returned an invalid crumb');
  }

  return { crumb, cookie };
}

async function getAuth(refresh = false): Promise<{ crumb: string; cookie: string }> {
  if (!refresh && cachedCrumb && cachedCookie) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }
  const auth = await fetchCrumb();
  cachedCrumb = auth.crumb;
  cachedCookie = auth.cookie;
  return auth;
}

export async function fetchDailyBars(
  symbol: string,
  lookbackDays: number
): Promise<OHLCVBar[]> {
  return _fetchWithRetry(symbol, lookbackDays, false);
}

async function _fetchWithRetry(
  symbol: string,
  lookbackDays: number,
  isRetry: boolean
): Promise<OHLCVBar[]> {
  const { crumb, cookie } = await getAuth(isRetry);

  const now = Math.floor(Date.now() / 1000);
  const start = now - lookbackDays * 86400;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${start}&period2=${now}&interval=1d&includeAdjustedClose=true` +
    `&crumb=${encodeURIComponent(crumb)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Cookie: cookie,
    },
  });

  // Stale crumb — refresh once and retry
  if ((res.status === 401 || res.status === 403) && !isRetry) {
    return _fetchWithRetry(symbol, lookbackDays, true);
  }

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
