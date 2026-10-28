/**
 * data/history.jsonl: one line per 5-minute run — what the system thought and
 * whether it alerted. The weekly chart is drawn from this, so it shows exactly
 * what the user was told, not a recomputation.
 */
import type { Estimate } from "./estimate";

export interface HistoryEntry {
  at: string;
  /** Raw score of that run (% of the worst pollutant's limit). */
  score: number | null;
  /** Raw level of that run. */
  level: number | null;
  /** The confirmed (lamp) level after that run. */
  confirmed: number | null;
  lead: string | null;
  /** Local benzene mean, µg/m³. */
  benzene: number | null;
  notified: boolean;
}

export function historyEntry(est: Estimate, confirmed: number | null, notified: boolean): HistoryEntry {
  return {
    at: est.at.toISOString(),
    score: est.score === null ? null : Math.round(est.score),
    level: est.level,
    confirmed,
    lead: est.lead?.pollutant ?? null,
    benzene: est.benzene === null ? null : Math.round(est.benzene * 10) / 10,
    notified,
  };
}

export function parseHistory(text: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as HistoryEntry;
      if (typeof e.at === "string" && !Number.isNaN(Date.parse(e.at))) out.push(e);
    } catch { /* a torn or foreign line must not break the report */ }
  }
  return out;
}

/** The file text with only well-formed lines from the last `days` days. */
export function pruneHistory(text: string, now: Date, days: number): string {
  const cutoff = now.getTime() - days * 86_400_000;
  const kept = parseHistory(text).filter((e) => Date.parse(e.at) >= cutoff);
  return kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : "");
}
