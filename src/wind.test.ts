import { test, expect } from "bun:test";
import { parseForecast, fetchForecast } from "./wind";

const FC = { hourly: {
  time: ["2026-10-15T09:00", "2026-10-15T10:00", "2026-10-15T11:00"],
  wind_speed_10m: [3.1, null, 4.0],
  wind_direction_10m: [255, 260, 280],
} };

test("parseForecast reads UTC hours and skips gaps", () => {
  const f = parseForecast(FC);
  expect(f).toHaveLength(2);
  expect(f[0]).toEqual({ t: new Date("2026-10-15T09:00:00Z"), fromDeg: 255, speedMs: 3.1 });
  expect(f[1].t.toISOString()).toBe("2026-10-15T11:00:00.000Z");
  expect(() => parseForecast({})).toThrow();
});

test("fetchForecast asks for m/s in UTC", async () => {
  let url = "";
  await fetchForecast(32.8, 35.1, async (u) => { url = u; return Response.json(FC); });
  expect(url).toContain("wind_speed_unit=ms");
  expect(url).toContain("timezone=UTC");
});
