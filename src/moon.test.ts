import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { MOON_FRAMES, frameFor, moonPhotoFor } from "./moon";

test("a phase picks the nearest of the 60 stored frames, wrapping at new moon", () => {
  expect(frameFor(0)).toBe(0);
  expect(frameFor(0.5)).toBe(30);                 // full
  expect(frameFor(0.25)).toBe(15);                // first quarter
  expect(frameFor(0.995)).toBe(0);                // just before new moon → the new-moon frame
  expect(frameFor(1 / 120 + 0.001)).toBe(1);
});

test("all 60 frames are stored as JPEGs, and the photo for a phase is that frame", () => {
  const files = readdirSync(`${import.meta.dir}/../assets/moon`).filter((f) => /^phase-\d\d\.jpg$/.test(f));
  expect(files).toHaveLength(MOON_FRAMES);
  const full = moonPhotoFor(0.5)!;
  expect([full[0], full[1]]).toEqual([0xff, 0xd8]);
  expect(full).toEqual(new Uint8Array(readFileSync(`${import.meta.dir}/../assets/moon/phase-30.jpg`)));
});
