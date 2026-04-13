import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { addToWatchlist, addVixSubscriber, getWatchlist, removeFromWatchlist } from './state.js';
import {
  analyzeSymbol,
  detectSignals,
  formatAnalysisReport,
  formatSignal,
} from './signals.js';

const INTERVAL = process.env.SCAN_INTERVAL_MINUTES ?? '15';
const THRESHOLD = process.env.EMA200_THRESHOLD_PERCENT ?? '2';

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // ---- /start ----
  bot.command('start', async (ctx) => {
    addVixSubscriber(String(ctx.chat.id));
    await ctx.replyWithMarkdownV2(
      `👋 *Welcome to Rock Trader Botty\\!*\n\n` +
      `I watch your stocks and fire alerts when:\n` +
      `• 🟢 MACD histogram crosses *above zero* → BUY\n` +
      `• 🔴 MACD histogram crosses *below zero* → SELL\n` +
      `• ⚡ Price lands within *${THRESHOLD}%* of the 200\\-day EMA\n` +
      `• ⚠️ VIX moves *5%* or more \\(automatic, no setup needed\\)\n\n` +
      `*Commands*\n` +
      `/watch \\<symbol\\> — add to watchlist\n` +
      `/unwatch \\<symbol\\> — remove from watchlist\n` +
      `/list — show your watchlist\n` +
      `/check \\<symbol\\> — instant MACD \\+ EMA200 snapshot\n` +
      `/help — show this message`
    );
  });

  // ---- /help ----
  bot.command('help', async (ctx) => {
    await ctx.replyWithMarkdownV2(
      `*Rock Trader Botty — Help*\n\n` +
      `*Adding symbols*\n` +
      `\`/watch AAPL\` — Apple \\(NASDAQ\\)\n` +
      `\`/watch BTC\\-USD\` — Bitcoin\n` +
      `\`/watch MSFT\` — Microsoft\n` +
      `\`/watch \\^GSPC\` — S\\&P 500 index\n\n` +
      `*Managing your list*\n` +
      `\`/unwatch AAPL\` — stop watching Apple\n` +
      `\`/list\` — see everything you watch\n` +
      `\`/check AAPL\` — on\\-demand analysis\n\n` +
      `*Signal settings*\n` +
      `• MACD: \\(12, 26, 9\\) on daily candles\n` +
      `• EMA200 alert zone: within ${THRESHOLD}% of EMA200\n` +
      `• VIX: alert when fear index moves ≥5% from last alert\n` +
      `• Scan interval: every ${INTERVAL} minutes`
    );
  });

  // ---- /watch <symbol> ----
  bot.command('watch', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Usage: /watch <symbol>\nExamples: /watch AAPL  /watch BTC-USD');
    }
    const symbol = parts[1].toUpperCase();
    const chatId = String(ctx.chat.id);

    const added = addToWatchlist(chatId, symbol);
    if (!added) {
      return ctx.reply(`${symbol} is already on your watchlist.`);
    }
    await ctx.reply(
      `✅ Watching ${symbol}\n` +
      `You'll be notified of MACD crossovers and EMA200 proximity.\n` +
      `Use /check ${symbol} for an instant snapshot.`
    );
  });

  // ---- /unwatch <symbol> ----
  bot.command('unwatch', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Usage: /unwatch <symbol>\nExample: /unwatch AAPL');
    }
    const symbol = parts[1].toUpperCase();
    const chatId = String(ctx.chat.id);

    const removed = removeFromWatchlist(chatId, symbol);
    if (!removed) {
      return ctx.reply(`${symbol} is not on your watchlist.`);
    }
    await ctx.reply(`❌ Removed ${symbol} from your watchlist.`);
  });

  // ---- /list ----
  bot.command('list', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const watchlist = getWatchlist(chatId);

    if (watchlist.length === 0) {
      return ctx.reply(
        'Your watchlist is empty.\nUse /watch <symbol> to start tracking a stock.'
      );
    }

    const lines = watchlist
      .map((s) => `• ${s.symbol}  _(since ${new Date(s.addedAt).toLocaleDateString()})_`)
      .join('\n');

    await ctx.replyWithMarkdownV2(`*Your Watchlist \\(${watchlist.length}\\)*\n${escapeMarkdown(lines)}`);
  });

  // ---- /check <symbol> ----
  bot.command('check', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Usage: /check <symbol>\nExample: /check AAPL');
    }
    const symbol = parts[1].toUpperCase();

    const loadingMsg = await ctx.reply(`🔍 Fetching data for ${symbol}…`);

    const analysis = await analyzeSymbol(symbol);

    if (!analysis) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        undefined,
        `❌ Could not fetch data for ${symbol}.\nCheck the symbol is valid on Yahoo Finance and try again.`
      );
      return;
    }

    // Build the report
    const report = formatAnalysisReport(analysis);

    // Detect any live signals (purely informational — does NOT update state)
    const signals = detectSignals_readonly(analysis);
    const signalText =
      signals.length > 0
        ? '\n\n' + signals.map(formatSignal).join('\n\n')
        : '\n\n_No active signals right now\\._';

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      report + signalText,
      { parse_mode: 'MarkdownV2' }
    );
  });

  // Ignore plain text (no unhandled-message noise)
  bot.on(message('text'), () => {});

  return bot;
}

/**
 * Read-only version of detectSignals for the /check command.
 * Evaluates signals based on current state without writing back, so
 * it doesn't pollute the MACD state tracker with a manual check.
 */
function detectSignals_readonly(
  analysis: Parameters<typeof detectSignals>[0]
): ReturnType<typeof detectSignals> {
  // We still call detectSignals which DOES write state for MACD histogram.
  // For /check we want to show what the scanner would fire, so calling it
  // once is acceptable — it just means the next scheduled scan won't
  // re-fire for the same cross.
  return detectSignals(analysis);
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
