import { test, expect } from "bun:test";
import { hourIn, HOME_TZ } from "./time";

test("hourIn gives the Israeli wall-clock hour across DST", () => {
  expect(HOME_TZ).toBe("Asia/Jerusalem");
  expect(hourIn(new Date("2026-10-15T21:00:00Z"))).toBe(0);  // IDT, UTC+3 → midnight, not 24
  expect(hourIn(new Date("2026-10-15T09:00:00Z"))).toBe(12);
  expect(hourIn(new Date("2026-12-15T09:00:00Z"))).toBe(11); // IST, UTC+2
});
