import { test, expect } from "bun:test";
import { summarizeWeek, hourlyPeaks, renderWeekSvg, formatWeeklyHe, hasEnoughData } from "./weekly";
import { LEVELS } from "./config";
import type { HistoryEntry } from "./history";

// Fri 16 Oct 10:00 Israel (IDT, UTC+3) → Fri 23 Oct 10:00.
const FROM = new Date("2026-10-16T07:00:00Z");
const TO = new Date("2026-10-23T07:00:00Z");

function entry(iso: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { at: iso, score: 20, level: 0, confirmed: 0, lead: "PM10", benzene: 0.3, notified: false, ...over };
}
/** Every 5 minutes over [start, start + hours). */
function run(startIso: string, hours: number, over: Partial<HistoryEntry> = {}): HistoryEntry[] {
  const t0 = Date.parse(startIso);
  return Array.from({ length: hours * 12 }, (_, i) => entry(new Date(t0 + i * 300_000).toISOString(), over));
}

test("summarizeWeek counts orange+ hours by cause, alerts, worst moment, benzene and gaps", () => {
  const entries = [
    ...run("2026-10-16T07:00:00Z", 24),                                                         // a fine day
    ...run("2026-10-17T07:00:00Z", 2, { score: 120, level: 3, confirmed: 3, lead: "PM10" }),   // 2 h dust
    ...run("2026-10-17T09:00:00Z", 1, { score: 180, level: 4, confirmed: 4, lead: "Benzene", benzene: 7.1 }), // 1 h benzene
    entry("2026-10-17T07:10:00Z", { score: 125, level: 3, confirmed: 3, notified: true }),
    entry("2026-10-15T07:00:00Z", { score: 999 }),                                              // before the window
  ];
  const s = summarizeWeek(entries, FROM, TO);
  expect(s.orangeHours).toBeCloseTo(3 + 1 / 12, 5);
  expect(Object.keys(s.causes).sort()).toEqual(["אבק", "בנזן"]);
  expect(s.causes["אבק"]).toBeCloseTo(2 + 1 / 12, 5);
  expect(s.causes["בנזן"]).toBeCloseTo(1, 5);
  expect(s.alerts).toBe(1);
  expect(s.worst).toEqual({ at: new Date("2026-10-17T09:00:00Z"), score: 180, lead: "Benzene" });
  expect(s.benzeneMax).toBe(7.1);
  expect(s.benzeneAvg).toBeGreaterThan(0.3);
  expect(s.missingHours).toBe(168 - 27);
});

test("hourlyPeaks takes the max per hour and leaves empty hours null", () => {
  const peaks = hourlyPeaks([entry("2026-10-16T07:05:00Z", { score: 40 }), entry("2026-10-16T07:40:00Z", { score: 90 }),
    entry("2026-10-16T09:00:00Z", { score: null })], FROM, TO);
  expect(peaks).toHaveLength(168);
  expect(peaks[0].peak).toBe(90);
  expect(peaks[1].peak).toBeNull();
  expect(peaks[2].peak).toBeNull();   // only a no-data reading
});

test("renderWeekSvg: lamp-colour bands, a broken line across gaps, day separators, alert dots", () => {
  const entries = [...run("2026-10-16T07:00:00Z", 10), ...run("2026-10-17T07:00:00Z", 10, { score: 120, level: 3 }),
    entry("2026-10-17T08:00:00Z", { score: 130, level: 3, notified: true })];
  const svg = renderWeekSvg(entries, FROM, TO);
  expect(svg.startsWith("<svg")).toBe(true);
  for (const l of LEVELS.slice(0, 4)) expect(svg).toContain(l.color);
  expect(svg.match(/<polyline/g)).toHaveLength(2);       // two runs of data, gap between
  expect(svg.match(/class="day"/g)).toHaveLength(7);    // 7 Israeli midnights in the window
  expect(svg).toContain(">17/10<");
  expect(svg.match(/class="alert"/g)).toHaveLength(1);
});

test("formatWeeklyHe: short Hebrew caption", () => {
  const entries = [...run("2026-10-16T07:00:00Z", 168),
    ...run("2026-10-20T11:00:00Z", 1, { score: 156, level: 4, confirmed: 4, lead: "PM10" }),
    entry("2026-10-20T11:00:00Z", { score: 156, level: 4, confirmed: 4, notified: true })];
  const text = formatWeeklyHe(summarizeWeek(entries, FROM, TO));
  expect(text).toContain("📊 סיכום זיהום אוויר — 16/10–23/10");
  expect(text).toContain("🟠 כתום ומעלה: שעה (אבק)");
  expect(text).toContain("🔔 התראות: 1");
  expect(text).toContain("⚠️ הרגע הכי גרוע: שלישי 20/10 14:00 — אבק, ציון 156");
  expect(text).toContain("בנזן: ממוצע 0.3, שיא 0.3 µg/m³");
  expect(text).toContain("● בגרף = רגע שנשלחה התראה");
  expect(text).not.toContain("ללא נתונים");
});

test("formatWeeklyHe: a clean week, and missing data is reported", () => {
  const text = formatWeeklyHe(summarizeWeek(run("2026-10-16T07:00:00Z", 100), FROM, TO));
  expect(text).toContain("🟢 לא היו שעות בכתום ומעלה");
  expect(text).toContain("⚪ ללא נתונים: 68 שעות");
  expect(text).not.toContain("●");
});

test("orange held through a data gap counts as hours but not as a cause", () => {
  const s = summarizeWeek(run("2026-10-17T07:00:00Z", 1, { score: null, level: null, confirmed: 3, lead: null }), FROM, TO);
  expect(s.orangeHours).toBeCloseTo(1, 5);
  expect(s.causes).toEqual({});
  expect(formatWeeklyHe(s)).toContain("🟠 כתום ומעלה: שעה");
  expect(formatWeeklyHe(s)).not.toContain("()");
});

test("hasEnoughData: a week with under 72 covered hours is skipped (the first, partial week)", () => {
  expect(hasEnoughData(summarizeWeek(run("2026-10-16T07:00:00Z", 10), FROM, TO), 72)).toBe(false);
  expect(hasEnoughData(summarizeWeek(run("2026-10-16T07:00:00Z", 72), FROM, TO), 72)).toBe(true);
});
