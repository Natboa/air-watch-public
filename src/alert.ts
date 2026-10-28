/**
 * Turns a noisy 5-minute level into calm Telegram alerts: a level holds until
 * its score drops HYSTERESIS below the threshold, a change must persist (up 2
 * runs, down 3, unknown 4), and messages go out per band, not per level. Quiet hours (23–07 Israel) hold everything below very_high and
 * release a single catch-up at 07:00.
 */
import { hourIn, HOME_TZ } from "./time";
import { distanceKm } from "./geo";
import { STATION_MOVED_ALERT_M, HYSTERESIS, LEVELS } from "./config";
import type { StationMeta } from "./sviva";

/** Bands follow the window advice: everything below orange is "fine" (open, or short ventilation). */
export type Band = "fine" | "high" | "very_high" | "hazardous" | "unknown";
export interface AlertState {
  initialized: boolean;
  confirmed: number | null;
  candidate: number | null;
  candidateCount: number;
  lastSentBand: Band | null;
  stationLocations: Record<string, { lat: number; lon: number }>;
}
export const EMPTY_STATE: AlertState = {
  initialized: false, confirmed: null, candidate: null, candidateCount: 0, lastSentBand: null, stationLocations: {},
};
export const CONFIRM_TICKS = { up: 2, down: 3, unknown: 4 } as const;

const BANDS: Band[] = ["fine", "fine", "fine", "high", "very_high", "hazardous"];
export function bandOf(level: number | null): Band {
  return level === null ? "unknown" : BANDS[level];
}
const urgent = (b: Band) => b === "very_high" || b === "hazardous";

export function isQuietHours(now: Date): boolean {
  const h = hourIn(now, HOME_TZ);
  return h >= 23 || h < 7;
}

/** Hold a confirmed level while the score is within HYSTERESIS below its threshold; rises pass straight through. */
export function applyHysteresis(level: number | null, score: number | null, confirmed: number | null): number | null {
  if (level === null || score === null || confirmed === null || level >= confirmed) return level;
  return score >= LEVELS[confirmed].minScore * (1 - HYSTERESIS) ? confirmed : level;
}

export function step(prev: AlertState, level: number | null, now: Date): { state: AlertState; notify: boolean } {
  const s: AlertState = { ...prev };
  // Nothing to compare against until the first real reading: an outage on the
  // very first run must not become a confirmed "unknown" alert.
  if (!s.initialized && level === null) return { state: s, notify: false };
  if (!s.initialized) {
    s.initialized = true;
    s.confirmed = level;
    s.candidate = null;
    s.candidateCount = 0;
  } else if (level === s.confirmed) {
    s.candidate = null;
    s.candidateCount = 0;
  } else {
    s.candidateCount = level === s.candidate ? s.candidateCount + 1 : 1;
    s.candidate = level;
    const needed = level === null ? CONFIRM_TICKS.unknown
      : s.confirmed === null || level > s.confirmed ? CONFIRM_TICKS.up : CONFIRM_TICKS.down;
    if (s.candidateCount >= needed) {
      s.confirmed = level;
      s.candidate = null;
      s.candidateCount = 0;
    }
  }

  // Baseline is "fine": a bad first reading still alerts.
  if (s.lastSentBand === null) s.lastSentBand = "fine";
  const band = bandOf(s.confirmed);
  if (band === s.lastSentBand) return { state: s, notify: false };
  if (isQuietHours(now) && !urgent(band)) return { state: s, notify: false };
  s.lastSentBand = band;
  return { state: s, notify: true };
}

export function movedStations(prev: AlertState, metas: StationMeta[]) {
  const locations: AlertState["stationLocations"] = { ...prev.stationLocations };
  const moved: { meta: StationMeta; km: number }[] = [];
  for (const m of metas) {
    const old = locations[String(m.id)];
    if (old) {
      const km = distanceKm(old, m);
      if (km * 1000 > STATION_MOVED_ALERT_M) moved.push({ meta: m, km });
    }
    locations[String(m.id)] = { lat: m.lat, lon: m.lon };
  }
  return { moved, locations };
}
