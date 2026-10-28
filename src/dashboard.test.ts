import { test, expect } from "bun:test";
import { renderDashboard, renderDashboardSvg, type DashboardModel } from "./dashboard";
import type { AirStatus } from "./format";
import type { HistoryEntry } from "./history";
import type { Weather } from "./weather";

const NOW = new Date("2026-10-16T10:55:00Z"); // 13:55 Israel

const STATUS: AirStatus = {
  updatedAt: "2026-10-16T10:50:00.000Z", level: 3, levelKey: "high", nameHe: "גבוה", color: "#f39c12", windows: "closed",
  score: 132, rawLevel: 3, lead: { pollutant: "PM10", ugm3: 66, pct: 132, origin: "local" },
  wind: { fromDeg: 265, speedMs: 3.2, origin: "station" }, upwind: null, nextBayWindAt: null, note: null,
  stations: [{ id: 602, name: "ניידת 9", distanceKm: 1.2, ageMin: 12 }], info: { O3: 93 },
  benzene: { ugm3: 0.4, pct: 10 },
  pollutants: { PM10: { ugm3: 66, pct: 132 }, "PM2.5": { ugm3: 16, pct: 64 }, NO2: { ugm3: 21, pct: 42 }, Benzene: { ugm3: 0.4, pct: 10 }, O3: { ugm3: 93, pct: null } },
};

const WEATHER: Weather = {
  now: { t: NOW, temp: 24.3, feels: 25.1, humidity: 61, code: 2, isDay: true, windMs: 3.2, windFromDeg: 265 },
  hourly: Array.from({ length: 24 }, (_, i) => ({ t: new Date(Date.parse("2026-10-16T11:00:00Z") + i * 3_600_000), temp: 24 - i * 0.3, rainPct: i === 4 ? 60 : 0, code: i === 4 ? 61 : 1, isDay: i < 4 })),
  today: { max: 27.4, min: 18.2, sunrise: new Date("2026-10-16T03:28:00Z"), sunset: new Date("2026-10-16T14:47:00Z") },
};

function history(): HistoryEntry[] {
  const out: HistoryEntry[] = [], WEEK = 7 * 24 * 60;
  for (let m = 0; m < WEEK; m += 5) {
    const t = new Date(NOW.getTime() - (WEEK - m) * 60_000);
    const score = m > WEEK - 840 && m < WEEK - 720 ? 140 : 40;   // a two-hour dust spike half a day ago
    out.push({ at: t.toISOString(), score, level: score >= 100 ? 3 : 1, confirmed: score >= 100 ? 3 : 1, lead: "PM10", benzene: 0.3, notified: m === WEEK - 830 });
  }
  return out;
}

const MODEL: DashboardModel = { now: NOW, status: STATUS, history: history(), weather: WEATHER, place: "קריית אתא" };

test("the dashboard is exactly the panel's 800×480, black and white only", () => {
  const svg = renderDashboardSvg(MODEL);
  expect(svg).toContain('width="800" height="480"');
  const colours = new Set(svg.match(/#[0-9a-fA-F]{3,6}\b/g));
  for (const c of colours) expect(["#000", "#fff", "#000000", "#ffffff"]).toContain(c.toLowerCase());
});

test("air panel: window advice, level, cause, and six tiles with the lead pollutant inverted", () => {
  const svg = renderDashboardSvg(MODEL);
  expect(svg).toContain('class="window-closed"');
  expect(svg).toContain(">עדיף לסגור חלונות<");
  expect(svg).toContain("גבוה · ציון 132");
  expect(svg).toContain(">אבק באזור<");
  expect(svg.match(/class="tile( lead)?"/g)).toHaveLength(6);
  expect(svg.match(/class="tile lead"/g)).toHaveLength(1);
  expect(svg.match(/class="seg on"/g)).toHaveLength(4);   // levels 0–3 filled
  expect(svg.match(/class="seg"/g)).toHaveLength(2);
});

test("tiles: NO2 and SO2 have their own; whichever pollutant leads is the inverted one; missing data shows a dash", () => {
  const svg = renderDashboardSvg(MODEL);
  for (const l of [">NO2<", ">SO2<", ">42% מהסף<"]) expect(svg).toContain(l);
  expect(svg).toMatch(/>SO2<[\s\S]*?>—</);                           // SO2 not in this status
  const no2 = renderDashboardSvg({ ...MODEL, status: { ...STATUS, lead: { pollutant: "NO2", ugm3: 60, pct: 120, origin: "local" } } });
  expect(no2).toMatch(/class="tile lead"[^]*?>NO2</);
  expect(no2.match(/class="tile lead"/g)).toHaveLength(1);
});

test("weather panel: temperature, description, wind and six forecast slots", () => {
  const svg = renderDashboardSvg(MODEL);
  expect(svg).toContain(">24°<");
  expect(svg).toContain("מעונן חלקית");
  expect(svg).toContain("רוח מערבית");
  expect(svg.match(/class="hour"/g)).toHaveLength(6);
  expect(svg).toContain("60%");                            // rain chance shown where it matters
});

test("graph: the line, threshold labels, hatched high stretch, current dot", () => {
  const svg = renderDashboardSvg(MODEL);
  expect(svg).toContain("זיהום בשבוע האחרון");
  expect(svg).toContain("<polyline");
  expect(svg).toContain('fill="url(#hatch)"');
  expect(svg).toContain('class="now"');
  for (const l of ["סביר", "גבוה", "גבוה מאוד"]) expect(svg).toContain(`>${l}<`);
});

test("degrades honestly: no air data, no weather, and text is XML-escaped", () => {
  const svg = renderDashboardSvg({
    ...MODEL, weather: null, place: "A & B",
    status: { ...STATUS, level: null, levelKey: "unknown", nameHe: "אין נתונים", windows: "unknown", score: null, rawLevel: null, lead: null, pollutants: {}, benzene: null },
    history: [],
  });
  expect(svg).toContain(">אין נתונים עדכניים<");
  expect(svg).toContain("אין נתוני מזג אוויר");
  expect(svg).toContain("A &amp; B");
  expect(svg).not.toContain("<polyline");
});

test("graph: a week along the bottom — a divider at each midnight and the day's name under it", () => {
  const svg = renderDashboardSvg(MODEL);
  expect(svg.match(/class="day"/g)).toHaveLength(7);             // 13:55 Friday back to 13:55 last Friday: 7 midnights
  const days = [...svg.matchAll(/class="day-name"[^>]*>([^<]+)</g)].map((x) => x[1]);
  expect(days).toEqual(["שישי", "שבת", "ראשון", "שני", "שלישי", "רביעי", "חמישי", "היום"]);   // last Friday from 13:55, then today
});

test("graph: no alert markers — the line and hatching already show when the air was bad", () => {
  expect(renderDashboardSvg(MODEL)).not.toContain('class="alert"');
});

test("graph: zone names sit in a gutter left of the plot, never over the line", () => {
  const svg = renderDashboardSvg(MODEL);
  const xs = [...svg.matchAll(/<text class="zone-label" x="([\d.]+)"/g)].map((x) => Number(x[1]));
  const lineStart = Math.min(...[...svg.matchAll(/<polyline points="([\d.]+),/g)].map((x) => Number(x[1])));
  for (const x of xs) expect(x).toBeLessThan(lineStart);
});

test("graph zones: one equal-height band per level, every band named, 0 on the hours line", () => {
  const svg = renderDashboardSvg(MODEL);
  const ys = [...svg.matchAll(/<line class="zone" x1="[\d.]+" y1="([\d.]+)"/g)].map((m) => Number(m[1]));
  expect(ys).toHaveLength(4);                                  // 66, 100, 150, 300
  const gaps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
  for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 0);   // evenly spaced
  for (const l of ["טוב", "סביר", "גבוה", "גבוה מאוד", "מסוכן"]) expect(svg).toMatch(new RegExp(`class="zone-label"[^>]*>${l}<`));
});

test("header: battery level and Wi-Fi bars from the device's last report", () => {
  const svg = renderDashboardSvg({ ...MODEL, device: { batteryPct: 87, rssi: -61 } });
  expect(svg).toContain('class="battery"');
  expect(svg).toContain(">87%<");
  expect(svg.match(/class="bar on"/g)).toHaveLength(3);        // −61 dBm → 3 of 4 bars
  expect(svg.match(/class="bar"/g)).toHaveLength(1);
});

test("corner: the day/night disc sits top-left, and the moon photo is passed on to be dithered in place", () => {
  const newMoon = renderDashboard({ ...MODEL, now: new Date("2026-10-10T18:00:00Z") });
  expect(newMoon.svg).toContain('<g transform="translate(12 50)"><g class="sky-disc">');
  expect(newMoon.dither).toEqual([]);                              // new moon: an outline, nothing to dither
  const night = renderDashboard({ ...MODEL, now: new Date("2026-10-18T18:00:00Z") });
  expect(night.dither).toHaveLength(1);
  const [c] = night.dither;
  expect(c.cx).toBeGreaterThan(12);
  expect(c.cx).toBeLessThan(12 + 158);
  expect(c.cy).toBeGreaterThan(50);
  expect(c.cy).toBeLessThan(50 + 74);
});

test("header: a low battery says so in words; no device report draws neither", () => {
  expect(renderDashboardSvg({ ...MODEL, device: { batteryPct: 12, rssi: -90 } })).toContain(">טען 12%<");
  const none = renderDashboardSvg({ ...MODEL, device: null });
  expect(none).not.toContain('class="battery"');
  expect(none).not.toContain('class="bar');
});
