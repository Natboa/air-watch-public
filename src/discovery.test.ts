import { expect, test } from "bun:test";
import { nearestStations } from "./discovery";
import type { StationMeta } from "./sviva";

const station = (id: number, lat: number, active = true): StationMeta => ({ id, lat, lon: 0, active, name: `Station ${id}`, mobile: false, address: "" });

test("discovery ranks active stations by geographic distance, not API order", () => {
  const stations = [station(3, 0.03), station(1, 0.01), station(2, 0.02)];
  const results = nearestStations({ lat: 0, lon: 0 }, stations);
  expect(results.map((r) => r.station.id)).toEqual([1, 2, 3]);
  expect(results[0].distanceKm).toBeCloseTo(1.112, 2);
  expect(stations.map((s) => s.id)).toEqual([3, 1, 2]);
});

test("discovery excludes inactive stations and invalid positions, but keeps valid zero coordinates", () => {
  const results = nearestStations({ lat: 0, lon: 0 }, [station(1, 0), station(2, 0.001, false), station(3, NaN), station(4, 91)]);
  expect(results.map((r) => r.station.id)).toEqual([1]);
  expect(results[0].distanceKm).toBe(0);
});

test("discovery caps the candidate list and handles an empty provider response", () => {
  expect(nearestStations({ lat: 0, lon: 0 }, Array.from({ length: 20 }, (_, i) => station(i + 1, i / 1000)))).toHaveLength(12);
  expect(nearestStations({ lat: 0, lon: 0 }, [])).toEqual([]);
});
