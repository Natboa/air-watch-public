/**
 * air-status.json is the one contract every consumer reads: Greg-Bot's /air,
 * and the future lamp/screen. `level`/`color`/`windows` are the CONFIRMED
 * (stable) level; `score`/`rawLevel`/`lead` describe this run's raw estimate.
 */
import { HOME, LEVELS, UNKNOWN_LEVEL, LIMITS_UGM3 } from "./config";
import { HOME_TZ } from "./time";
import { rollingMean, type Estimate, type StationInput } from "./estimate";
import { distanceKm, bearingDeg } from "./geo";
import type { StationMeta } from "./sviva";

export interface AirStatus {
  updatedAt: string;
  level: number | null; levelKey: string; nameHe: string; color: string;
  windows: "open" | "short" | "closed" | "unknown";
  score: number | null; rawLevel: number | null;
  lead: { pollutant: string; ugm3: number; pct: number; origin: "local" | "upwind" } | null;
  wind: { fromDeg: number; speedMs: number; origin: "station" | "forecast" } | null;
  upwind: { source: string; nameHe: string; etaMin: number; pct: number } | null;
  nextBayWindAt: string | null;
  note: string | null;
  stations: { id: number; name: string; distanceKm: number; ageMin: number }[];
  /** Shown, never scored (ozone). µg/m³. */
  info: Record<string, number>;
  /** Local benzene, always — a monitored pollutant even when dust leads. */
  benzene: { ugm3: number; pct: number } | null;
  /** Every local pollutant this run; pct is null for info-only channels (ozone). Additive — older readers ignore it. */
  pollutants: Record<string, { ugm3: number; pct: number | null }>;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
/** Whole µg/m³ from 10 up, one decimal below (benzene lives around 0.3–4). */
const roundConc = (x: number) => (x >= 10 ? Math.round(x) : round1(x));

export function buildStatus(est: Estimate, confirmed: number | null): AirStatus {
  const def = confirmed === null ? null : LEVELS[confirmed];
  return {
    updatedAt: est.at.toISOString(),
    level: confirmed,
    levelKey: def?.key ?? UNKNOWN_LEVEL.key,
    nameHe: def?.nameHe ?? UNKNOWN_LEVEL.nameHe,
    color: def?.color ?? UNKNOWN_LEVEL.color,
    windows: def?.windows ?? UNKNOWN_LEVEL.windows,
    score: est.score === null ? null : Math.round(est.score),
    rawLevel: est.level,
    lead: est.lead
      ? { pollutant: est.lead.pollutant, ugm3: roundConc(est.lead.ugm3), pct: Math.round(est.lead.pct), origin: est.lead.origin }
      : null,
    wind: est.wind ? { fromDeg: Math.round(est.wind.fromDeg), speedMs: round1(est.wind.speedMs), origin: est.wind.origin } : null,
    upwind: est.upwind
      ? { source: est.upwind.key, nameHe: est.upwind.nameHe, etaMin: est.upwind.etaMin, pct: Math.round(est.upwind.pct) }
      : null,
    nextBayWindAt: est.nextBayWindAt ? est.nextBayWindAt.toISOString() : null,
    note: est.note,
    stations: est.local,
    info: Object.fromEntries(Object.entries(est.info).map(([k, v]) => [k, roundConc(v)])),
    benzene: est.benzene === null ? null : { ugm3: roundConc(est.benzene), pct: Math.round((est.benzene / LIMITS_UGM3.Benzene) * 100) },
    pollutants: Object.fromEntries(Object.entries(est.means ?? {}).map(([k, v]) => {
      const limit = (LIMITS_UGM3 as Record<string, number>)[k];
      return [k, { ugm3: roundConc(v), pct: limit ? Math.round((v / limit) * 100) : null }];
    })),
  };
}

const EMOJI = ["🟢", "🟢", "🟡", "🟠", "🔴", "🟣"];
const LABEL: Record<string, string> = { Benzene: "בנזן", O3: "אוזון" };
const WINDOWS_HE = {
  open: "🪟 אפשר לפתוח חלונות",
  short: "🪟 אוורור קצר בלבד",
  closed: "🪟 עדיף לסגור חלונות",
  unknown: "🪟 אין המלצה — אין נתונים עדכניים",
} as const;
const COMPASS = ["צפון", "צפון-מזרח", "מזרח", "דרום-מזרח", "דרום", "דרום-מערב", "מערב", "צפון-מערב"];

export const compassHe = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export function formatStatusHe(s: AirStatus, now: Date, withAge = true): string {
  const lines: string[] = [];
  let head = `${s.level === null ? "⚪" : EMOJI[s.level]} איכות האוויר בבית: ${s.nameHe}`;
  if (s.score !== null) head += ` (ציון ${s.score})`;
  if (s.rawLevel !== s.level) head += ` · מתעדכן ל${s.rawLevel === null ? "אין נתונים" : LEVELS[s.rawLevel].nameHe}`;
  lines.push(head);
  if (s.lead) {
    const where = s.lead.origin === "local" ? "נמדד בסביבה" : "צפוי להגיע ברוח";
    lines.push(`מוביל: ${LABEL[s.lead.pollutant] ?? s.lead.pollutant} ${s.lead.ugm3} µg/m³, ${s.lead.pct}% מהסף (${where})`);
  }
  if (s.wind) {
    let w = `רוח: ${compassHe(s.wind.fromDeg)} (${s.wind.fromDeg}°), ${s.wind.speedMs} מ/ש${s.wind.origin === "forecast" ? " (תחזית)" : ""}`;
    if (s.upwind) w += ` — מכיוון ${s.upwind.nameHe}, הגעה משוערת בעוד כ-${s.upwind.etaMin} דק'`;
    lines.push(w);
  }
  if (s.benzene && s.lead?.pollutant !== "Benzene") lines.push(`בנזן ${s.benzene.ugm3} µg/m³, ${s.benzene.pct}% מהסף`);
  for (const [k, v] of Object.entries(s.info ?? {})) lines.push(`${LABEL[k] ?? k} ${v} µg/m³ (מידע בלבד, לא נכלל בציון)`);
  lines.push(WINDOWS_HE[s.windows]);
  if (!s.upwind && s.nextBayWindAt) lines.push(`⏭ רוח מכיוון המפרץ צפויה בסביבות ${hhmm(s.nextBayWindAt)}`);
  if (s.note) lines.push(`ℹ️ ${s.note}`);
  if (s.stations.length) lines.push(`תחנות: ${s.stations.map((st) => `${st.name} (${st.distanceKm} ק"מ)`).join(", ")}`);
  if (withAge) {
    const age = Math.max(0, Math.round((now.getTime() - new Date(s.updatedAt).getTime()) / 60_000));
    lines.push(`עודכן לפני ${age} דק'`);
  }
  return lines.join("\n");
}

/** Line 1 of an alert, by confirmed level: what to do with the windows. */
const ADVICE_HE = [
  "🟢 אפשר לפתוח חלונות",
  "🟢 אפשר לפתוח חלונות",
  "🟡 אפשר לאוורר לזמן קצר",
  "🟠 עדיף לסגור חלונות",
  "🔴 סגור חלונות",
  "🟣 סגור חלונות והישאר בפנים",
];
/** Plain-language cause, for the alert's second line. */
const CAUSE_HE: Record<string, string> = {
  "PM2.5": "אבק", PM10: "אבק", Benzene: "בנזן",
  NO2: "זיהום מתחבורה (NO2)", SO2: "גופרית דו־חמצנית (SO2)",
};

/**
 * Telegram alert, the concise alert format (2026-10-15): the window advice, then one
 * line of why or until when. Times come only from wind data (upwind ETA, the
 * next bay wind) — never a guessed end to a dust episode. Details live in /air.
 */
export function formatAlertHe(s: AirStatus): string {
  if (s.level === null) return "⚪ אין נתונים עדכניים\nהתחנות לא מדווחות כרגע. אעדכן כשיחזרו";
  const advice = ADVICE_HE[s.level];
  if (s.level >= 3) {
    const cause = s.lead ? CAUSE_HE[s.lead.pollutant] ?? s.lead.pollutant : "זיהום";
    if (s.lead?.origin === "upwind" && s.upwind) {
      const when = s.upwind.etaMin <= 5 ? "מגיע עכשיו" : `בדרך — יגיע בעוד כ-${s.upwind.etaMin} דק'`;
      return `${advice}\n${cause} מ${s.upwind.nameHe} ${when}`;
    }
    return `${advice}\n${cause} באזור`;
  }
  if (s.nextBayWindAt) return `${advice}\nעד ${hhmm(s.nextBayWindAt)} בערך — אז צפויה רוח מהמפרץ`;
  return `${advice}\n${s.level === 2 ? "האוויר השתפר" : "האוויר חזר לרמה טובה"}`;
}

export function formatMovedHe(meta: StationMeta, km: number): string {
  return `📍 התחנה ${meta.name} הועברה ${km.toFixed(1)} ק"מ ממיקומה הקודם: ${meta.address}`;
}

const RAW_CHANNELS = ["Benzene", "Toluene", "PM2.5", "PM10", "NO2", "SO2", "O3", "WD", "WS"];
const RAW_LABEL: Record<string, string> = { Benzene: "בנזן", Toluene: "טולואן", O3: "אוזון", WD: "כיוון רוח", WS: "מהירות רוח" };

/**
 * One line per station with its own 1-hour means, so the bot can answer
 * "what exactly did the stations show?". Pollutants µg/m³, WD degrees, WS m/s.
 */
export function formatStationsHe(inputs: StationInput[], now: Date): string {
  return [...inputs]
    .sort((a, b) => distanceKm(HOME, a.meta) - distanceKm(HOME, b.meta))
    .map(({ meta, samples }) => {
      const head = `${meta.name} (${meta.id}${meta.mobile ? ", ניידת" : ""}) · ${round1(distanceKm(HOME, meta))} ק"מ, ${Math.round(bearingDeg(HOME, meta))}°`;
      const vals: string[] = [];
      let age: number | null = null;
      for (const ch of RAW_CHANNELS) {
        const m = rollingMean(samples, ch, now);
        if (!m) continue;
        age = age === null ? m.ageMin : Math.min(age, m.ageMin);
        vals.push(`${RAW_LABEL[ch] ?? ch} ${ch === "WD" ? Math.round(m.mean) : roundConc(m.mean)}`);
      }
      return vals.length ? `${head} · לפני ${Math.round(age!)} דק' · ${vals.join(", ")}` : `${head} · לא מדווחת`;
    })
    .join("\n");
}
