import cron from 'node-cron';
import { Telegram } from 'telegraf';
import { getSymbolSubscribers } from './state.js';
import { analyzeSymbol, detectSignals, formatSignal } from './signals.js';

let telegram: Telegram;

export function initScanner(tg: Telegram): void {
  telegram = tg;
}

export async function runScan(): Promise<void> {
  const subscribers = getSymbolSubscribers();
  const symbols = Object.keys(subscribers);

  if (symbols.length === 0) {
    console.log('[scanner] Watchlist empty — nothing to scan');
    return;
  }

  console.log(`[scanner] Scanning ${symbols.length} symbol(s): ${symbols.join(', ')}`);

  for (const symbol of symbols) {
    const analysis = await analyzeSymbol(symbol);
    if (!analysis) continue;

    const signals = detectSignals(analysis);

    for (const signal of signals) {
      const msg = formatSignal(signal);
      const chatIds = subscribers[symbol] ?? [];

      for (const chatId of chatIds) {
        try {
          await telegram.sendMessage(chatId, msg, { parse_mode: 'MarkdownV2' });
          console.log(`[scanner] Sent ${signal.type} alert for ${symbol} → chat ${chatId}`);
        } catch (err) {
          console.error(`[scanner] Failed to notify chat ${chatId}:`, err);
        }
      }
    }

    // Small delay between symbols to avoid Yahoo Finance rate limits
    await sleep(1500);
  }
}

export function startScheduler(intervalMinutes: number): void {
  // node-cron does not support arbitrary minute intervals > 59 in a single field,
  // so build the expression explicitly.
  const cronExpr =
    intervalMinutes < 60
      ? `*/${intervalMinutes} * * * *`
      : `0 */${Math.floor(intervalMinutes / 60)} * * *`;

  console.log(
    `[scanner] Scheduler started — running every ${intervalMinutes} min (${cronExpr})`
  );

  cron.schedule(cronExpr, async () => {
    console.log(`[scanner] Scheduled scan at ${new Date().toISOString()}`);
    try {
      await runScan();
    } catch (err) {
      console.error('[scanner] Scan error:', err);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
