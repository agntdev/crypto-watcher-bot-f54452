import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { changePercent, checkAndNotify, fetchPrice, money, now, store, tickerFor } from "../crypto.js";

const composer = new Composer<Ctx>();

composer.command("price", async (ctx) => {
  const requested = ctx.match?.trim();
  const ticker = requested ? tickerFor(requested) : undefined;
  if (requested && !ticker) { await ctx.reply("I support BTC, ETH, and TON. Try one of those tickers."); return; }
  const db = await store();
  const userId = ctx.from?.id;
  if (!userId) return;
  if (!requested && !db) { await ctx.reply("No coins in your watchlist yet — tap Add coin to set one up."); return; }
  const profile = db ? await db.touch(userId) : undefined;
  const tickers = ticker ? [ticker] : [...new Set((await db!.entries(userId)).map((entry) => entry.ticker))];
  if (tickers.length === 0) { await ctx.reply("No coins in your watchlist yet — tap Add coin to set one up."); return; }
  const lines: string[] = [];
  for (const symbol of tickers) {
    const previous = await db?.snapshot(symbol);
    const price = await fetchPrice(symbol);
    if (!price) { await ctx.reply("Couldn’t reach the price feed. Try again in a moment."); return; }
    const change = previous ? changePercent(previous.price, price) : undefined;
    lines.push(`${symbol}: ${money(price)}${change === undefined ? "" : ` (${change >= 0 ? "+" : ""}${change.toFixed(2)}%)`}`);
    await db?.saveSnapshot({ ticker: symbol, price, timestamp: now().getTime() });
    if (profile) for (const entry of await db!.entries(userId)) if (entry.ticker === symbol) await checkAndNotify(ctx.api, entry, profile, price, previous);
  }
  await ctx.reply(lines.join("\n"));
});

export default composer;
