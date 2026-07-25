import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { money, store } from "../crypto.js";

registerMainMenuItem({ label: "Manage alerts", data: "watchlist:manage", order: 20 });
const composer = new Composer<Ctx>();
async function show(ctx: Ctx) {
  const db = await store(), userId = ctx.from?.id;
  if (!db || !userId) { await ctx.reply("No alerts yet — tap Add coin to create one."); return; }
  const entries = await db.entries(userId);
  if (!entries.length) { await ctx.reply("No alerts yet — tap Add coin to create one.", { reply_markup: inlineKeyboard([[inlineButton("Add coin", "watchlist:add")], [inlineButton("Back to menu", "menu:main")]]) }); return; }
  const rows = entries.flatMap((entry) => [[inlineButton(`${entry.enabled ? "Pause" : "Resume"} ${entry.ticker}`, `wm:toggle:${entry.id}`), inlineButton(`Remove ${entry.ticker}`, `wm:delete:${entry.id}`)]]);
  await ctx.reply(entries.map((entry) => `${entry.ticker}: ${entry.threshold !== undefined ? `at ${money(entry.threshold)}` : `move ${entry.movePercent}%`} · ${entry.enabled ? "on" : "paused"}`).join("\n"), { reply_markup: inlineKeyboard([...rows, [inlineButton("Back to menu", "menu:main")]]) });
}
composer.callbackQuery("watchlist:manage", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });
composer.callbackQuery(/^wm:(toggle|delete):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const db = await store(), userId = ctx.from?.id;
  if (!db || !userId) { await ctx.reply("Watchlist storage isn’t set up yet."); return; }
  const entry = (await db.entries(userId)).find((item) => item.id === ctx.match[2]);
  if (!entry) { await ctx.reply("That alert is no longer available."); return; }
  if (ctx.match[1] === "delete") { await db.deleteEntry(entry); await ctx.reply(`${entry.ticker} was removed from your watchlist.`); }
  else { entry.enabled = !entry.enabled; await db.saveEntry(entry); await ctx.reply(`${entry.ticker} alerts are ${entry.enabled ? "on" : "paused"}.`); }
});
export default composer;
