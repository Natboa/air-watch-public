#!/usr/bin/env bun
/**
 * air-check.ts — air at the privately configured location, one run.
 *
 * Greg-Bot's air-check.sh runs this every 5 minutes and hands stdout to its
 * cron-lib, which sends and records the message; this repo never talks to
 * Telegram. Each run: MoEP stations + Open-Meteo wind → estimate → alert
 * state machine → data/air-status.json (the contract /air and any future
 * lamp/screen read) → prints the alert text, or NOTHING_TO_REPORT.
 *
 *   bun run air-check.ts            normal run
 *   bun run air-check.ts --dry-run  compute and print, write nothing
 *   bun run air-check.ts --status   print the last status (no network)
 *   bun run air-check.ts --stations raw 1-hour means per station, live (for questions)
 *   bun run air-check.ts --alerts [N] the last N alerts (default 5) with the data at that moment
 *
 * An API outage is not a crash: it becomes level "unknown" and goes through
 * the same confirmation as any other level. Only a real exception exits non-zero.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from "fs";
import { SvivaClient, apiDay, type StationMeta } from "./src/sviva";
import { fetchForecast, type WindPoint } from "./src/wind";
import { estimate, estimateUnavailable, type Estimate, type StationInput } from "./src/estimate";
import { step, movedStations, applyHysteresis, EMPTY_STATE, type AlertState } from "./src/alert";
import { buildStatus, formatStatusHe, formatAlertHe, formatMovedHe, formatStationsHe, type AirStatus } from "./src/format";
import { HOME, LOCAL_STATION_IDS, WIND_STATION_IDS, SOURCES } from "./src/config";
import { historyEntry } from "./src/history";

const DIR = process.env.AIR_DIR ?? `${import.meta.dir}/data`;
const STATE = `${DIR}/air-state.json`;
const STATUS = `${DIR}/air-status.json`;
/** One JSON line per alert sent: what was said, and the full status it was based on. */
const ALERTS = `${DIR}/air-alerts.jsonl`;
/** One line per run, read by air-weekly.ts for the Friday chart (pruned there to 60 days). */
const HISTORY = `${DIR}/history.jsonl`;
const args = new Set(process.argv.slice(2));

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}
function writeJsonAtomic(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}

if (args.has("--status")) {
  console.log(existsSync(STATUS)
    ? formatStatusHe(readJson<AirStatus>(STATUS, null as unknown as AirStatus), new Date())
    : "אין עדיין נתוני אוויר — הבדיקה עוד לא רצה.");
  process.exit(0);
}

if (args.has("--alerts")) {
  const n = Number(process.argv[process.argv.indexOf("--alerts") + 1]) || 5;
  const rows = existsSync(ALERTS) ? readFileSync(ALERTS, "utf8").trim().split("\n").filter(Boolean).slice(-n) : [];
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  console.log(rows.length
    ? rows.map((r) => {
        const a = JSON.parse(r) as { at: string; text: string; status: AirStatus };
        return `🕒 ${fmt(a.at)}\n${a.text}\n— הנתונים באותו רגע —\n${formatStatusHe(a.status, new Date(a.at), false)}`;
      }).join("\n\n")
    : "עדיין לא נשלחו התראות.");
  process.exit(0);
}

const now = new Date();
const wanted = new Set<number>([...LOCAL_STATION_IDS, ...WIND_STATION_IDS, ...SOURCES.flatMap((s) => s.stationIds)]);
let metas: StationMeta[] = [];
let fetched: StationInput[] = [];
let est: Estimate;

try {
  const client = new SvivaClient();
  await client.auth();
  metas = (await client.stations()).filter((m) => wanted.has(m.id));
  // Cover the last 70 minutes even across the API's UTC+2 midnight.
  const fromDay = apiDay(new Date(now.getTime() - 70 * 60_000));
  const toDay = apiDay(now);
  const results = await Promise.allSettled(
    metas.map(async (m) => ({ meta: m, samples: await client.samples(m.id, fromDay, toDay) })),
  );
  const inputs = new Map<number, StationInput>();
  for (const r of results) {
    if (r.status === "fulfilled") inputs.set(r.value.meta.id, r.value);
    else console.error(`[air] station fetch failed: ${String(r.reason).slice(0, 200)}`);
  }
  let forecast: WindPoint[] = [];
  try { forecast = await fetchForecast(HOME.lat, HOME.lon); }
  catch (e) { console.error(`[air] forecast failed: ${String(e).slice(0, 200)}`); }

  fetched = [...inputs.values()];
  const pick = (ids: readonly number[]) => ids.map((id) => inputs.get(id)).filter((x): x is StationInput => !!x);
  est = estimate({
    now, local: pick(LOCAL_STATION_IDS), wind: pick(WIND_STATION_IDS),
    sources: SOURCES.map((def) => ({ def, stations: pick(def.stationIds) })), forecast,
  });
} catch (e) {
  console.error(`[air] MoEP API failed: ${String(e).slice(0, 300)}`);
  est = estimateUnavailable(now, "שירות הניטור של המשרד להגנת הסביבה לא זמין כרגע");
}

if (args.has("--stations")) {
  console.log(fetched.length ? formatStationsHe(fetched, now) : "לא הצלחתי למשוך נתוני תחנות כרגע.");
  process.exit(0);
}

const prev = readJson<AlertState>(STATE, EMPTY_STATE);
const { moved, locations } = movedStations(prev, metas);
const { state, notify } = step(prev, applyHysteresis(est.level, est.score, prev.confirmed), now);
state.stationLocations = locations;
const status = buildStatus(est, state.confirmed);

if (args.has("--dry-run")) {
  console.log(formatStatusHe(status, now));
  console.log(`\n[dry-run] raw level ${est.level}, confirmed ${state.confirmed}, would notify: ${notify}`);
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
writeJsonAtomic(STATE, state);
writeJsonAtomic(STATUS, status);
appendFileSync(HISTORY, JSON.stringify(historyEntry(est, state.confirmed, notify)) + "\n");
const parts: string[] = [];
if (notify) parts.push(formatAlertHe(status));
for (const m of moved) parts.push(formatMovedHe(m.meta, m.km));
if (parts.length) appendFileSync(ALERTS, JSON.stringify({ at: now.toISOString(), text: parts.join("\n\n"), status }) + "\n");
console.log(parts.length ? parts.join("\n\n") : "NOTHING_TO_REPORT");
