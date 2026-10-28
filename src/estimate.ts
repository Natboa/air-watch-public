/**
 * The Air Watch estimate (pure). Local air = inverse-distance-squared mean of
 * nearby stations; wind = station vector mean or forecast; when the wind blows
 * from a known source, that source's fence readings × dilution are treated as
 * incoming. Score = worst pollutant as % of its strict limit.
 */
import {
  HOME, LIMITS_UGM3, INFO_CHANNELS, LEVELS, LOCAL_RADIUS_KM, MIN_WIND_MS, PLUME_DILUTION, FRESH_MAX_AGE_MIN,
  ROLLING_WINDOW_MIN, MIN_SAMPLES_IN_WINDOW, SECTOR_HALF_WIDTH_DEG, type Pollutant, type SourceDef,
} from "./config";
import { distanceKm, bearingDeg, angleDiff, circularMeanDeg, meanWind } from "./geo";
import type { StationMeta, Sample } from "./sviva";
import type { WindPoint } from "./wind";

export interface StationInput { meta: StationMeta; samples: Sample[] }
export interface Wind { fromDeg: number; speedMs: number; origin: "station" | "forecast" }
export interface Lead { pollutant: Pollutant; ugm3: number; pct: number; origin: "local" | "upwind" }
export interface Upwind { key: SourceDef["key"]; nameHe: string; distanceKm: number; etaMin: number; pct: number }
export interface UsedStation { id: number; name: string; distanceKm: number; ageMin: number }
export interface Estimate {
  at: Date; score: number | null; level: number | null; lead: Lead | null; wind: Wind | null; calm: boolean;
  upwind: Upwind | null; local: UsedStation[]; nextBayWindAt: Date | null; note: string | null;
  /** Local means of channels that are shown but never scored (ozone). */
  info: Record<string, number>;
  /** Local benzene mean (µg/m³), reported even when something else leads — it is a monitored pollutant. */
  benzene: number | null;
  /** Every local mean this run (scored pollutants and info channels), µg/m³ — for the dashboard tiles. */
  means: Record<string, number>;
}
export interface EstimateInput {
  now: Date; local: StationInput[]; wind: StationInput[];
  sources: { def: SourceDef; stations: StationInput[] }[]; forecast: WindPoint[]; dilution?: number;
  /** Per-pollutant overrides of LIMITS_UGM3 (backtest calibration). */
  limits?: Partial<Record<Pollutant, number>>;
}

const POLLUTANTS = Object.keys(LIMITS_UGM3) as Pollutant[];
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The samples in the ROLLING_WINDOW_MIN ending at the station's NEWEST sample
 * (not at `now`: MoEP publishes 10–20 min late, and anchoring on `now` would
 * silently shrink the hour). Null when the newest is older than
 * FRESH_MAX_AGE_MIN or the hour is too thin.
 */
function inWindow(samples: Sample[], now: Date, has: (s: Sample) => boolean): { pts: Sample[]; newest: number } | null {
  const upToNow = samples.filter((s) => s.t.getTime() <= now.getTime() && has(s));
  if (!upToNow.length) return null;
  const newest = Math.max(...upToNow.map((s) => s.t.getTime()));
  if ((now.getTime() - newest) / 60_000 > FRESH_MAX_AGE_MIN) return null;
  const pts = upToNow.filter((s) => s.t.getTime() > newest - ROLLING_WINDOW_MIN * 60_000);
  return pts.length < MIN_SAMPLES_IN_WINDOW ? null : { pts, newest };
}

export function rollingMean(samples: Sample[], channel: string, now: Date): { mean: number; ageMin: number } | null {
  const w = inWindow(samples, now, (s) => channel in s.values);
  if (!w) return null;
  const mean = w.pts.reduce((a, s) => a + Math.max(0, s.values[channel]), 0) / w.pts.length;
  return { mean, ageMin: (now.getTime() - w.newest) / 60_000 };
}

export function levelForScore(score: number): number {
  let level = 0;
  for (const l of LEVELS) if (score >= l.minScore) level = l.level;
  return level;
}

function stationWind(st: StationInput, now: Date): { fromDeg: number; speedMs: number } | null {
  const w = inWindow(st.samples, now, (s) => "WD" in s.values && "WS" in s.values);
  return w ? meanWind(w.pts.map((s) => ({ fromDeg: s.values.WD, speedMs: s.values.WS }))) : null;
}

function nearestForecast(f: WindPoint[], now: Date): WindPoint | null {
  let best: WindPoint | null = null;
  for (const p of f) {
    const d = Math.abs(p.t.getTime() - now.getTime());
    if (d <= 90 * 60_000 && (!best || d < Math.abs(best.t.getTime() - now.getTime()))) best = p;
  }
  return best;
}

function geometry(stations: StationInput[]): { bearing: number; distanceKm: number } | null {
  if (!stations.length) return null;
  return {
    bearing: circularMeanDeg(stations.map((s) => bearingDeg(HOME, s.meta))),
    distanceKm: stations.reduce((a, s) => a + distanceKm(HOME, s.meta), 0) / stations.length,
  };
}

function nextBayWind(f: WindPoint[], bearings: number[], now: Date): Date | null {
  const horizon = now.getTime() + 6 * 3_600_000;
  for (const p of [...f].sort((a, b) => a.t.getTime() - b.t.getTime())) {
    if (p.t.getTime() <= now.getTime() || p.t.getTime() > horizon) continue;
    if (p.speedMs >= MIN_WIND_MS && bearings.some((b) => angleDiff(p.fromDeg, b) <= SECTOR_HALF_WIDTH_DEG)) return p.t;
  }
  return null;
}

export function estimateUnavailable(now: Date, note: string): Estimate {
  return { at: now, score: null, level: null, lead: null, wind: null, calm: true, upwind: null, local: [], nextBayWindAt: null, note, info: {}, benzene: null, means: {} };
}

export function estimate(input: EstimateInput): Estimate {
  const { now } = input;
  const dilution = input.dilution ?? PLUME_DILUTION;
  const limits: Record<Pollutant, number> = { ...LIMITS_UGM3, ...input.limits };

  // 1. Local air: inverse-distance-squared mean per pollutant (and per info channel).
  const used = new Map<number, UsedStation>();
  const means: Record<string, number> = {};
  for (const p of [...POLLUTANTS, ...INFO_CHANNELS]) {
    let wsum = 0, vsum = 0;
    for (const st of input.local) {
      const d = distanceKm(HOME, st.meta);
      if (d > LOCAL_RADIUS_KM) continue;
      const m = rollingMean(st.samples, p, now);
      if (!m) continue;
      const w = 1 / Math.max(d, 0.2) ** 2;
      wsum += w;
      vsum += w * m.mean;
      const prev = used.get(st.meta.id);
      if (!prev || m.ageMin < prev.ageMin) {
        used.set(st.meta.id, { id: st.meta.id, name: st.meta.name, distanceKm: round1(d), ageMin: Math.round(m.ageMin) });
      }
    }
    if (wsum > 0) means[p] = vsum / wsum;
  }
  const info: Record<string, number> = {};
  for (const c of INFO_CHANNELS) if (c in means) info[c] = means[c];

  // 2. Wind: first fresh station, else the forecast hour nearest now.
  let wind: Wind | null = null;
  for (const st of input.wind) {
    const w = stationWind(st, now);
    if (w) { wind = { ...w, origin: "station" }; break; }
  }
  if (!wind) {
    const f = nearestForecast(input.forecast, now);
    if (f) wind = { fromDeg: f.fromDeg, speedMs: f.speedMs, origin: "forecast" };
  }
  const calm = !wind || wind.speedMs < MIN_WIND_MS;

  // 3. Upwind: is the wind blowing from a known source right now?
  const sectors = input.sources
    .map((s) => ({ def: s.def, stations: s.stations, geo: geometry(s.stations) }))
    .filter((s): s is typeof s & { geo: NonNullable<typeof s.geo> } => s.geo !== null);
  let upwind: Upwind | null = null;
  let upwindLead: Lead | null = null;
  if (!calm && wind) {
    for (const s of sectors) {
      if (angleDiff(wind.fromDeg, s.geo.bearing) > SECTOR_HALF_WIDTH_DEG) continue;
      for (const p of POLLUTANTS) {
        const vals = s.stations.map((st) => rollingMean(st.samples, p, now)?.mean).filter((v): v is number => v !== undefined);
        if (!vals.length) continue;
        const incoming = Math.max(...vals) * dilution;
        const pct = (incoming / limits[p]) * 100;
        if (!upwindLead || pct > upwindLead.pct) {
          upwindLead = { pollutant: p, ugm3: incoming, pct, origin: "upwind" };
          upwind = {
            key: s.def.key, nameHe: s.def.nameHe, distanceKm: round1(s.geo.distanceKm),
            etaMin: Math.round((s.geo.distanceKm * 1000) / wind.speedMs / 60), pct,
          };
        }
      }
    }
  }

  const nextBayWindAt = nextBayWind(input.forecast, sectors.map((s) => s.geo.bearing), now);

  // 4. Score = worst pollutant as % of its limit, local or incoming.
  let lead: Lead | null = null;
  for (const p of POLLUTANTS) {
    const v = means[p];
    if (v === undefined) continue;
    const pct = (v / limits[p]) * 100;
    if (!lead || pct > lead.pct) lead = { pollutant: p, ugm3: v, pct, origin: "local" };
  }
  if (!lead) {
    return { ...estimateUnavailable(now, "אין נתונים עדכניים מהתחנות הקרובות"), wind, calm, upwind, nextBayWindAt, info, benzene: means.Benzene ?? null, means };
  }
  if (upwindLead && upwindLead.pct > lead.pct) lead = upwindLead;

  return {
    at: now, score: lead.pct, level: levelForScore(lead.pct), lead, wind, calm, upwind,
    local: [...used.values()].sort((a, b) => a.distanceKm - b.distanceKm),
    nextBayWindAt,
    note: calm ? "רוח חלשה — ההערכה פחות אמינה" : null,
    info,
    benzene: means.Benzene ?? null,
    means,
  };
}
