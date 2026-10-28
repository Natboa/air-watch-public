import { test, expect } from "bun:test";
import { distanceKm, bearingDeg, angleDiff, circularMeanDeg, meanWind } from "./geo";

const HOME = { lat: 32.8, lon: 35.1 }; // synthetic test anchor
const MOBILE9 = { lat: 32.812108, lon: 35.107611 };
const BAZAN = { lat: 32.7947897, lon: 35.0599771 };

test("distance and bearing from a synthetic anchor to public station positions", () => {
  expect(distanceKm(HOME, MOBILE9)).toBeCloseTo(1.52, 1);
  expect(bearingDeg(HOME, MOBILE9)).toBeGreaterThan(25);
  expect(bearingDeg(HOME, MOBILE9)).toBeLessThan(30);
  expect(distanceKm(HOME, BAZAN)).toBeCloseTo(3.8, 0);
  const b = bearingDeg(HOME, BAZAN);
  expect(b).toBeGreaterThan(250);
  expect(b).toBeLessThan(265);
});

test("angleDiff wraps around north", () => {
  expect(angleDiff(350, 10)).toBeCloseTo(20);
  expect(angleDiff(10, 350)).toBeCloseTo(20);
  expect(angleDiff(90, 270)).toBeCloseTo(180);
  expect(angleDiff(258, 258)).toBe(0);
});

test("circularMeanDeg averages across north", () => {
  expect(angleDiff(circularMeanDeg([350, 10]), 0)).toBeLessThan(1e-6);
  expect(circularMeanDeg([240, 260])).toBeCloseTo(250);
});

test("meanWind is a vector mean: opposite winds cancel", () => {
  const w = meanWind([{ fromDeg: 90, speedMs: 3 }, { fromDeg: 270, speedMs: 3 }])!;
  expect(w.speedMs).toBeLessThan(1e-9);
  const same = meanWind([{ fromDeg: 250, speedMs: 2 }, { fromDeg: 270, speedMs: 2 }])!;
  expect(same.fromDeg).toBeCloseTo(260);
  expect(same.speedMs).toBeCloseTo(2 * Math.cos((10 * Math.PI) / 180));
  expect(meanWind([])).toBeNull();
});
