#!/usr/bin/env bun
/**
 * Replays the Air Watch engine over past days using MoEP history.
 *   bun run scripts/backtest.ts --from 2026-07-15 --to 2026-10-15 [--no-mobile] [--dilution 0.3] [--limits PM10=50,PM2.5=25]
 * Prints hours per confirmed level, how many Telegram messages would have gone
 * out, and the message timeline for 9–12 Oct 2026 (the Bazan benzene incident).
 * Station-days are cached in .air-cache/, so reruns are offline.
 * Caveat: mobile stations are placed at their CURRENT location for the whole
 * period (the API has no location history) — compare with --no-mobile.
 * No forecast in the backtest: wind comes from stations only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { SvivaClient, type Sample, type StationMeta } from "../src/sviva";
import { estimate, type StationInput } from "../src/estimate";
import { step, bandOf, applyHysteresis, EMPTY_STATE, type AlertState } from "../src/alert";
import { LEVELS, LOCAL_STATION_IDS, WIND_STATION_IDS, SOURCES, PLUME_DILUTION, type Pollutant } from "../src/config";
import { historyEntry } from "../src/history";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? undefined : process.argv[i + 1]; };
const FROM = arg("from") ?? "2026-07-15";
const TO = arg("to") ?? "2026-10-15";
const NO_MOBILE = process.argv.includes("--no-mobile");
const DILUTION = Number(arg("dilution") ?? PLUME_DILUTION);
/** Write the replay as a history.jsonl (same format as live), e.g. to preview the weekly chart. */
const HISTORY_OUT = arg("history-out");
const historyLines: string[] = [];
/** e.g. "PM10=50,PM2.5=25" — overrides LIMITS_UGM3 for this run only. */
const LIMITS = Object.fromEntries((arg("limits") ?? "").split(",").filter(Boolean)
  .map((kv) => { const [k, v] = kv.split("="); return [k, Number(v)]; })) as Partial<Record<Pollutant, number>>;
const CACHE = ".air-cache";
const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(d);

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const client = new SvivaClient();
await client.auth();

/** One station-day, from the cache or the API (the client re-authenticates on 401 itself). */
async function load(id: number, day: string): Promise<Sample[]> {
  const file = `${CACHE}/${id}-${day}.json`;
  if (existsSync(file)) {
    return (JSON.parse(readFileSync(file, "utf8")) as { t: string; values: Record<string, number> }[])
      .map((s) => ({ t: new Date(s.t), values: s.values }));
  }
  const samples = await client.samples(id, day, day);
  writeFileSync(file, JSON.stringify(samples));
  return samples;
}

/** Index of the first sample at or after t (samples sorted by time). */
function lowerBound(s: Sample[], t: number): number {
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid].t.getTime() < t) lo = mid + 1; else hi = mid; }
  return lo;
}

mkdirSync(CACHE, { recursive: true });
const wanted = new Set<number>([...LOCAL_STATION_IDS, ...WIND_STATION_IDS, ...SOURCES.flatMap((s) => s.stationIds)]);
const metas = (await client.stations()).filter((m) => wanted.has(m.id) && !(NO_MOBILE && m.mobile));
const series = new Map<number, { meta: StationMeta; samples: Sample[] }>();
for (const m of metas) {
  const all: Sample[] = [];
  for (const d of days(FROM, TO)) {
    try { all.push(...await load(m.id, d)); }
    catch (e) { console.error(`  ${m.id} ${d}: ${String(e).slice(0, 120)}`); }
  }
  all.sort((a, b) => a.t.getTime() - b.t.getTime());
  series.set(m.id, { meta: m, samples: all });
  console.log(`  ${m.id} ${m.name}${m.mobile ? " (mobile)" : ""}: ${all.length} samples`);
}

const windowAt = (id: number, t: number): StationInput | undefined => {
  const s = series.get(id);
  if (!s) return undefined;
  return { meta: s.meta, samples: s.samples.slice(lowerBound(s.samples, t - 110 * 60_000), lowerBound(s.samples, t + 1)) };
};
const pick = (ids: readonly number[], t: number) => ids.map((id) => windowAt(id, t)).filter((x): x is StationInput => !!x);

let state: AlertState = EMPTY_STATE;
const hours = new Map<string, number>();
const events: string[] = [];
let maxRaw = -1;
let firstVeryHigh: Date | null = null;
/** Hours at raw level ≥3 (orange+), by the pollutant that drove them. */
const drivers = new Map<string, number>();
const start = new Date(`${FROM}T00:00:00+02:00`).getTime();
const end = new Date(`${TO}T23:55:00+02:00`).getTime();
for (let t = start; t <= end; t += 5 * 60_000) {
  const now = new Date(t);
  const est = estimate({
    now, local: pick(LOCAL_STATION_IDS, t), wind: pick(WIND_STATION_IDS, t),
    sources: SOURCES.map((def) => ({ def, stations: pick(def.stationIds, t) })), forecast: [], dilution: DILUTION, limits: LIMITS,
  });
  const r = step(state, applyHysteresis(est.level, est.score, state.confirmed), now);
  state = r.state;
  if (HISTORY_OUT) historyLines.push(JSON.stringify(historyEntry(est, state.confirmed, r.notify)));
  const key = state.confirmed === null ? "unknown" : LEVELS[state.confirmed].key;
  hours.set(key, (hours.get(key) ?? 0) + 5 / 60);
  if (r.notify) {
    const why = est.lead
      ? `${est.lead.pollutant} ${Math.round(est.lead.pct)}% (${est.lead.origin}${est.upwind ? ` from ${est.upwind.key}` : ""})`
      : est.note ?? "";
    events.push(`${fmt(now)}  → ${bandOf(state.confirmed).padEnd(9)} ${why}`);
  }
  if (est.level !== null && est.level > maxRaw) maxRaw = est.level;
  if (est.level !== null && est.level >= 3 && est.lead) {
    const k = `${est.lead.pollutant} (${est.lead.origin})`;
    drivers.set(k, (drivers.get(k) ?? 0) + 5 / 60);
  }
  if (!firstVeryHigh && est.level !== null && est.level >= 4) firstVeryHigh = now;
}

const total = [...hours.values()].reduce((a, b) => a + b, 0);
console.log(`\nBacktest ${FROM} → ${TO}${NO_MOBILE ? " (no mobile stations)" : ""}, dilution ${DILUTION}, limits ${JSON.stringify(LIMITS)}`);
for (const k of [...LEVELS.map((l) => l.key), "unknown"]) {
  const h = hours.get(k) ?? 0;
  console.log(`  ${k.padEnd(10)} ${h.toFixed(0).padStart(5)} h  ${((100 * h) / total).toFixed(1).padStart(5)}%`);
}
console.log(`\nTelegram messages that would have gone out: ${events.length} (${(events.length / days(FROM, TO).length).toFixed(1)}/day)`);
console.log(`Max raw level: ${maxRaw}; first raw level ≥4: ${firstVeryHigh ? fmt(firstVeryHigh) : "never"}`);
console.log(`Orange+ hours by driver: ${[...drivers].sort((a, b) => b[1] - a[1]).map(([k, h]) => `${k} ${h.toFixed(0)}h`).join(", ")}`);
console.log(`\nMessages 9–12 Oct 2026:`);
for (const e of events.filter((e) => /^(09|10|11|12)\/10\/2026/.test(e))) console.log(`  ${e}`);
console.log(`\nAll messages:`);
for (const e of events) console.log(`  ${e}`);

if (HISTORY_OUT) {
  writeFileSync(HISTORY_OUT, historyLines.join("\n") + "\n");
  console.log(`history written: ${HISTORY_OUT} (${historyLines.length} lines)`);
}
