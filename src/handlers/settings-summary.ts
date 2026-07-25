import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { store } from "../crypto.js";
import type { WatchFlow } from "../flow.js";

registerMainMenuItem({ label: "Morning summary", data: "settings:summary", order: 40 });
const composer = new Composer<Ctx>();
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
composer.callbackQuery("settings:summary", async (ctx) => {
  await ctx.answerCallbackQuery(); const db = await store(), profile = db && ctx.from ? await db.touch(ctx.from.id) : undefined;
  await ctx.reply(profile?.summaryEnabled ? `Morning summary is on for ${profile.summaryTime} UTC.` : "Morning summary is off.", { reply_markup: inlineKeyboard([[inlineButton("Turn on", "ms:on")], [inlineButton("Turn off", "ms:off")], [inlineButton("Set time", "ms:time")], [inlineButton("Back to menu", "menu:main")]]) });
});
async function update(ctx: Ctx, enabled: boolean) {
  const db = await store(), userId = ctx.from?.id;
  if (!db || !userId) { await ctx.reply("Settings storage isn’t set up yet."); return; }
  const profile = await db.touch(userId); profile.summaryEnabled = enabled; await db.saveProfile(profile);
  await ctx.reply(enabled ? `Morning summary is on for ${profile.summaryTime} UTC.` : "Morning summary is off.");
}
composer.callbackQuery("ms:on", async (ctx) => { await ctx.answerCallbackQuery(); await update(ctx, true); });
composer.callbackQuery("ms:off", async (ctx) => { await ctx.answerCallbackQuery(); await update(ctx, false); });
composer.callbackQuery("ms:time", async (ctx) => { await ctx.answerCallbackQuery(); (ctx.session as WatchFlow).step = "summaryTime"; await ctx.reply("Send the daily summary time in UTC, like 09:00.", { reply_markup: { force_reply: true, input_field_placeholder: "09:00" } }); });
composer.on("message:text", async (ctx, next) => {
  if ((ctx.session as WatchFlow).step !== "summaryTime") return next();
  const time = ctx.message.text.trim();
  if (!validTime(time)) { await ctx.reply("Use a UTC time like 09:00."); return; }
  const db = await store(), userId = ctx.from?.id;
  if (!db || !userId) { await ctx.reply("Settings storage isn’t set up yet."); return; }
  const profile = await db.touch(userId); profile.summaryTime = time; await db.saveProfile(profile); ctx.session = {};
  await ctx.reply(`Morning summary time is ${time} UTC.`);
});
export default composer;
