import type { Api, Bot } from "grammy";

/** The one clock seam used by alerts, summaries, and the daily processor. */
let clock: () => Date = () => new Date();
export function now(): Date { return clock(); }
export function setClockForTests(next?: () => Date): void { clock = next ?? (() => new Date()); }

export interface Profile {
  telegramId: number;
  timezone: string;
  quietHours?: { start: string; end: string };
  summaryEnabled: boolean;
  summaryTime: string;
  summaryLastSentDay?: string;
  cooldownMinutes: number;
  lastActiveAt: number;
}
export interface WatchEntry {
  id: string;
  userId: number;
  ticker: string;
  threshold?: number;
  movePercent?: number;
  lastNotifiedAt?: number;
  enabled: boolean;
}
export interface Snapshot { ticker: string; price: number; timestamp: number; }
interface Metrics { alertFirings: Record<string, number>; feedFailures: number; }

interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

// Redis is the toolkit's production persistence backend. There is deliberately
// no memory fallback: domain records must survive a process restart.
class DomainStore {
  constructor(private readonly backend: KeyValueStore) {}
  private async read<T>(key: string): Promise<T | undefined> {
    const raw = await this.backend.get(`crypto:${key}`);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as T; } catch { return undefined; }
  }
  private async write<T>(key: string, value: T): Promise<void> {
    await this.backend.set(`crypto:${key}`, JSON.stringify(value));
  }
  async profile(userId: number): Promise<Profile | undefined> { return this.read(`profile:${userId}`); }
  async saveProfile(profile: Profile): Promise<void> {
    await this.write(`profile:${profile.telegramId}`, profile);
    const ids = (await this.read<number[]>("users")) ?? [];
    if (!ids.includes(profile.telegramId)) await this.write("users", [...ids, profile.telegramId]);
  }
  async touch(userId: number): Promise<Profile> {
    const profile = (await this.profile(userId)) ?? {
      telegramId: userId, timezone: "UTC", summaryEnabled: false, summaryTime: "09:00",
      cooldownMinutes: 60, lastActiveAt: now().getTime(),
    };
    profile.lastActiveAt = now().getTime();
    await this.saveProfile(profile);
    return profile;
  }
  async entries(userId: number): Promise<WatchEntry[]> {
    const ids = (await this.read<string[]>(`entries:${userId}`)) ?? [];
    const rows = await Promise.all(ids.map((id) => this.read<WatchEntry>(`entry:${id}`)));
    return rows.filter((row): row is WatchEntry => Boolean(row));
  }
  async saveEntry(entry: WatchEntry): Promise<void> {
    await this.write(`entry:${entry.id}`, entry);
    const ids = (await this.read<string[]>(`entries:${entry.userId}`)) ?? [];
    if (!ids.includes(entry.id)) await this.write(`entries:${entry.userId}`, [...ids, entry.id]);
  }
  async deleteEntry(entry: WatchEntry): Promise<void> {
    // Keep the explicit index compact; the old record is harmless and is never scanned.
    const ids = (await this.read<string[]>(`entries:${entry.userId}`)) ?? [];
    await this.write(`entries:${entry.userId}`, ids.filter((id) => id !== entry.id));
    await this.write(`entry:${entry.id}`, null);
  }
  async snapshot(ticker: string): Promise<Snapshot | undefined> { return this.read(`snapshot:${ticker}`); }
  async saveSnapshot(snapshot: Snapshot): Promise<void> { await this.write(`snapshot:${snapshot.ticker}`, snapshot); }
  async users(): Promise<number[]> { return (await this.read<number[]>("users")) ?? []; }
  async metric(rule: "threshold" | "move"): Promise<void> {
    const metrics = (await this.read<Metrics>("metrics")) ?? { alertFirings: {}, feedFailures: 0 };
    metrics.alertFirings[rule] = (metrics.alertFirings[rule] ?? 0) + 1;
    await this.write("metrics", metrics);
  }
  async metrics(): Promise<Metrics> { return (await this.read<Metrics>("metrics")) ?? { alertFirings: {}, feedFailures: 0 }; }
}

let storePromise: Promise<DomainStore | null> | undefined;
let workerStore: Promise<DomainStore | null> | undefined;

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database { prepare(query: string): D1Statement; exec(query: string): Promise<unknown>; }
class D1KeyValueStore implements KeyValueStore {
  private readonly ready: Promise<unknown>;
  constructor(private readonly db: D1Database) {
    this.ready = db.exec("CREATE TABLE IF NOT EXISTS crypto_watcher_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }
  async get(key: string): Promise<string | null> {
    await this.ready;
    const row = await this.db.prepare("SELECT value FROM crypto_watcher_store WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    await this.ready;
    await this.db.prepare("INSERT INTO crypto_watcher_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
  }
}
/** Called by the Worker entry before handlers run; D1 backs the same indexed records. */
export function configureWorkerStore(binding: unknown): void {
  const db = binding as D1Database | undefined;
  workerStore = db && typeof db.prepare === "function" ? Promise.resolve(new DomainStore(new D1KeyValueStore(db))) : Promise.resolve(null);
}
export function store(): Promise<DomainStore | null> {
  if (workerStore) return workerStore;
  if (!storePromise) storePromise = (async () => {
    const url = typeof process === "undefined" ? undefined : process.env.REDIS_URL;
    if (!url) return null;
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    // Loaded only on Node deployments with the toolkit's existing Redis URL.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const module: any = require("ioredis");
    const Redis = module.default ?? module.Redis ?? module;
    return new DomainStore(new Redis(url, { maxRetriesPerRequest: null }) as KeyValueStore);
  })();
  return storePromise;
}

const COINS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", TON: "the-open-network" };
export function tickerFor(input: string): string | undefined {
  const ticker = input.trim().toUpperCase();
  return COINS[ticker] ? ticker : undefined;
}
export async function fetchPrice(ticker: string): Promise<number | undefined> {
  const id = COINS[ticker];
  if (!id) return undefined;
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`);
    if (!response.ok) return undefined;
    const body = await response.json() as Record<string, { usd?: unknown }>;
    const price = body[id]?.usd;
    return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : undefined;
  } catch { return undefined; }
}
export function changePercent(previous: number, current: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}
export function isQuiet(profile: Profile, at = now()): boolean {
  if (!profile.quietHours) return false;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  const toMinute = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  const start = toMinute(profile.quietHours.start), end = toMinute(profile.quietHours.end);
  return start === end ? false : start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
export function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 6 : 2 }).format(value);
}

export async function checkAndNotify(bot: Pick<Api, "sendMessage">, entry: WatchEntry, profile: Profile, price: number, previous?: Snapshot): Promise<void> {
  if (!entry.enabled || isQuiet(profile) || (entry.lastNotifiedAt && now().getTime() - entry.lastNotifiedAt < profile.cooldownMinutes * 60_000)) return;
  const crossed = entry.threshold !== undefined && price >= entry.threshold;
  const moved = entry.movePercent !== undefined && previous && Math.abs(changePercent(previous.price, price)) >= entry.movePercent;
  if (!crossed && !moved) return;
  const reason = crossed ? `reached your ${money(entry.threshold!)} threshold` : `moved ${changePercent(previous!.price, price).toFixed(2)}%`;
  try {
    await bot.sendMessage(entry.userId, `${entry.ticker} is ${money(price)} and ${reason}.`);
    entry.lastNotifiedAt = now().getTime();
    const db = await store();
    await db?.saveEntry(entry);
    await db?.metric(crossed ? "threshold" : "move");
  } catch { /* A blocked/private chat must not abort other notifications. */ }
}

export async function runDailyTasks(bot: Pick<Bot, "api">): Promise<void> {
  const db = await store();
  if (!db) return;
  const users = await db.users();
  const activeCutoff = now().getTime() - 30 * 86_400_000;
  const day = now().toISOString().slice(0, 10);
  const time = now().toISOString().slice(11, 16);
  let active = 0;
  for (const userId of users) {
    const profile = await db.profile(userId);
    if (!profile) continue;
    if (profile.lastActiveAt >= activeCutoff) active++;
    if (!profile.summaryEnabled || profile.summaryTime !== time || profile.summaryLastSentDay === day || isQuiet(profile)) continue;
    const rows = await db.entries(userId);
    const lines: string[] = [];
    for (const row of rows) {
      const previous = await db.snapshot(row.ticker);
      const price = await fetchPrice(row.ticker);
      if (!price || !previous) continue;
      const change = changePercent(previous.price, price);
      if (Math.abs(change) > 1) lines.push(`${row.ticker}: ${money(price)} (${change >= 0 ? "+" : ""}${change.toFixed(2)}%)`);
    }
    if (lines.length) {
      try { await bot.api.sendMessage(userId, `Morning summary\n${lines.join("\n")}`); profile.summaryLastSentDay = day; await db.saveProfile(profile); } catch { /* opt-out/blocked */ }
    }
  }
  const admin = typeof process === "undefined" ? undefined : process.env.ADMIN_CHAT_ID;
  if (admin && time === "09:00") {
    const metrics = await db.metrics();
    const top = Object.entries(metrics.alertFirings).sort((a, b) => b[1] - a[1])[0];
    try { await bot.api.sendMessage(admin, `Daily usage report\nUsers: ${users.length}\nActive in 30 days: ${active}\nTop alert rule: ${top ? `${top[0]} (${top[1]})` : "No alerts yet"}`); } catch { /* admin chat may not have started the bot */ }
  }
}
