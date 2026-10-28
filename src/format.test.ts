import { test, expect } from "bun:test";
import { buildStatus, compassHe, formatStatusHe, formatAlertHe, formatMovedHe, formatStationsHe } from "./format";
import { estimateUnavailable, type Estimate } from "./estimate";

const NOW = new Date("2026-10-15T19:00:00Z");
const EST: Estimate = {
  at: NOW, score: 142.4, level: 3,
  lead: { pollutant: "PM10", ugm3: 64.04, pct: 142.4, origin: "local" },
  wind: { fromDeg: 258.3, speedMs: 3.14, origin: "station" },
  calm: false,
  upwind: { key: "bazan", nameHe: 'בז"ן', distanceKm: 4.4, etaMin: 24, pct: 40 },
  local: [{ id: 602, name: "ניידת 9", distanceKm: 1.2, ageMin: 3 }],
  nextBayWindAt: null, note: null, info: { O3: 90.4 }, benzene: 7.26,
};

test("buildStatus: colour and advice follow the CONFIRMED level, numbers the raw estimate", () => {
  const s = buildStatus(EST, 2);
  expect(s).toMatchObject({ level: 2, levelKey: "moderate", color: "#f2d41b", windows: "short", rawLevel: 3, score: 142 });
  expect(s.lead).toEqual({ pollutant: "PM10", ugm3: 64, pct: 142, origin: "local" });
  expect(s.wind).toEqual({ fromDeg: 258, speedMs: 3.1, origin: "station" });
  expect(s.upwind).toEqual({ source: "bazan", nameHe: 'בז"ן', etaMin: 24, pct: 40 });
});

test("compassHe", () => {
  expect(compassHe(258)).toBe("מערב");
  expect(compassHe(0)).toBe("צפון");
  expect(compassHe(359)).toBe("צפון");
  expect(compassHe(225)).toBe("דרום-מערב");
});

test("formatStatusHe covers level, lead, wind + ETA, advice, stations, age", () => {
  const t = formatStatusHe(buildStatus(EST, 3), new Date(NOW.getTime() + 3 * 60_000));
  expect(t).toContain("🟠 איכות האוויר בבית: גבוה (ציון 142)");
  expect(t).toContain("PM10 64 µg/m³, 142% מהסף");
  expect(t).toContain("מכיוון בז\"ן, הגעה משוערת בעוד כ-24 דק'");
  expect(t).toContain("עדיף לסגור חלונות");
  expect(t).toContain("ניידת 9 (1.2 ק\"מ)");
  expect(t).toContain("עודכן לפני 3 דק'");
  expect(t).not.toContain("~"); // MarkdownV2 strike-through marker
});

test("unknown status gives no advice and no score", () => {
  const t = formatStatusHe(buildStatus(estimateUnavailable(NOW, "שירות לא זמין"), null), NOW);
  expect(t).toContain("⚪ איכות האוויר בבית: אין נתונים");
  expect(t).toContain("אין המלצה");
  expect(t).toContain("שירות לא זמין");
});

test("next bay wind shows Israel clock time when nothing is upwind now", () => {
  const s = buildStatus({ ...EST, upwind: null, nextBayWindAt: new Date("2026-10-16T11:00:00Z") }, 3);
  expect(formatStatusHe(s, NOW)).toContain("14:00");
});

test("moved-station text", () => {
  const m = { id: 602, name: "ניידת 9", lat: 0, lon: 0, active: true, mobile: true, address: "רח' הרצל 1" };
  expect(formatMovedHe(m, 2.345)).toBe("📍 התחנה ניידת 9 הועברה 2.3 ק\"מ ממיקומה הקודם: רח' הרצל 1");
});

test("ozone is shown as info, outside the score", () => {
  const s = buildStatus(EST, 3);
  expect(s.info).toEqual({ O3: 90 });
  expect(formatStatusHe(s, NOW)).toContain("אוזון 90 µg/m³ (מידע בלבד, לא נכלל בציון)");
  expect(formatStatusHe(buildStatus({ ...EST, info: {} }, 3), NOW)).not.toContain("אוזון");
});

test("benzene always gets its own line when something else leads", () => {
  const s = buildStatus(EST, 3);
  expect(s.benzene).toEqual({ ugm3: 7.3, pct: 186 });
  expect(formatStatusHe(s, NOW)).toContain("בנזן 7.3 µg/m³, 186% מהסף");
  const benzeneLeads = buildStatus({ ...EST, lead: { pollutant: "Benzene", ugm3: 7.26, pct: 186, origin: "local" } }, 3);
  expect(formatStatusHe(benzeneLeads, NOW).match(/בנזן/g)).toHaveLength(1);
  expect(buildStatus({ ...EST, benzene: null }, 3).benzene).toBeNull();
});

// Alerts use the selected "style C" (2026-10-15): the window advice, then one
// line of why/when. Times come only from wind data — never a guessed dust end.
const LOCAL_DUST: Estimate = { ...EST, upwind: null };

test("alert, orange from local dust: advice + cause, nothing else", () => {
  expect(formatAlertHe(buildStatus(LOCAL_DUST, 3))).toBe("🟠 עדיף לסגור חלונות\nאבק באזור");
});

test("alert, red from upwind benzene: says where from and when it arrives", () => {
  const est: Estimate = { ...EST, level: 4, lead: { pollutant: "Benzene", ugm3: 7, pct: 180, origin: "upwind" },
    upwind: { key: "bazan", nameHe: 'בז"ן', distanceKm: 4.4, etaMin: 20, pct: 180 } };
  expect(formatAlertHe(buildStatus(est, 4))).toBe(`🔴 סגור חלונות\nבנזן מבז"ן בדרך — יגיע בעוד כ-20 דק'`);
  const close = { ...est, upwind: { ...est.upwind!, etaMin: 3 } };
  expect(formatAlertHe(buildStatus(close, 4))).toBe(`🔴 סגור חלונות\nבנזן מבז"ן מגיע עכשיו`);
});

test("alert, purple", () => {
  const est: Estimate = { ...LOCAL_DUST, level: 5, lead: { pollutant: "Benzene", ugm3: 15, pct: 385, origin: "local" } };
  expect(formatAlertHe(buildStatus(est, 5))).toBe("🟣 סגור חלונות והישאר בפנים\nבנזן באזור");
});

test("alert, back to green: until when, if a bay wind is forecast", () => {
  const est: Estimate = { ...LOCAL_DUST, level: 0, nextBayWindAt: new Date("2026-10-16T11:00:00Z") };
  expect(formatAlertHe(buildStatus(est, 0))).toBe("🟢 אפשר לפתוח חלונות\nעד 14:00 בערך — אז צפויה רוח מהמפרץ");
  expect(formatAlertHe(buildStatus({ ...est, nextBayWindAt: null }, 1))).toBe("🟢 אפשר לפתוח חלונות\nהאוויר חזר לרמה טובה");
});

test("alert, back to yellow: short ventilation", () => {
  expect(formatAlertHe(buildStatus({ ...LOCAL_DUST, level: 2 }, 2))).toBe("🟡 אפשר לאוורר לזמן קצר\nהאוויר השתפר");
});

test("alert, no data", () => {
  expect(formatAlertHe(buildStatus(estimateUnavailable(NOW, "x"), null))).toBe("⚪ אין נתונים עדכניים\nהתחנות לא מדווחות כרגע. אעדכן כשיחזרו");
});

test("alert causes per pollutant", () => {
  const lead = (pollutant: any) => buildStatus({ ...LOCAL_DUST, lead: { pollutant, ugm3: 60, pct: 120, origin: "local" } }, 3);
  expect(formatAlertHe(lead("PM2.5"))).toBe("🟠 עדיף לסגור חלונות\nאבק באזור");
  expect(formatAlertHe(lead("NO2"))).toBe("🟠 עדיף לסגור חלונות\nזיהום מתחבורה (NO2) באזור");
  expect(formatAlertHe(lead("SO2"))).toBe("🟠 עדיף לסגור חלונות\nגופרית דו־חמצנית (SO2) באזור");
});

test("formatStationsHe: raw per-station view for questions about an alert", () => {
  const now = new Date("2026-10-15T09:00:00Z");
  const pts = (values: Record<string, number>, lagMin: number) =>
    Array.from({ length: 12 }, (_, i) => ({ t: new Date(now.getTime() - (lagMin + 5 * (11 - i)) * 60_000), values }));
  const text = formatStationsHe([
    { meta: { id: 602, name: "ניידת 9", lat: 32.812108, lon: 35.107611, active: true, mobile: true, address: "חנקין 12" },
      samples: pts({ Benzene: 0.42, "PM2.5": 13.66 }, 15) },
    { meta: { id: 627, name: 'תש"ן 1 צפון', lat: 32.823, lon: 35.054, active: true, mobile: false, address: "" }, samples: [] },
  ], now);
  const lines = text.split("\n");
  expect(lines[0]).toContain("ניידת 9 (602, ניידת)");
  expect(lines[0]).toContain('1.5 ק"מ');
  expect(lines[0]).toContain("לפני 15 דק'");
  expect(lines[0]).toContain("בנזן 0.4");
  expect(lines[0]).toContain("PM2.5 14");
  expect(lines[1]).toContain('תש"ן 1 צפון (627)');
  expect(lines[1]).toContain("לא מדווחת");
});

test("buildStatus lists every pollutant with value and % of its limit (ozone: no limit)", () => {
  const s = buildStatus({ ...EST, means: { PM10: 66.04, Benzene: 0.46, O3: 93.2 } }, 3);
  expect(s.pollutants).toEqual({ PM10: { ugm3: 66, pct: 132 }, Benzene: { ugm3: 0.5, pct: 12 }, O3: { ugm3: 93, pct: null } });
  expect(buildStatus({ ...EST, means: undefined as any }, 3).pollutants).toEqual({});
});
