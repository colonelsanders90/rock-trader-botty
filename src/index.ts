import dotenv from 'dotenv';
dotenv.config();

import { createBot } from './bot.js';
import { initScanner, runScan, startScheduler } from './scanner.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

const intervalMinutes = Math.max(
  1,
  parseInt(process.env.SCAN_INTERVAL_MINUTES ?? '15', 10)
);

const bot = createBot(token);
initScanner(bot.telegram);
startScheduler(intervalMinutes);

// Run one scan 10 s after startup so you get an immediate status check
setTimeout(async () => {
  console.log('[index] Running initial scan…');
  await runScan();
}, 10_000);

bot.launch(() => {
  console.log('');
  console.log('🤖 Rock Trader Botty is running!');
  console.log(`   Scan interval : every ${intervalMinutes} minute(s)`);
  console.log(`   EMA200 zone   : ±${process.env.EMA200_THRESHOLD_PERCENT ?? '2'}%`);
  console.log('');
  console.log('Open Telegram and send /start to your bot to begin.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
