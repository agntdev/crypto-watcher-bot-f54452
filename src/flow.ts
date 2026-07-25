/** Ephemeral conversation state only; durable records live in Redis. */
export interface WatchFlow {
  step?: "ticker" | "value" | "confirm" | "quiet" | "summaryTime";
  ticker?: string;
  alertKind?: "threshold" | "move";
  value?: number;
}
