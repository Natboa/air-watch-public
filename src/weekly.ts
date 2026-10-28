/**
 * The Friday summary: one chart (hourly peak score over the lamp's colour
 * bands, a dot where an alert went out) plus a short Hebrew caption. Drawn
 * from data/history.jsonl, i.e. exactly what the user was shown that week. The SVG
 * carries no Hebrew (numbers and dates only); the caption carries the words.
 */
import { LEVELS } from "./config";
import { hourIn, HOME_TZ } from "./time";
import type { HistoryEntry } from "./history";

const HOUR = 3_600_000;
const STEP_H = 5 / 60; // each history entry stands for one 5-minute run

export interface WeekSummary {
  from: Date; to: Date;
  /** Hours the lamp (confirmed level) was orange or worse. */
  orangeHours: number;
  /** Those hours by plain-language cause. */
  causes: Record<string, number>;
  alerts: number;
  worst: { at: Date; score: number; lead: string | null } | null;
  benzeneAvg: number | null; benzeneMax: number | null;
  /** Hours of the window with no usable reading at all. */
  missingHours: number;
}

const CAUSE_HE: Record<string, string> = { PM10: "אבק", "PM2.5": "אבק", Benzene: "בנזן", NO2: "תחבורה (NO2)", SO2: "SO2" };
const causeHe = (lead: string | null) => (lead ? CAUSE_HE[lead] ?? lead : "לא ידוע");

function inWindow(entries: HistoryEntry[], from: Date, to: Date) {
  return entries
    .map((e) => ({ ...e, t: Date.parse(e.at) }))
    .filter((e) => e.t >= from.getTime() && e.t < to.getTime())
    .sort((a, b) => a.t - b.t);
}

export function summarizeWeek(entries: HistoryEntry[], from: Date, to: Date): WeekSummary {
  const es = inWindow(entries, from, to);
  const causes: Record<string, number> = {};
  let orangeHours = 0, alerts = 0, bSum = 0, bN = 0;
  let bMax: number | null = null;
  let worst: WeekSummary["worst"] = null;
  const covered = new Set<number>();
  for (const e of es) {
    if (e.confirmed !== null && e.confirmed >= 3) {
      orangeHours += STEP_H;
      // A confirmed orange held through a data gap has no cause to name.
      if (e.lead !== null) causes[causeHe(e.lead)] = (causes[causeHe(e.lead)] ?? 0) + STEP_H;
    }
    if (e.notified) alerts++;
    if (e.score !== null) {
      covered.add(Math.floor((e.t - from.getTime()) / HOUR));
      if (!worst || e.score > worst.score) worst = { at: new Date(e.t), score: e.score, lead: e.lead };
    }
    if (e.benzene !== null) {
      bSum += e.benzene; bN++;
      bMax = bMax === null ? e.benzene : Math.max(bMax, e.benzene);
    }
  }
  const hours = Math.round((to.getTime() - from.getTime()) / HOUR);
  return {
    from, to, orangeHours, causes, alerts, worst,
    benzeneAvg: bN ? bSum / bN : null, benzeneMax: bMax,
    missingHours: hours - covered.size,
  };
}

/** Enough covered hours to be worth a Friday message (the first, partial week isn't). */
export function hasEnoughData(s: WeekSummary, minHours: number): boolean {
  const hours = Math.round((s.to.getTime() - s.from.getTime()) / HOUR);
  return hours - s.missingHours >= minHours;
}

/** The highest score in each hour of [from, to); null where there was no reading. */
export function hourlyPeaks(entries: HistoryEntry[], from: Date, to: Date): { t: Date; peak: number | null }[] {
  const n = Math.round((to.getTime() - from.getTime()) / HOUR);
  const peaks: (number | null)[] = Array(n).fill(null);
  for (const e of inWindow(entries, from, to)) {
    if (e.score === null) continue;
    const i = Math.floor((e.t - from.getTime()) / HOUR);
    peaks[i] = peaks[i] === null ? e.score : Math.max(peaks[i]!, e.score);
  }
  return peaks.map((peak, i) => ({ t: new Date(from.getTime() + i * HOUR), peak }));
}

const dm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, day: "2-digit", month: "2-digit" }).format(d);
const hhmm = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const WEEKDAY_HE: Record<string, string> = { Sun: "ראשון", Mon: "שני", Tue: "שלישי", Wed: "רביעי", Thu: "חמישי", Fri: "שישי", Sat: "שבת" };
const weekdayHe = (d: Date) => WEEKDAY_HE[new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, weekday: "short" }).format(d)];

export function renderWeekSvg(entries: HistoryEntry[], from: Date, to: Date): string {
  const W = 1000, H = 500, L = 48, R = 16, T = 16, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const peaks = hourlyPeaks(entries, from, to);
  const n = peaks.length;
  const maxPeak = Math.max(0, ...peaks.map((p) => p.peak ?? 0));
  const yMax = Math.min(400, Math.max(150, Math.ceil((maxPeak * 1.05) / 50) * 50));
  const x = (hours: number) => (L + (hours / n) * pw).toFixed(1);
  const y = (v: number) => (T + ph * (1 - Math.min(v, yMax) / yMax)).toFixed(1);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Arial, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  ];
  // Lamp-colour bands.
  LEVELS.forEach((l, i) => {
    if (l.minScore >= yMax) return;
    const top = Math.min(LEVELS[i + 1]?.minScore ?? Infinity, yMax);
    out.push(`<rect x="${L}" y="${y(top)}" width="${pw}" height="${(Number(y(l.minScore)) - Number(y(top))).toFixed(1)}" fill="${l.color}" fill-opacity="0.35"/>`);
    if (l.minScore > 0) out.push(`<text x="${L - 6}" y="${Number(y(l.minScore)) + 4}" font-size="12" text-anchor="end" fill="#555">${l.minScore}</text>`);
  });
  // Israeli midnights: a separator, and the new day's date under its middle.
  for (let h = 1; h < n; h++) {
    if (hourIn(new Date(from.getTime() + h * HOUR)) !== 0) continue;
    out.push(`<line class="day" x1="${x(h)}" y1="${T}" x2="${x(h)}" y2="${T + ph}" stroke="#888" stroke-width="1" stroke-dasharray="4 4"/>`);
    out.push(`<text class="daylabel" x="${x(h + Math.min(12, (n - h) / 2))}" y="${H - B + 22}" font-size="14" text-anchor="middle" fill="#333">${dm(new Date(from.getTime() + h * HOUR))}</text>`);
  }
  // The hourly-peak line, broken wherever an hour had no reading.
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(`<polyline points="${run.join(" ")}" fill="none" stroke="#1a1a1a" stroke-width="2.5" stroke-linejoin="round"/>`);
    run = [];
  };
  peaks.forEach((p, i) => (p.peak === null ? flush() : run.push(`${x(i + 0.5)},${y(p.peak)}`)));
  flush();
  // A dot wherever an alert was sent.
  for (const e of inWindow(entries, from, to)) {
    if (!e.notified) continue;
    out.push(`<circle class="alert" cx="${x((e.t - from.getTime()) / HOUR)}" cy="${y(e.score ?? 0)}" r="6" fill="#111" stroke="#fff" stroke-width="2"/>`);
  }
  out.push(`<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="#444" stroke-width="1"/>`, "</svg>");
  return out.join("\n");
}

function hoursHe(h: number): string {
  if (h < 0.5) return "פחות משעה";
  const n = Math.round(h);
  return n === 1 ? "שעה" : n === 2 ? "שעתיים" : `${n} שעות`;
}

export function formatWeeklyHe(s: WeekSummary): string {
  const lines = [`📊 סיכום זיהום אוויר — ${dm(s.from)}–${dm(s.to)}`];
  if (s.orangeHours > 0) {
    const causes = Object.entries(s.causes).sort((a, b) => b[1] - a[1]);
    const why = causes.length === 1 ? causes[0][0] : causes.map(([c, h]) => `${c} ${Math.round(h) || "<1"}`).join(", ");
    lines.push(`🟠 כתום ומעלה: ${hoursHe(s.orangeHours)}${causes.length ? ` (${why})` : ""}`);
  } else {
    lines.push("🟢 לא היו שעות בכתום ומעלה");
  }
  lines.push(`🔔 התראות: ${s.alerts}`);
  if (s.worst) lines.push(`⚠️ הרגע הכי גרוע: ${weekdayHe(s.worst.at)} ${dm(s.worst.at)} ${hhmm(s.worst.at)} — ${causeHe(s.worst.lead)}, ציון ${s.worst.score}`);
  if (s.benzeneAvg !== null && s.benzeneMax !== null) {
    lines.push(`בנזן: ממוצע ${s.benzeneAvg.toFixed(1)}, שיא ${s.benzeneMax.toFixed(1)} µg/m³`);
  }
  if (s.missingHours > 0) lines.push(`⚪ ללא נתונים: ${hoursHe(s.missingHours)}`);
  if (s.alerts > 0) lines.push("● בגרף = רגע שנשלחה התראה");
  return lines.join("\n");
}
