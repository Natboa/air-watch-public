import { test, expect } from "bun:test";
import { parseWeather, wmo, fetchWeather } from "./weather";

const RAW = {
  current: { time: "2026-10-16T10:45", temperature_2m: 24.3, apparent_temperature: 25.1, relative_humidity_2m: 61,
    weather_code: 2, is_day: 1, wind_speed_10m: 3.2, wind_direction_10m: 265 },
  hourly: {
    time: ["2026-10-16T10:00", "2026-10-16T11:00", "2026-10-16T12:00"],
    temperature_2m: [23.9, 24.6, null], precipitation_probability: [0, 10, 40], weather_code: [1, 2, 61], is_day: [1, 1, 1],
  },
  daily: { time: ["2026-10-16"], temperature_2m_max: [27.4], temperature_2m_min: [18.2],
    sunrise: ["2026-10-16T03:28"], sunset: ["2026-10-16T14:47"] },
};

test("parseWeather reads current, hourly (skipping gaps) and today, all as UTC", () => {
  const w = parseWeather(RAW);
  expect(w.now).toEqual({ t: new Date("2026-10-16T10:45:00Z"), temp: 24.3, feels: 25.1, humidity: 61, code: 2, isDay: true, windMs: 3.2, windFromDeg: 265 });
  expect(w.hourly).toHaveLength(2);
  expect(w.hourly[1]).toEqual({ t: new Date("2026-10-16T11:00:00Z"), temp: 24.6, rainPct: 10, code: 2, isDay: true });
  expect(w.today).toEqual({ max: 27.4, min: 18.2, sunrise: new Date("2026-10-16T03:28:00Z"), sunset: new Date("2026-10-16T14:47:00Z") });
  expect(() => parseWeather({})).toThrow();
});

test("wmo maps weather codes to Hebrew and an icon, day and night", () => {
  expect(wmo(0, true)).toEqual({ he: "בהיר", icon: "sun" });
  expect(wmo(0, false)).toEqual({ he: "בהיר", icon: "moon" });
  expect(wmo(2, true)).toEqual({ he: "מעונן חלקית", icon: "cloud-sun" });
  expect(wmo(2, false).icon).toBe("cloud-moon");
  expect(wmo(3, true)).toEqual({ he: "מעונן", icon: "cloud" });
  expect(wmo(45, true).icon).toBe("cloud-fog");
  expect(wmo(53, true).icon).toBe("cloud-drizzle");
  expect(wmo(63, true)).toEqual({ he: "גשם", icon: "cloud-rain" });
  expect(wmo(81, true)).toEqual({ he: "ממטרים", icon: "cloud-sun-rain" });
  expect(wmo(95, true)).toEqual({ he: "סופת רעמים", icon: "cloud-lightning" });
  expect(wmo(999, true)).toEqual({ he: "", icon: "cloud" });
});

test("fetchWeather asks for UTC times, m/s wind and the fields the dashboard draws", async () => {
  let url = "";
  await fetchWeather(32.8, 35.1, async (u) => { url = u; return Response.json(RAW); });
  for (const p of ["timezone=UTC", "wind_speed_unit=ms", "current=", "apparent_temperature", "precipitation_probability", "sunrise", "forecast_days=2"]) {
    expect(url).toContain(p);
  }
});
