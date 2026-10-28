import { test, expect } from "bun:test";
import { svgToPng } from "./png";
import { renderWeekSvg } from "./weekly";

test("svgToPng renders the weekly chart to a real PNG of the right size", () => {
  const png = svgToPng(renderWeekSvg([], new Date("2026-10-16T07:00:00Z"), new Date("2026-10-23T07:00:00Z")));
  expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  const view = new DataView(png.buffer, png.byteOffset);
  expect(view.getUint32(16)).toBe(1000); // IHDR width
  expect(view.getUint32(20)).toBe(500);  // IHDR height
});
