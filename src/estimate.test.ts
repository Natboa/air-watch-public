import { test, expect } from "bun:test";
import { rollingMean, levelForScore, estimate, estimateUnavailable, type StationInput } from "./estimate";
import { distanceKm } from "./geo";
import { HOME, SOURCES } from "./config";
import type { Sample, StationMeta } from "./sviva";

const NOW = new Date("2026-10-15T09:00:00Z");
const meta = (id: number, lat: number, lon: number, mobile = false): StationMeta =>
  ({ id, name: `st${id}`, lat, lon, active: true, mobile, address: "" });
const ST602 = meta(602, 32.812108, 35.107611, true);
const ST88 = meta(88, 32.81190414, 35.11309366);
const ST97 = meta(97, 32.78816675, 35.08591807);
const FAR = meta(999, 32.84, 35.107);
const BAZAN = meta(415, 32.7947897, 35.0599771);

/** One sample every 5 min over `minutes`, the newest at `now`. */
function series(values: Record<string, number>, now = NOW, minutes = 60): Sample[] {
  const out: Sample[] = [];
  for (let m = minutes - 5; m >= 0; m -= 5) out.push({ t: new Date(now.getTime() - m * 60_000), values: { ...values } });
  return out;
}
const st = (m: StationMeta, values: Record<string, number>): StationInput => ({ meta: m, samples: series(values) });
const bazan = (stations: StationInput[]) => [{ def: SOURCES[0], stations }];

test("rollingMean needs 6 samples, clamps negatives, rejects stale stations", () => {
  expect(rollingMean(series({ X: -2 }), "X", NOW)!.mean).toBe(0);
  expect(rollingMean(series({ X: 4 }).slice(-5), "X", NOW)).toBeNull();          // only 5
  const stale = series({ X: 4 }, new Date(NOW.getTime() - 50 * 60_000), 90);
  expect(rollingMean(stale, "X", NOW)).toBeNull();                               // newest is 50 min old
  expect(rollingMean(series({ X: 4 }), "Y", NOW)).toBeNull();
});

test("rollingMean anchors the hour on the newest sample (MoEP publishes 10–20 min late)", () => {
  const lagging = [
    ...series({ X: 100 }, new Date(NOW.getTime() - 80 * 60_000), 60),  // the hour before: must be excluded
    ...series({ X: 4 }, new Date(NOW.getTime() - 20 * 60_000), 60),     // the latest full hour, 20 min behind
  ];
  const m = rollingMean(lagging, "X", NOW)!;
  expect(m.mean).toBe(4);
  expect(m.ageMin).toBe(20);
});

test("levelForScore boundaries", () => {
  expect(levelForScore(0)).toBe(0);
  expect(levelForScore(33)).toBe(1);
  expect(levelForScore(99.9)).toBe(2);
  expect(levelForScore(100)).toBe(3);
  expect(levelForScore(150)).toBe(4);
  expect(levelForScore(300)).toBe(5);
});

test("local only: PM2.5 50 at the nearest station is 200% → level 4", () => {
  const e = estimate({ now: NOW, local: [st(ST602, { "PM2.5": 50 })], wind: [], sources: [], forecast: [] });
  expect(e.lead).toMatchObject({ pollutant: "PM2.5", origin: "local" });
  expect(e.lead!.pct).toBeCloseTo(200);
  expect(e.level).toBe(4);
  expect(e.local.map((s) => s.id)).toEqual([602]);
});

test("local value is an inverse-distance-squared mean; stations beyond 3 km are ignored", () => {
  const e = estimate({ now: NOW, local: [st(ST602, { PM10: 10 }), st(ST97, { PM10: 40 }), st(FAR, { PM10: 500 })], wind: [], sources: [], forecast: [] });
  const w1 = 1 / distanceKm(HOME, ST602) ** 2, w2 = 1 / distanceKm(HOME, ST97) ** 2;
  expect(e.lead!.ugm3).toBeCloseTo((10 * w1 + 40 * w2) / (w1 + w2), 5);
  expect(e.local.map((s) => s.id)).toEqual([602, 97]);
});

test("wind from Bazan carries its benzene in: upwind lead, level 5, ETA from distance/speed", () => {
  const e = estimate({
    now: NOW, local: [st(ST602, { Benzene: 0.5 })], wind: [st(ST88, { WD: 258, WS: 3 })],
    sources: bazan([st(BAZAN, { Benzene: 150 })]), forecast: [],   // Mobile 4 peaked at 150.5 on 10 Oct 2026
  });
  expect(e.wind).toMatchObject({ origin: "station" });
  expect(e.upwind!.key).toBe("bazan");
  expect(e.lead).toMatchObject({ pollutant: "Benzene", origin: "upwind" });
  expect(e.lead!.ugm3).toBeCloseTo(12);         // 150 × 0.08
  expect(e.level).toBe(5);                       // 12 / 3.9 = 308%
  expect(e.upwind!.etaMin).toBeGreaterThanOrEqual(20);
  expect(e.upwind!.etaMin).toBeLessThanOrEqual(30);
});

test("dilution override is honoured (used by the backtest)", () => {
  const e = estimate({
    now: NOW, local: [st(ST602, { Benzene: 0.5 })], wind: [st(ST88, { WD: 258, WS: 3 })],
    sources: bazan([st(BAZAN, { Benzene: 40 })]), forecast: [], dilution: 0.1,
  });
  expect(e.lead!.ugm3).toBeCloseTo(4);
});

test("limit overrides are honoured (used by the backtest)", () => {
  const e = estimate({ now: NOW, local: [st(ST602, { PM10: 50 })], wind: [], sources: [], forecast: [], limits: { PM10: 100 } });
  expect(e.lead!.pct).toBeCloseTo(50);
  expect(e.level).toBe(1);
});

test("ozone is reported as info but never sets the level (selected after the backtest)", () => {
  const e = estimate({ now: NOW, local: [st(ST602, { O3: 300, PM10: 5 })], wind: [], sources: [], forecast: [] });
  expect(e.lead!.pollutant).toBe("PM10");
  expect(e.level).toBe(0);
  expect(e.info.O3).toBeCloseTo(300);
});

test("wind from the east: no upwind source, level from local air", () => {
  const e = estimate({
    now: NOW, local: [st(ST602, { Benzene: 0.5 })], wind: [st(ST88, { WD: 90, WS: 3 })],
    sources: bazan([st(BAZAN, { Benzene: 40 })]), forecast: [],
  });
  expect(e.upwind).toBeNull();
  expect(e.lead!.origin).toBe("local");
  expect(e.level).toBe(0);
});

test("calm wind skips attribution and says so", () => {
  const e = estimate({
    now: NOW, local: [st(ST602, { Benzene: 0.5 })], wind: [st(ST88, { WD: 258, WS: 0.5 })],
    sources: bazan([st(BAZAN, { Benzene: 40 })]), forecast: [],
  });
  expect(e.calm).toBe(true);
  expect(e.upwind).toBeNull();
  expect(e.note).toContain("רוח חלשה");
});

test("a silent source station (no samples) is simply skipped", () => {
  const e = estimate({
    now: NOW, local: [st(ST602, { Benzene: 0.5 })], wind: [st(ST88, { WD: 258, WS: 3 })],
    sources: bazan([{ meta: BAZAN, samples: [] }]), forecast: [],
  });
  expect(e.upwind).toBeNull();
  expect(e.level).toBe(0);
});

test("no fresh local data → unknown, never green", () => {
  const e = estimate({ now: NOW, local: [st(FAR, { PM10: 5 })], wind: [], sources: [], forecast: [] });
  expect(e.level).toBeNull();
  expect(e.score).toBeNull();
  expect(estimateUnavailable(NOW, "down").level).toBeNull();
});

test("forecast fills in missing station wind and predicts the next bay wind", () => {
  const e = estimate({
    now: NOW, local: [st(ST602, { Benzene: 0.5 })], wind: [],
    sources: bazan([st(BAZAN, { Benzene: 0.2 })]),
    forecast: [
      { t: new Date(NOW.getTime() - 10 * 60_000), fromDeg: 90, speedMs: 2 },
      { t: new Date(NOW.getTime() + 2 * 3_600_000), fromDeg: 260, speedMs: 4 },
    ],
  });
  expect(e.wind).toMatchObject({ fromDeg: 90, origin: "forecast" });
  expect(e.nextBayWindAt!.toISOString()).toBe(new Date(NOW.getTime() + 2 * 3_600_000).toISOString());
});

test("the local benzene mean is always reported, whatever leads", () => {
  const e = estimate({ now: NOW, local: [st(ST602, { PM10: 80, Benzene: 1.2 })], wind: [], sources: [], forecast: [] });
  expect(e.lead!.pollutant).toBe("PM10");
  expect(e.benzene).toBeCloseTo(1.2);
  expect(estimateUnavailable(NOW, "x").benzene).toBeNull();
});

test("estimate exposes every local mean (scored and info) for the dashboard tiles", () => {
  const e = estimate({ now: NOW, local: [st(ST602, { PM10: 60, "PM2.5": 20, Benzene: 0.4, O3: 90 })], wind: [], sources: [], forecast: [] });
  expect(Object.keys(e.means).sort()).toEqual(["Benzene", "O3", "PM10", "PM2.5"]);
  expect(e.means.PM10).toBeCloseTo(60);
  expect(estimateUnavailable(NOW, "x").means).toEqual({});
});
