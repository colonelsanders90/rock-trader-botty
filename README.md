# Rock Trader Botty

A Telegram bot that sends trading signals based on MACD crossovers and EMA200 proximity alerts using Yahoo Finance data.

## Signals

- **MACD Crossover** — detects bullish/bearish histogram zero-crosses on daily candles using a (12, 26, 9) MACD. Fires a `BUY` or `SELL` alert.
- **EMA200 Proximity** — alerts when price comes within a configurable % of the 200-day EMA. Has a per-symbol cooldown to prevent spam.
- **VIX Spike** — automatically notifies all users when the VIX (CBOE Volatility Index) moves ≥5% from the price at the last alert. No setup needed — fires for everyone who has sent `/start`.

## Stack

- Node.js (ESM) + TypeScript
- [Telegraf v4](https://telegraf.js.org/) — Telegram bot framework
- [technicalindicators](https://github.com/anandanand84/technicalindicators) — MACD / EMA calculation
- [node-cron](https://github.com/node-cron/node-cron) — periodic scanning
- Custom Yahoo Finance v8 HTTP fetcher (direct fetch to `query1.finance.yahoo.com/v8/finance/chart`)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd rock_trader_botty
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) | required |
| `SCAN_INTERVAL_MINUTES` | How often to scan watchlisted symbols | `15` |
| `EMA200_THRESHOLD_PERCENT` | Alert when price is within this % of EMA200 | `2` |
| `EMA200_COOLDOWN_HOURS` | Cooldown between EMA200 alerts per symbol | `4` |
| `VIX_CHANGE_THRESHOLD_PERCENT` | Alert when VIX moves this % from last alert price | `5` |

### 3. Run

```bash
# Development (hot reload)
npm run dev

# Production
npm start
```

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Introduction message |
| `/help` | Show available commands |
| `/watch <SYMBOL>` | Add a symbol to your watchlist (e.g. `/watch AAPL`) |
| `/unwatch <SYMBOL>` | Remove a symbol from your watchlist |
| `/list` | Show all watched symbols |
| `/price <SYMBOL>` | Show current price and day change (e.g. `/price AAPL`) |
| `/check <SYMBOL>` | Run an immediate signal check on a symbol |

## Project Structure

```
src/
  index.ts      — Entry point
  bot.ts        — Telegraf command handlers
  scanner.ts    — Periodic cron scan + Telegram push
  signals.ts    — Signal detection + MarkdownV2 formatting
  state.ts      — Watchlist + signal-state persistence (state.json)
  yahoo.ts      — Yahoo Finance v8 chart HTTP fetcher
  types.ts      — Shared TypeScript types
```

## Notes

- State (watchlist + last-seen signal per symbol) is persisted to `state.json` in the project root.
- `yahoo-finance2` v2.14+ dropped the `historical`/`chart` modules; this project uses a direct fetch to the Yahoo Finance v8 API instead.
