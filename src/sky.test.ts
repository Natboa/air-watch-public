import { test, expect } from "bun:test";
import SunCalc from "suncalc";
import { moonPhase, onDisc, phaseHe, sunAngle, towardSunDeg } from "./sky";
import { HOME } from "./config";

const { lat, lon } = HOME;
const times = SunCalc.getTimes(new Date("2026-10-16T12:00:00+03:00"), lat, lon);
const at = (ms: number) => sunAngle(new Date(ms), lat, lon);

test("the sun is on the east horizon at sunrise, on top at noon, on the west horizon at sunset", () => {
  expect(at(times.sunrise.getTime())).toBeCloseTo(0, 5);
  expect(at(times.sunset.getTime())).toBeCloseTo(180, 5);
  expect(at((times.sunrise.getTime() + times.sunset.getTime()) / 2)).toBeCloseTo(90, 5);
});

test("through the night the sun is below the horizon, turning on towards the next sunrise", () => {
  const evening = at(Date.parse("2026-10-16T21:00:00+03:00"));
  const lateNight = at(Date.parse("2026-10-17T03:00:00+03:00"));
  expect(evening).toBeGreaterThan(180);
  expect(lateNight).toBeGreaterThan(evening);
  expect(lateNight).toBeLessThan(360);
  expect(at(times.sunrise.getTime() - 60_000)).toBeCloseTo(360, 0);   // a minute before sunrise ≈ a full turn
});

test("phase names around the cycle, each quarter a narrow band", () => {
  expect([0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.99].map(phaseHe)).toEqual(
    ["מולד", "סהר מתמלא", "רבע ראשון", "ירח מתמלא", "ירח מלא", "ירח מתמעט", "רבע אחרון", "סהר מתמעט", "מולד"]);
  // 98% lit either side of full is still "full", 2% either side of new is still "new".
  const lit = (p: number) => (1 - Math.cos(2 * Math.PI * p)) / 2;
  for (const p of [0.455, 0.544]) { expect(lit(p)).toBeGreaterThan(0.979); expect(phaseHe(p)).toBe("ירח מלא"); }
  for (const p of [0.044, 0.956]) { expect(lit(p)).toBeLessThan(0.021); expect(phaseHe(p)).toBe("מולד"); }
});

test("moon phase on known nights: full on 25/10, last quarter on 1/11", () => {
  const full = moonPhase(new Date("2026-10-25T21:00:00+02:00"));
  expect(full.nameHe).toBe("ירח מלא");
  expect(full.fraction).toBeGreaterThan(0.98);
  const last = moonPhase(new Date("2026-11-01T21:00:00+02:00"));
  expect(last.nameHe).toBe("רבע אחרון");
  expect(last.waxing).toBe(false);
});

test("disc geometry: 0° left, 90° top, 180° right; the moon looks across the centre at the sun", () => {
  const [lx, ly] = onDisc(0, 0, 0, 10), [tx, ty] = onDisc(0, 0, 90, 10), [rx, ry] = onDisc(0, 0, 180, 10);
  const r6 = (v: number) => +v.toFixed(6) + 0;                    // + 0 folds −0 into 0
  expect([lx, ly].map(r6)).toEqual([-10, 0]);
  expect([tx, ty].map(r6)).toEqual([0, -10]);
  expect([rx, ry].map(r6)).toEqual([10, 0]);
  expect(towardSunDeg(180)).toBeCloseTo(90, 6);     // sunset: sun on the right
  expect(towardSunDeg(90)).toBeCloseTo(0, 6);       // noon: sun straight up
  expect(towardSunDeg(270)).toBeCloseTo(180, 6);    // midnight: sun straight down
});
