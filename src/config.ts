/**
 * Air Watch configuration — every tunable number lives here.
 * Spec: docs/superpowers/specs/2026-10-15-air-watch-design.md
 */
import { readSettings } from "./settings";

const settings = readSettings(process.env);
/** Deployment coordinates are private; there is deliberately no built-in home location. */
export const HOME = settings.home;
/** A city or generic label; never derive display text from the home coordinates. */
export const PLACE = settings.place;

/** Averaged into "the air at home" — only those currently within LOCAL_RADIUS_KM (mobile stations move). */
export const LOCAL_STATION_IDS = settings.localStationIds;
export const LOCAL_RADIUS_KM = settings.localRadiusKm;
/** Wind comes from the first of these with fresh WD+WS, else the Open-Meteo forecast. */
export const WIND_STATION_IDS = settings.windStationIds;

export interface SourceDef { key: "bazan" | "tashan"; nameHe: string; stationIds: number[] }
export const SOURCES: SourceDef[] = [
  { key: "bazan", nameHe: 'בז"ן', stationIds: settings.bazanStationIds },
  { key: "tashan", nameHe: 'מכלי תש"ן', stationIds: settings.tashanStationIds },
];
export const SECTOR_HALF_WIDTH_DEG = 35;
export const MIN_WIND_MS = 1.0;
/**
 * Share of the source-fence concentration assumed to reach home. Calibrated on
 * Jul–Oct 2026: with wind from Bazan, local/fence benzene was p50 0.03, p95
 * 0.08 (n=1275 quarter-hours). 0.08 = cautious without crying wolf; the
 * plan's first guess of 0.3 produced ~1 false alert a day.
 */
export const PLUME_DILUTION = 0.08;
/** A confirmed level holds until the score is this far below its threshold (backtest: values hover at 100%). */
export const HYSTERESIS = 0.15;

export const ROLLING_WINDOW_MIN = 60;
export const MIN_SAMPLES_IN_WINDOW = 6;
/** MoEP publishes 10–20 min late (measured 2026-10-15), so a station is "fresh" up to 45 min. */
export const FRESH_MAX_AGE_MIN = 45;
export const STATION_MOVED_ALERT_M = 500;

export type Pollutant = "PM2.5" | "PM10" | "NO2" | "SO2" | "Benzene";
/**
 * Limits in µg/m³, compared against the 1-hour mean. Selected on
 * 2026-10-15 from the Jul–Oct backtest ("option B"):
 * - Benzene stays strict at Israel's daily ambient value (3.9).
 * - PM/NO2/SO2 use WHO interim target 4 / EU daily limits. Plain WHO 2021
 *   guidelines made the lamp orange 55% of the time (~5 messages a day).
 */
export const LIMITS_UGM3: Record<Pollutant, number> = {
  "PM2.5": 25, PM10: 50, NO2: 50, SO2: 125, Benzene: 3.9,
};
/** Measured and shown, but never sets the level: regional summer ozone drove most orange hours and isn't from the tanks. */
export const INFO_CHANNELS = ["O3"] as const;

export type Windows = "open" | "short" | "closed";
export interface LevelDef { level: number; key: string; nameHe: string; minScore: number; color: string; windows: Windows }
export const LEVELS: LevelDef[] = [
  { level: 0, key: "excellent", nameHe: "מצוין", minScore: 0, color: "#1b9e4b", windows: "open" },
  { level: 1, key: "good", nameHe: "טוב", minScore: 33, color: "#7ac943", windows: "open" },
  { level: 2, key: "moderate", nameHe: "סביר", minScore: 66, color: "#f2d41b", windows: "short" },
  { level: 3, key: "high", nameHe: "גבוה", minScore: 100, color: "#f39c12", windows: "closed" },
  { level: 4, key: "very_high", nameHe: "גבוה מאוד", minScore: 150, color: "#e53935", windows: "closed" },
  { level: 5, key: "hazardous", nameHe: "מסוכן", minScore: 300, color: "#8e24aa", windows: "closed" },
];
export const UNKNOWN_LEVEL = { key: "unknown", nameHe: "אין נתונים", color: "#9e9e9e", windows: "unknown" as const };
