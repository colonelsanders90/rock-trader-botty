import { EMA, MACD } from 'technicalindicators';
import { AnalysisResult, TradingSignal } from './types.js';
import { getSignalState, updateSignalState } from './state.js';
import { fetchDailyBars } from './yahoo.js';

// ~500 calendar days → 250+ trading days (needed for EMA200)
const LOOKBACK_DAYS = 500;

const EMA200_THRESHOLD =
  parseFloat(process.env.EMA200_THRESHOLD_PERCENT ?? '2') / 100;

const EMA200_COOLDOWN_MS =
  parseFloat(process.env.EMA200_COOLDOWN_HOURS ?? '4') * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch + analyse a symbol
// ---------------------------------------------------------------------------
export async function analyzeSymbol(
  symbol: string
): Promise<AnalysisResult | null> {
  try {
    const bars = await fetchDailyBars(symbol, LOOKBACK_DAYS);

    if (bars.length < 35) {
      console.warn(`[signals] ${symbol}: only ${bars.length} bars — skipping`);
      return null;
    }

    // Prefer adjusted close for accurate long-term indicator maths
    const closes = bars.map((b) => b.adjClose);
    const latestPrice = bars[bars.length - 1].close;
    const latestDate = bars[bars.length - 1].date;

    // --- MACD (12, 26, 9) ---
    let macdResult: AnalysisResult['macd'] = null;
    const macdOutput = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const lastMacd = macdOutput[macdOutput.length - 1];
    if (
      lastMacd?.MACD != null &&
      lastMacd?.signal != null &&
      lastMacd?.histogram != null
    ) {
      macdResult = {
        macdLine: lastMacd.MACD,
        signalLine: lastMacd.signal,
        histogram: lastMacd.histogram,
      };
    }

    // --- EMA200 ---
    let ema200: number | null = null;
    if (closes.length >= 200) {
      const emaOutput = EMA.calculate({ values: closes, period: 200 });
      ema200 = emaOutput[emaOutput.length - 1] ?? null;
    }

    return { symbol, price: latestPrice, timestamp: latestDate, macd: macdResult, ema200 };
  } catch (err) {
    console.error(`[signals] Error analysing ${symbol}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Detect signals by comparing current analysis against stored state
// ---------------------------------------------------------------------------
export function detectSignals(analysis: AnalysisResult): TradingSignal[] {
  const signals: TradingSignal[] = [];
  const state = getSignalState(analysis.symbol);

  // ---- MACD histogram zero-cross ----
  if (analysis.macd) {
    const prev = state.lastMacdHistogram;
    const curr = analysis.macd.histogram;

    if (prev !== null) {
      if (prev < 0 && curr > 0) {
        signals.push({
          type: 'MACD_BUY',
          symbol: analysis.symbol,
          price: analysis.price,
          timestamp: analysis.timestamp,
          macd: analysis.macd,
        });
      } else if (prev > 0 && curr < 0) {
        signals.push({
          type: 'MACD_SELL',
          symbol: analysis.symbol,
          price: analysis.price,
          timestamp: analysis.timestamp,
          macd: analysis.macd,
        });
      }
    }

    updateSignalState(analysis.symbol, { lastMacdHistogram: curr });
  }

  // ---- EMA200 proximity ----
  if (analysis.ema200 != null) {
    const pctDiff = (analysis.price - analysis.ema200) / analysis.ema200;

    if (Math.abs(pctDiff) <= EMA200_THRESHOLD) {
      const now = Date.now();
      const lastAlert = state.lastEma200AlertAt;

      if (lastAlert === null || now - lastAlert >= EMA200_COOLDOWN_MS) {
        signals.push({
          type: 'EMA200_PROXIMITY',
          symbol: analysis.symbol,
          price: analysis.price,
          timestamp: analysis.timestamp,
          ema200: {
            value: analysis.ema200,
            percentDiff: pctDiff * 100,
            direction: pctDiff >= 0 ? 'ABOVE' : 'BELOW',
          },
        });
        updateSignalState(analysis.symbol, { lastEma200AlertAt: now });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Format a signal as a MarkdownV2 Telegram message
// ---------------------------------------------------------------------------
export function formatSignal(signal: TradingSignal): string {
  const ts = signal.timestamp.toUTCString();

  switch (signal.type) {
    case 'MACD_BUY':
      return (
        `🟢 *BUY SIGNAL — ${esc(signal.symbol)}*\n` +
        `📊 MACD Bullish Crossover \\(histogram turned positive\\)\n` +
        `💰 Price: *\\$${signal.price.toFixed(2)}*\n` +
        `📈 MACD: \`${signal.macd!.macdLine.toFixed(4)}\`  ` +
        `Signal: \`${signal.macd!.signalLine.toFixed(4)}\`  ` +
        `Hist: \`\\+${signal.macd!.histogram.toFixed(4)}\`\n` +
        `⏰ ${esc(ts)}`
      );

    case 'MACD_SELL':
      return (
        `🔴 *SELL SIGNAL — ${esc(signal.symbol)}*\n` +
        `📊 MACD Bearish Crossover \\(histogram turned negative\\)\n` +
        `💰 Price: *\\$${signal.price.toFixed(2)}*\n` +
        `📉 MACD: \`${signal.macd!.macdLine.toFixed(4)}\`  ` +
        `Signal: \`${signal.macd!.signalLine.toFixed(4)}\`  ` +
        `Hist: \`${signal.macd!.histogram.toFixed(4)}\`\n` +
        `⏰ ${esc(ts)}`
      );

    case 'EMA200_PROXIMITY': {
      const e = signal.ema200!;
      const absPct = Math.abs(e.percentDiff).toFixed(2);
      const dirEmoji = e.direction === 'ABOVE' ? '📍' : '🔻';
      const label = e.direction === 'ABOVE'
        ? '\\(potential resistance\\)'
        : '\\(potential support\\)';
      return (
        `⚡ *EMA200 PROXIMITY — ${esc(signal.symbol)}*\n` +
        `📊 Price within ${absPct}% of the 200\\-day EMA\n` +
        `💰 Price: *\\$${signal.price.toFixed(2)}*  EMA200: \`\\$${e.value.toFixed(2)}\`\n` +
        `${dirEmoji} ${absPct}% ${e.direction} EMA200 ${label}\n` +
        `⏰ ${esc(ts)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot report for /check command (no state side-effects on MACD)
// ---------------------------------------------------------------------------
export function formatAnalysisReport(analysis: AnalysisResult): string {
  const macdStr = analysis.macd
    ? (
        `📊 *MACD \\(12, 26, 9\\)*\n` +
        `  Line:   \`${analysis.macd.macdLine.toFixed(4)}\`\n` +
        `  Signal: \`${analysis.macd.signalLine.toFixed(4)}\`\n` +
        `  Hist:   \`${analysis.macd.histogram.toFixed(4)}\` ` +
        `${analysis.macd.histogram >= 0 ? '🟢 Positive' : '🔴 Negative'}`
      )
    : '📊 MACD: _not enough data_';

  let ema200Str: string;
  if (analysis.ema200 != null) {
    const pct = ((analysis.price - analysis.ema200) / analysis.ema200 * 100).toFixed(2);
    const dir = analysis.price >= analysis.ema200 ? '▲ ABOVE' : '▼ BELOW';
    const threshold = parseFloat(process.env.EMA200_THRESHOLD_PERCENT ?? '2');
    const nearLabel =
      Math.abs(parseFloat(pct)) <= threshold ? ' ⚡ _within alert zone_' : '';
    ema200Str =
      `📈 *EMA200*: \`\\$${analysis.ema200.toFixed(2)}\`\n` +
      `  Price is \`${pct}%\` ${dir} EMA200${nearLabel}`;
  } else {
    ema200Str = '📈 EMA200: _not enough data \\(needs 200\\+ daily candles\\)_';
  }

  return (
    `*${esc(analysis.symbol)} — Snapshot*\n` +
    `💰 Price: *\\$${analysis.price.toFixed(2)}*\n` +
    `⏰ ${esc(analysis.timestamp.toUTCString())}\n\n` +
    `${macdStr}\n\n` +
    `${ema200Str}`
  );
}

/** Escape special MarkdownV2 characters */
function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
