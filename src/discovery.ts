import { distanceKm, type LatLon } from "./geo";
import type { StationMeta } from "./sviva";

/** Active is provider metadata, not proof of fresh or complete pollutant readings. */
export function nearestStations(home: LatLon, stations: StationMeta[]): { station: StationMeta; distanceKm: number }[] {
  return stations
    .filter((s) => s.active && Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)
    .map((station) => ({ station, distanceKm: distanceKm(home, station) }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.station.id - b.station.id)
    .slice(0, 12);
}
