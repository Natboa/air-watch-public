/** Open-Meteo hourly wind forecast (free, keyless). Used as a fallback for current wind and for "bay wind ahead". */
import type { FetchFn } from "./sviva";

export interface WindPoint { t: Date; fromDeg: number; speedMs: number }

export function parseForecast(json: unknown): WindPoint[] {
  const h = (json as any)?.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("forecast: no hourly block");
  const out: WindPoint[] = [];
  h.time.forEach((t: string, i: number) => {
    const fromDeg = h.wind_direction_10m?.[i];
    const speedMs = h.wind_speed_10m?.[i];
    if (typeof fromDeg !== "number" || typeof speedMs !== "number") return;
    out.push({ t: new Date(`${t}:00Z`), fromDeg, speedMs });
  });
  return out;
}

export async function fetchForecast(lat: number, lon: number, fetchFn: FetchFn = fetch): Promise<WindPoint[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=UTC&forecast_days=2`;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
  return parseForecast(await r.json());
}
