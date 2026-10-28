import { test, expect } from "bun:test";
import { step, bandOf, isQuietHours, movedStations, applyHysteresis, EMPTY_STATE, type AlertState } from "./alert";

const DAY = new Date("2026-10-15T09:00:00Z");     // 12:00 Israel
const NIGHT = new Date("2026-10-15T23:00:00Z");   // 02:00 Israel
const MORNING = new Date("2026-10-16T04:05:00Z"); // 07:05 Israel

function run(levels: (number | null)[], at: Date, start: AlertState = EMPTY_STATE) {
  let s = start;
  const notes: boolean[] = [];
  for (const l of levels) { const r = step(s, l, at); s = r.state; notes.push(r.notify); }
  return { s, notes };
}

test("bands follow the window advice: levels 0–2 are all 'fine' (backtest: yellow↔green was most of the noise)", () => {
  expect([0, 1, 2, 3, 4, 5, null].map(bandOf)).toEqual(["fine", "fine", "fine", "high", "very_high", "hazardous", "unknown"]);
});

test("0 → 2 changes the colour but sends nothing", () => {
  const r = run([0, 2, 2], DAY);
  expect(r.s.confirmed).toBe(2);
  expect(r.notes).toEqual([false, false, false]);
});

test("applyHysteresis holds a level until the score drops 15% below its threshold", () => {
  expect(applyHysteresis(2, 90, 3)).toBe(3);    // 90 ≥ 100 × 0.85 → still orange
  expect(applyHysteresis(2, 84, 3)).toBe(2);    // below 85 → really down
  expect(applyHysteresis(4, 160, 3)).toBe(4);   // rises are never held back
  expect(applyHysteresis(0, 10, null)).toBe(0); // nothing confirmed yet
  expect(applyHysteresis(null, null, 3)).toBeNull();
});

test("quiet hours are 23:00–07:00 Israel time", () => {
  expect(isQuietHours(NIGHT)).toBe(true);
  expect(isQuietHours(DAY)).toBe(false);
  expect(isQuietHours(MORNING)).toBe(false);
});

test("first run: fine is silent, a bad first reading alerts", () => {
  expect(run([0], DAY).notes).toEqual([false]);
  const bad = run([3], DAY);
  expect(bad.notes).toEqual([true]);
  expect(bad.s.confirmed).toBe(3);
});

test("first run waits for a real reading: an outage on run 1 is not 'unknown' (seen live)", () => {
  const r = run([null, null], DAY);
  expect(r.notes).toEqual([false, false]);
  expect(r.s.initialized).toBe(false);
  const next = run([0], DAY, r.s);
  expect(next.s.initialized).toBe(true);
  expect(next.notes).toEqual([false]);
});

test("a rise needs 2 runs, a fall needs 3", () => {
  const up = run([0, 3, 3], DAY);
  expect(up.notes).toEqual([false, false, true]);
  const down = run([0, 0, 0], DAY, up.s);
  expect(down.notes).toEqual([false, false, true]);
  expect(down.s.confirmed).toBe(0);
});

test("flapping never confirms", () => {
  const r = run([0, 3, 0, 3, 0], DAY);
  expect(r.notes.every((n) => !n)).toBe(true);
  expect(r.s.confirmed).toBe(0);
});

test("0 → 1 changes the level but not the band: no message", () => {
  const r = run([0, 1, 1], DAY);
  expect(r.s.confirmed).toBe(1);
  expect(r.notes).toEqual([false, false, false]);
});

test("unknown needs 4 runs", () => {
  expect(run([0, null, null, null, null], DAY).notes).toEqual([false, false, false, false, true]);
});

test("quiet hours hold a non-urgent change until 07:00, then send one catch-up", () => {
  const night = run([0, 3, 3], NIGHT);
  expect(night.notes).toEqual([false, false, false]);
  expect(step(night.s, 3, MORNING).notify).toBe(true);
});

test("very_high still alerts at night", () => {
  expect(run([0, 4, 4], NIGHT).notes).toEqual([false, false, true]);
});

test("movedStations flags a >500 m move once", () => {
  const prev: AlertState = { ...EMPTY_STATE, stationLocations: { "602": { lat: 32.812108, lon: 35.107611 } } };
  const moved = { id: 602, name: "ניידת 9", lat: 32.8211, lon: 35.107611, active: true, mobile: true, address: "x" };
  const r1 = movedStations(prev, [moved]);
  expect(r1.moved).toHaveLength(1);
  expect(r1.moved[0].km).toBeCloseTo(1.0, 1);
  const r2 = movedStations({ ...prev, stationLocations: r1.locations }, [moved]);
  expect(r2.moved).toHaveLength(0);
});
