import { test, expect } from "bun:test";
import { icon, windowIcon } from "./icons";

test("icon places a Lucide icon as a scaled group and drops its comment/wrapper", () => {
  const g = icon("sun", 100, 50, 48, { stroke: 3 });
  expect(g.startsWith('<g transform="translate(100 50) scale(2)"')).toBe(true);
  expect(g).toContain('stroke-width="1.5"');   // 3 output px ÷ scale 2, so every icon size keeps the same line weight
  expect(g).toContain("<circle");
  expect(g).not.toContain("<svg");
  expect(g).not.toContain("@license");
});

test("icon rotates around its centre when asked (wind arrow)", () => {
  expect(icon("navigation-2", 0, 0, 24, { rotate: 90 })).toContain("rotate(90 12 12)");
});

test("unknown icons fail loudly instead of drawing nothing", () => {
  expect(() => icon("no-such-icon", 0, 0, 24)).toThrow(/no-such-icon/);
});

test("windowIcon: open shows a swung sash, closed shows a latched frame", () => {
  const open = windowIcon(true, 0, 0, 80), closed = windowIcon(false, 0, 0, 80);
  expect(open).toContain('class="window-open"');
  expect(closed).toContain('class="window-closed"');
  expect(open).not.toBe(closed);
});
