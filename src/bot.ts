import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { addToWatchlist, addVixSubscriber, getWatchlist, removeFromWatchlist } from './state.js';
import { isRateLimited, isValidSymbol, LIMITS, MAX_WATCHLIST_SIZE } from './ratelimit.js';
import {
  analyzeSymbol,
  detectSignals,
  formatAnalysisReport,
  formatSignal,
} from './signals.js';
import { fetchDailyBars } from './yahoo.js';

const INTERVAL = process.env.SCAN_INTERVAL_MINUTES ?? '15';
const THRESHOLD = process.env.EMA200_THRESHOLD_PERCENT ?? '2';
const VIX_THRESHOLD = process.env.VIX_CHANGE_THRESHOLD_PERCENT ?? '5';

// Persistent reply keyboard shown on every response
const KB = Markup.keyboard([
  ['📋 Watchlist', '💰 Price'],
  ['➕ Watch',     '🔍 Check'],
  ['❌ Unwatch',   '❓ Help' ],
]).resize();

// Track which button a user tapped while waiting for their symbol input
type PendingAction = 'watch' | 'unwatch' | 'price' | 'check';
const pending = new Map<string, PendingAction>();

export function createBot(token: string): Telegraf {
  const bot = new Telegraf(token);

  // ---- /start ----
  bot.command('start', async (ctx) => {
    await addVixSubscriber(String(ctx.chat.id));
    await ctx.replyWithMarkdownV2(
      `👋 *Welcome to Rock Trader Botty\\!*\n\n` +
      `I watch your stocks and fire alerts when:\n` +
      `• 🟢 MACD histogram crosses *above zero* → BUY\n` +
      `• 🔴 MACD histogram crosses *below zero* → SELL\n` +
      `• ⚡ Price lands within *${THRESHOLD}%* of the 200\\-day EMA\n` +
      `• ⚠️ VIX moves *${VIX_THRESHOLD}%* or more \\(automatic\\)\n\n` +
      `Use the buttons below to get started\\.`,
      KB
    );
  });

  // ---- /help ----
  bot.command('help', async (ctx) => {
    await ctx.replyWithMarkdownV2(
      `*Rock Trader Botty — Help*\n\n` +
      `*Signal settings*\n` +
      `• MACD: \\(12, 26, 9\\) on daily candles\n` +
      `• EMA200 alert zone: within ${THRESHOLD}% of EMA200\n` +
      `• VIX: alert when fear index moves ≥${VIX_THRESHOLD}% from last alert\n` +
      `• Scan interval: every ${INTERVAL} minutes\n\n` +
      `_Tap a button or type a slash command to get started\\._`,
      KB
    );
  });

  // ---- /watch <symbol> ----
  bot.command('watch', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      pending.set(String(ctx.chat.id), 'watch');
      return ctx.reply('Which symbol do you want to watch? (e.g. AAPL)', KB);
    }
    await handleWatch(ctx, parts[1].toUpperCase());
  });

  // ---- /unwatch <symbol> ----
  bot.command('unwatch', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      pending.set(String(ctx.chat.id), 'unwatch');
      return ctx.reply('Which symbol do you want to remove? (e.g. AAPL)', KB);
    }
    await handleUnwatch(ctx, parts[1].toUpperCase());
  });

  // ---- /list ----
  bot.command('list', async (ctx) => {
    await handleList(ctx);
  });

  // ---- /price <symbol> ----
  bot.command('price', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      pending.set(String(ctx.chat.id), 'price');
      return ctx.reply('Which symbol? (e.g. AAPL)', KB);
    }
    await handlePrice(ctx, parts[1].toUpperCase());
  });

  // ---- /check <symbol> ----
  bot.command('check', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      pending.set(String(ctx.chat.id), 'check');
      return ctx.reply('Which symbol? (e.g. AAPL)', KB);
    }
    await handleCheck(ctx, parts[1].toUpperCase());
  });

  // ---- Button presses & pending symbol input ----
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = String(ctx.chat.id);

    // Button taps
    switch (text) {
      case '📋 Watchlist':
        return handleList(ctx);
      case '💰 Price':
        pending.set(chatId, 'price');
        return ctx.reply('Which symbol? (e.g. AAPL)', KB);
      case '➕ Watch':
        pending.set(chatId, 'watch');
        return ctx.reply('Which symbol do you want to watch? (e.g. AAPL)', KB);
      case '🔍 Check':
        pending.set(chatId, 'check');
        return ctx.reply('Which symbol? (e.g. AAPL)', KB);
      case '❌ Unwatch':
        pending.set(chatId, 'unwatch');
        return ctx.reply('Which symbol do you want to remove? (e.g. AAPL)', KB);
      case '❓ Help':
        return ctx.replyWithMarkdownV2(
          `*Rock Trader Botty — Help*\n\n` +
          `*Signal settings*\n` +
          `• MACD: \\(12, 26, 9\\) on daily candles\n` +
          `• EMA200 alert zone: within ${THRESHOLD}% of EMA200\n` +
          `• VIX: alert when fear index moves ≥${VIX_THRESHOLD}% from last alert\n` +
          `• Scan interval: every ${INTERVAL} minutes`,
          KB
        );
    }

    // Pending symbol input after a button tap
    const action = pending.get(chatId);
    if (action) {
      pending.delete(chatId);
      const symbol = text.toUpperCase();
      switch (action) {
        case 'watch':   return handleWatch(ctx, symbol);
        case 'unwatch': return handleUnwatch(ctx, symbol);
        case 'price':   return handlePrice(ctx, symbol);
        case 'check':   return handleCheck(ctx, symbol);
      }
    }
  });

  // Global error handler
  bot.catch((err, ctx) => {
    console.error(`[bot] Unhandled error for update ${ctx.updateType}:`, err);
  });

  return bot;
}

// ---------------------------------------------------------------------------
// Action helpers (shared by slash commands and button flows)
// ---------------------------------------------------------------------------

/** Returns true and replies if the user is over any rate limit. */
async function checkLimits(
  ctx: any,
  action: 'api' | 'watchlist'
): Promise<boolean> {
  const chatId = String(ctx.chat.id);
  if (isRateLimited(`${chatId}:global`, LIMITS.global.max, LIMITS.global.windowMs)) {
    await ctx.reply('Too many requests. Please slow down.', KB);
    return true;
  }
  const limit = LIMITS[action];
  if (isRateLimited(`${chatId}:${action}`, limit.max, limit.windowMs)) {
    const cooldownSec = Math.ceil(limit.windowMs / 1000);
    await ctx.reply(`Too many requests. Please wait ${cooldownSec}s before trying again.`, KB);
    return true;
  }
  return false;
}

/** Returns true and replies if the symbol fails validation. */
async function checkSymbol(ctx: any, symbol: string): Promise<boolean> {
  if (!isValidSymbol(symbol)) {
    await ctx.reply(
      `❌ "${symbol}" doesn't look like a valid ticker symbol.\nUse letters and numbers only (e.g. AAPL, ^VIX, BRK.B).`,
      KB
    );
    return true;
  }
  return false;
}

async function handleWatch(ctx: any, symbol: string): Promise<void> {
  if (await checkSymbol(ctx, symbol)) return;
  if (await checkLimits(ctx, 'watchlist')) return;
  const chatId = String(ctx.chat.id);
  const current = await getWatchlist(chatId);
  if (current.length >= MAX_WATCHLIST_SIZE) {
    await ctx.reply(`Your watchlist is full (${MAX_WATCHLIST_SIZE} symbols max). Remove one first.`, KB);
    return;
  }
  const added = await addToWatchlist(chatId, symbol);
  if (!added) {
    await ctx.reply(`${symbol} is already on your watchlist.`, KB);
    return;
  }
  await ctx.reply(
    `✅ Now watching ${symbol}\nYou'll be alerted on MACD crossovers and EMA200 proximity.`,
    KB
  );
}

async function handleUnwatch(ctx: any, symbol: string): Promise<void> {
  if (await checkSymbol(ctx, symbol)) return;
  if (await checkLimits(ctx, 'watchlist')) return;
  const chatId = String(ctx.chat.id);
  const removed = await removeFromWatchlist(chatId, symbol);
  if (!removed) {
    await ctx.reply(`${symbol} is not on your watchlist.`, KB);
    return;
  }
  await ctx.reply(`❌ Removed ${symbol} from your watchlist.`, KB);
}

async function handleList(ctx: any): Promise<void> {
  const chatId = String(ctx.chat.id);
  const watchlist = await getWatchlist(chatId);
  if (watchlist.length === 0) {
    await ctx.reply('Your watchlist is empty.\nTap ➕ Watch to add a symbol.', KB);
    return;
  }
  const lines = watchlist
    .map((s: any) => `• ${s.symbol}  _(since ${new Date(s.addedAt).toLocaleDateString()})_`)
    .join('\n');
  await ctx.replyWithMarkdownV2(
    `*Your Watchlist \\(${watchlist.length}\\)*\n${escapeMarkdown(lines)}`,
    KB
  );
}

async function handlePrice(ctx: any, symbol: string): Promise<void> {
  if (await checkSymbol(ctx, symbol)) return;
  if (await checkLimits(ctx, 'api')) return;
  const loadingMsg = await ctx.reply(`🔍 Fetching price for ${symbol}…`);
  try {
    const bars = await fetchDailyBars(symbol, 5);
    if (bars.length === 0) throw new Error('No bars returned');

    const latest = bars[bars.length - 1];
    const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
    const change = prev ? latest.close - prev.close : null;
    const changePct = prev ? (change! / prev.close) * 100 : null;
    const arrow = change == null ? '' : change >= 0 ? '▲' : '▼';
    const changeStr =
      change != null
        ? ` ${arrow} ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct! >= 0 ? '+' : ''}${changePct!.toFixed(2)}%)`
        : '';

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      `💰 ${symbol} — $${latest.close.toFixed(2)}${changeStr}\n⏰ ${latest.date.toUTCString()}`
    );
  } catch (err) {
    console.error(`[bot] /price error for ${symbol}:`, err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      `❌ Could not fetch price for ${symbol}.\nCheck the symbol is valid on Yahoo Finance and try again.`
    ).catch(() => ctx.reply(`❌ Could not fetch price for ${symbol}.`, KB));
  }
}

async function handleCheck(ctx: any, symbol: string): Promise<void> {
  if (await checkSymbol(ctx, symbol)) return;
  if (await checkLimits(ctx, 'api')) return;
  const loadingMsg = await ctx.reply(`🔍 Fetching data for ${symbol}…`);
  try {
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

    const report = formatAnalysisReport(analysis);
    const signals = await detectSignals_readonly(analysis);
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
  } catch (err) {
    console.error(`[bot] /check error for ${symbol}:`, err);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      `❌ Something went wrong fetching data for ${symbol}. Please try again.`
    ).catch(() => ctx.reply(`❌ Something went wrong fetching data for ${symbol}.`, KB));
  }
}

function detectSignals_readonly(
  analysis: Parameters<typeof detectSignals>[0]
): ReturnType<typeof detectSignals> {
  return detectSignals(analysis);
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
