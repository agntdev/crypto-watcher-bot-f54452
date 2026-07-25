import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { store, tickerFor, type WatchEntry } from "../crypto.js";
import type { WatchFlow } from "../flow.js";

registerMainMenuItem({ label: "Add coin", data: "watchlist:add", order: 10 });
const composer = new Composer<Ctx>();
const flow = (ctx: Ctx) => ctx.session as WatchFlow;
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

function coinPicker() { return inlineKeyboard([[inlineButton("BTC", "wa:coin:BTC"), inlineButton("ETH", "wa:coin:ETH"), inlineButton("TON", "wa:coin:TON")], [inlineButton("Type a ticker", "wa:coin:type")], [inlineButton("Back to menu", "menu:main")]]); }
function kindPicker() { return inlineKeyboard([[inlineButton("Price threshold", "wa:kind:threshold")], [inlineButton("Percent move", "wa:kind:move")], [inlineButton("Cancel", "menu:main")]]); }

async function chooseTicker(ctx: Ctx, ticker: string) {
  flow(ctx).ticker = ticker; flow(ctx).step = undefined;
  await ctx.reply(`Track ${ticker}. Choose the alert rule.`, { reply_markup: kindPicker() });
}
composer.callbackQuery("watchlist:add", async (ctx) => { await ctx.answerCallbackQuery(); flow(ctx).step = undefined; await ctx.reply("Choose a coin to watch.", { reply_markup: coinPicker() }); });
composer.callbackQuery(/^wa:coin:(BTC|ETH|TON)$/, async (ctx) => { await ctx.answerCallbackQuery(); await chooseTicker(ctx, ctx.match[1]); });
composer.callbackQuery("wa:coin:type", async (ctx) => { await ctx.answerCallbackQuery(); flow(ctx).step = "ticker"; await ctx.reply("Send the ticker you want to watch. I support BTC, ETH, and TON.", { reply_markup: { force_reply: true, input_field_placeholder: "BTC" } }); });
composer.callbackQuery(/^wa:kind:(threshold|move)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const kind = ctx.match[1] as "threshold" | "move";
  if (!flow(ctx).ticker) { await ctx.reply("Choose a coin first.", { reply_markup: coinPicker() }); return; }
  flow(ctx).alertKind = kind; flow(ctx).step = "value";
  await ctx.reply(kind === "threshold" ? "Send the USD price that should alert you." : "Send the percent move that should alert you.", { reply_markup: { force_reply: true, input_field_placeholder: kind === "threshold" ? "100000" : "5" } });
});
composer.callbackQuery("wa:confirm", async (ctx) => {
  await ctx.answerCallbackQuery(); const state = flow(ctx), userId = ctx.from?.id;
  if (!userId || !state.ticker || !state.alertKind || !state.value) { await ctx.reply("That setup expired. Start again from Add coin.", { reply_markup: back }); return; }
  const db = await store();
  if (!db) { await ctx.reply("Watchlist storage isn’t set up yet. Ask the owner to connect Redis, then try again.", { reply_markup: back }); return; }
  await db.touch(userId);
  const entry: WatchEntry = { id: crypto.randomUUID(), userId, ticker: state.ticker, enabled: true, ...(state.alertKind === "threshold" ? { threshold: state.value } : { movePercent: state.value }) };
  await db.saveEntry(entry); ctx.session = {};
  await ctx.reply(`${entry.ticker} is now on your watchlist.`, { reply_markup: back });
});
composer.callbackQuery("wa:cancel", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session = {}; await ctx.reply("Nothing was added.", { reply_markup: back }); });
composer.on("message:text", async (ctx, next) => {
  const state = flow(ctx); const text = ctx.message.text.trim();
  if (state.step === "ticker") { const ticker = tickerFor(text); if (!ticker) { await ctx.reply("I support BTC, ETH, and TON. Try one of those tickers."); return; } await chooseTicker(ctx, ticker); return; }
  if (state.step !== "value") return next();
  const value = Number(text.replace(/[$,%\s,]/g, ""));
  if (!Number.isFinite(value) || value <= 0) { await ctx.reply("Send a number greater than zero."); return; }
  state.value = value; state.step = "confirm";
  const description = state.alertKind === "threshold" ? `$${value.toLocaleString("en-US")}` : `${value}%`;
  await ctx.reply(`Alert ${state.ticker} when it ${state.alertKind === "threshold" ? `reaches ${description}` : `moves ${description}`}.`, { reply_markup: inlineKeyboard([[inlineButton("Add alert", "wa:confirm")], [inlineButton("Cancel", "wa:cancel")]]) });
});
export default composer;
