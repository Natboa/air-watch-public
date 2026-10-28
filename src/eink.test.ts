import { test, expect } from "bun:test";
import { inflateSync } from "zlib";
import { encodePng, quantize, svgToEinkPng } from "./eink";

test("drawing snaps to the nearest level; photos inside a circle are dithered", () => {
  const w = 40, h = 40, grey = new Uint8Array(w * h).fill(100);
  const out = quantize(grey, w, h, 2, [{ cx: 30, cy: 30, r: 8 }]);
  expect(out[0]).toBe(85);                                  // outside: 100 → nearest grey, flat
  const inside: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + 0.5 - 30) ** 2 + (y + 0.5 - 30) ** 2 <= 64) inside.push(out[y * w + x]);
  expect(new Set(inside)).toEqual(new Set([85, 170]));      // inside: a mix of the two nearest greys…
  expect(inside.reduce((a, b) => a + b, 0) / inside.length).toBeCloseTo(100, -1);   // …averaging back to ~100
  expect(new Set(quantize(grey, w, h, 1))).toEqual(new Set([0]));
});

test("2-bit PNG: greyscale at 2 bits per pixel, 4 pixels to a byte", () => {
  const png = encodePng(new Uint8Array([0, 85, 170, 255, 255]), 5, 1, 2);
  const dv = new DataView(png.buffer);
  expect(dv.getUint32(16)).toBe(5);                          // IHDR width
  expect(png[24]).toBe(2);                                   // bit depth
  expect(png[25]).toBe(0);                                   // colour type: greyscale
  const idatLen = dv.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  expect([...raw]).toEqual([0, 0b00011011, 0b11000000]);    // filter byte, then codes 0 1 2 3 | 3
});

test("rendering gives a panel-ready PNG at the asked depth", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="8" height="8" fill="#000"/></svg>`;
  for (const bits of [1, 2] as const) {
    const png = svgToEinkPng(svg, bits);
    expect(png[24]).toBe(bits);
    expect(new DataView(png.buffer).getUint32(20)).toBe(8);  // height
  }
});
