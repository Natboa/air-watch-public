/** Open-Meteo weather for the dashboard (free, keyless). All times are UTC instants. */
import type { FetchFn } from "./sviva";

export interface WeatherNow { t: Date; temp: number; feels: number; humidity: number; code: number; isDay: boolean; windMs: number; windFromDeg: number }
export interface WeatherHour { t: Date; temp: number; rainPct: number; code: number; isDay: boolean }
export interface Weather { now: WeatherNow; hourly: WeatherHour[]; today: { max: number; min: number; sunrise: Date; sunset: Date } }

const utc = (s: string) => new Date(`${s}:00Z`);
const num = (v: unknown) => (typeof v === "number" ? v : NaN);

export function parseWeather(json: unknown): Weather {
  const j = json as any;
  const c = j?.current, h = j?.hourly, d = j?.daily;
  if (!c || !h || !Array.isArray(h.time) || !d || !Array.isArray(d.time)) throw new Error("weather: missing current/hourly/daily");
  const hourly: WeatherHour[] = [];
  h.time.forEach((t: string, i: number) => {
    const row = { t: utc(t), temp: num(h.temperature_2m?.[i]), rainPct: num(h.precipitation_probability?.[i]), code: num(h.weather_code?.[i]), isDay: h.is_day?.[i] === 1 };
    if (Number.isFinite(row.temp) && Number.isFinite(row.code)) hourly.push({ ...row, rainPct: Number.isFinite(row.rainPct) ? row.rainPct : 0 });
  });
  return {
    now: {
      t: utc(c.time), temp: num(c.temperature_2m), feels: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
      code: num(c.weather_code), isDay: c.is_day === 1, windMs: num(c.wind_speed_10m), windFromDeg: num(c.wind_direction_10m),
    },
    hourly,
    today: { max: num(d.temperature_2m_max?.[0]), min: num(d.temperature_2m_min?.[0]), sunrise: utc(d.sunrise?.[0]), sunset: utc(d.sunset?.[0]) },
  };
}

/** WMO weather code → Hebrew description and a Lucide icon name. */
export function wmo(code: number, isDay: boolean): { he: string; icon: string } {
  if (code === 0) return { he: "בהיר", icon: isDay ? "sun" : "moon" };
  if (code === 1 || code === 2) return { he: code === 1 ? "בהיר ברובו" : "מעונן חלקית", icon: isDay ? "cloud-sun" : "cloud-moon" };
  if (code === 3) return { he: "מעונן", icon: "cloud" };
  if (code === 45 || code === 48) return { he: "ערפל", icon: "cloud-fog" };
  if (code >= 51 && code <= 57) return { he: "טפטוף", icon: "cloud-drizzle" };
  if (code >= 61 && code <= 67) return { he: "גשם", icon: "cloud-rain" };
  if (code >= 71 && code <= 77) return { he: "שלג", icon: "cloud-snow" };
  if (code >= 80 && code <= 82) return { he: "ממטרים", icon: "cloud-sun-rain" };
  if (code >= 95 && code <= 99) return { he: "סופת רעמים", icon: "cloud-lightning" };
  return { he: "", icon: "cloud" };
}

export async function fetchWeather(lat: number, lon: number, fetchFn: FetchFn = fetch): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&wind_speed_unit=ms&timezone=UTC&forecast_days=2`;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
  return parseWeather(await r.json());
}
