import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";
import { runDailyTasks } from "./crypto.js";

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }
  const bot = await buildBot(token);
  // Publish the "/" command list to Telegram (discoverability). A button-first
  // bot exposes only /start + /help; everything else is reached via menu buttons.
  await setDefaultCommands(bot, [{ command: "price", description: "Check a USD crypto price" }]);
  // A short poll keeps daily notices reliable on the Node deployment; each
  // profile records its last sent day so this never duplicates a summary.
  setInterval(() => { void runDailyTasks(bot); }, 60_000).unref?.();
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
