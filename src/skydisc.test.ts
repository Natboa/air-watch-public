import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { litPath, renderSkyDisc } from "./skydisc";
import { HOME } from "./config";

const { lat, lon } = HOME;
// A tiny stand-in "JPEG": the disc only embeds the bytes, resvg is not involved here.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const photo = () => JPEG, none = () => null;
const num = (svg: string, re: RegExp) => Number(svg.match(re)![1]);

test("sun and moon sit on opposite sides of the disc", () => {
  const d = renderSkyDisc(new Date("2026-10-16T15:35:00+03:00"), lat, lon, photo);
  const sx = num(d.svg, /class="sun"[^>]* x="([\d.-]+)"/) + 24, sy = num(d.svg, /class="sun"[^>]* y="([\d.-]+)"/) + 24;
  expect(d.dither).not.toBeNull();
  const { cx, cy } = d.dither!;
  expect((sx + cx) / 2).toBeCloseTo(79, 0);       // their midpoint is the disc's centre
  expect((sy + cy) / 2).toBeCloseTo(74, 0);
});

test("a photo moon is clipped to its circle, turned, and handed to the ditherer", () => {
  const d = renderSkyDisc(new Date("2026-10-18T21:00:00+03:00"), lat, lon, photo);
  expect(d.svg).toContain('class="moon"');
  expect(d.svg).toContain('clip-path="url(#sky-moon)"');
  expect(d.svg).toMatch(/class="moon"[^>]*transform="rotate\(/);
  expect(d.dither!.r).toBe(19);
  expect(d.svg).not.toContain('class="moon-phase"');                 // the picture says it; no caption
});

test("a thin crescent is drawn as a vector, new moon as an outline, and a missing frame falls back to a vector", () => {
  const thin = renderSkyDisc(new Date("2026-11-06T21:00:00+02:00"), lat, lon, photo);
  expect(thin.svg).toContain('class="moon-vector"');
  expect(thin.svg).not.toContain('class="moon"');
  expect(thin.dither).toBeNull();
  const fresh = renderSkyDisc(new Date("2026-10-10T21:00:00+03:00"), lat, lon, photo);
  expect(fresh.svg).toContain('class="moon-ring"');
  expect(fresh.svg).not.toContain('class="moon-vector"');
  const offline = renderSkyDisc(new Date("2026-10-25T21:00:00+02:00"), lat, lon, none);
  expect(offline.svg).toContain('class="moon-vector"');
  expect(offline.dither).toBeNull();
});

test("the lit part keeps a crescent at least 3 px thick and bulges the right way when gibbous", () => {
  const rx = (p: string) => Number(p.match(/A([\d.]+) 19 0 0 [01] [\d.]+ [\d.]+Z$/)![1]);
  expect(rx(litPath(20, 20, 19, 0.04))).toBe(16);                 // capped at r − 3
  expect(rx(litPath(20, 20, 19, 0.3))).toBeCloseTo(7.6, 1);
  expect(litPath(20, 20, 19, 0.3)).toMatch(/0 0 0 [\d.]+ [\d.]+Z$/); // crescent: terminator bulges towards the light
  expect(litPath(20, 20, 19, 0.8)).toMatch(/0 0 1 [\d.]+ [\d.]+Z$/); // gibbous: away from it
});

test("the engraved sun art exists and is a PNG", () => {
  const png = readFileSync(`${import.meta.dir}/../assets/art/sun-48.png`);
  expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
});
