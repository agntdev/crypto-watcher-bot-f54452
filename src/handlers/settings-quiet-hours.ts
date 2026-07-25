import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { store } from "../crypto.js";
import type { WatchFlow } from "../flow.js";

registerMainMenuItem({ label: "Quiet hours", data: "settings:quiet_hours", order: 30 });
const composer = new Composer<Ctx>();
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
composer.callbackQuery("settings:quiet_hours", async (ctx) => {
  await ctx.answerCallbackQuery();
  const db = await store(), profile = db && ctx.from ? await db.touch(ctx.from.id) : undefined;
  const status = profile?.quietHours ? `${profile.quietHours.start}–${profile.quietHours.end} UTC` : "Not set";
  await ctx.reply(`Quiet hours: ${status}.\nAlerts stay silent during this window.`, { reply_markup: inlineKeyboard([[inlineButton("Set quiet hours", "qh:set")], [inlineButton("Turn off", "qh:off")], [inlineButton("Back to menu", "menu:main")]]) });
});
composer.callbackQuery("qh:set", async (ctx) => { await ctx.answerCallbackQuery(); (ctx.session as WatchFlow).step = "quiet"; await ctx.reply("Send your quiet window in UTC, like 22:00-07:00.", { reply_markup: { force_reply: true, input_field_placeholder: "22:00-07:00" } }); });
composer.callbackQuery("qh:off", async (ctx) => {
  await ctx.answerCallbackQuery(); const db = await store(), userId = ctx.from?.id;
  if (!db || !userId) { await ctx.reply("Settings storage isn’t set up yet."); return; }
  const profile = await db.touch(userId); delete profile.quietHours; await db.saveProfile(profile);
  await ctx.reply("Quiet hours are off.");
});
composer.on("message:text", async (ctx, next) => {
  if ((ctx.session as WatchFlow).step !== "quiet") return next();
  const [start, end, ...extra] = ctx.message.text.trim().split("-");
  if (extra.length || !start || !end || !validTime(start) || !validTime(end) || start === end) { await ctx.reply("Use two different UTC times, like 22:00-07:00."); return; }
  const db = await store(), userId = ctx.from?.id;
  if (!db || !userId) { await ctx.reply("Settings storage isn’t set up yet."); return; }
  const profile = await db.touch(userId); profile.quietHours = { start, end }; await db.saveProfile(profile); ctx.session = {};
  await ctx.reply(`Quiet hours are set for ${start}–${end} UTC.`);
});
export default composer;
