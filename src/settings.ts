import type { LatLon } from "./geo";

type Env = Record<string, string | undefined>;
export interface Settings {
  home: LatLon;
  place: string;
  localRadiusKm: number;
  localStationIds: number[];
  windStationIds: number[];
  bazanStationIds: number[];
  tashanStationIds: number[];
}

/** Errors identify the setting, never echo a private coordinate or other input. */
function numberSetting(env: Env, key: string, min: number, max: number): number {
  const raw = env[key]?.trim() ?? "";
  const value = Number(raw);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Set ${key} to a decimal number between ${min} and ${max} in your private .env file.`);
  }
  return value;
}

function stationIds(env: Env, key: string, required = false): number[] {
  const raw = env[key]?.trim() ?? "";
  if (!raw && !required) return [];
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)) || Number(part) <= 0)) {
    throw new Error(`Set ${key} to a comma-separated list of positive station IDs in your private .env file.`);
  }
  return [...new Set(parts.map(Number))];
}

/** Discovery can run before the user has chosen their monitoring stations. */
export function readHome(env: Env): LatLon {
  return { lat: numberSetting(env, "AIR_HOME_LAT", -90, 90), lon: numberSetting(env, "AIR_HOME_LON", -180, 180) };
}

/** Bun loads .env before imports; tests can validate settings without mutating process.env. */
export function readSettings(env: Env): Settings {
  const home = readHome(env);
  const localRadiusKm = numberSetting({ AIR_LOCAL_RADIUS_KM: "3", ...env }, "AIR_LOCAL_RADIUS_KM", Number.MIN_VALUE, Number.MAX_VALUE);
  return {
    home,
    place: env.AIR_PLACE?.trim() || "איכות האוויר",
    localRadiusKm,
    localStationIds: stationIds(env, "AIR_LOCAL_STATION_IDS", true),
    windStationIds: stationIds(env, "AIR_WIND_STATION_IDS"),
    bazanStationIds: stationIds(env, "AIR_BAZAN_STATION_IDS"),
    tashanStationIds: stationIds(env, "AIR_TASHAN_STATION_IDS"),
  };
}
