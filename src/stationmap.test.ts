import { test, expect } from "bun:test";
import { fitFrame, joinChains, renderStationMap, seaPaths, simplify, type MapFeature, type MapInput } from "./stationmap";

const HOME = { lat: 32.8, lon: 35.1 }; // synthetic test anchor
const INPUT: MapInput = {
  home: HOME, localRadiusKm: 3, windFromDeg: 286, upwind: "tashan",
  sources: [{ key: "bazan", nameHe: 'בז"ן' }, { key: "tashan", nameHe: 'מכלי תש"ן' }],
  stations: [
    { id: 602, group: "local", lat: 32.8121, lon: 35.1076 }, { id: 97, group: "local", lat: 32.7882, lon: 35.0859 },
    { id: 415, group: "bazan", lat: 32.7927, lon: 35.0704 }, { id: 594, group: "bazan", lat: 32.7979, lon: 35.0646 },
    { id: 627, group: "tashan", lat: 32.8281, lon: 35.056 }, { id: 628, group: "tashan", lat: 32.8213, lon: 35.0552 },
  ],
};
const count = (svg: string, cls: string) => (svg.match(new RegExp(`class="${cls}"`, "g")) ?? []).length;

test("the frame fits home and every station inside the box, at the box's aspect", () => {
  const f = fitFrame([HOME, ...INPUT.stations], 182, 88);
  for (const p of [HOME, ...INPUT.stations]) {
    const [x, y] = f.P(p);
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(182);
    expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(88);
  }
  expect(f.bounds.north).toBeGreaterThan(f.bounds.south);
  expect(f.bounds.east).toBeGreaterThan(f.bounds.west);
  expect(f.pxPerKm).toBeGreaterThan(5);
});

test("two markings only: a dot per station, a factory per source; the upwind source's name is bold", () => {
  const svg = renderStationMap(INPUT, null, 182, 88, 2);
  expect(count(svg, "station")).toBe(6);
  expect(count(svg, "source")).toBe(2);
  expect(count(svg, "home")).toBe(1);
  expect(svg).toMatch(/font-weight="900"[^>]*>מכלי תש"ן</);
  expect(svg).toMatch(/font-weight="700"[^>]*>בז"ן</);
});

test("wind: a pointer on a pill in the corner, turned to where the air goes; no wind, no pill", () => {
  const svg = renderStationMap(INPUT, null, 182, 88, 2);
  expect(svg).toContain('class="wind"');
  expect(svg).toContain("rotate(106 12 12)");                  // from 286° → towards 106°
  expect(renderStationMap({ ...INPUT, windFromDeg: null }, null, 182, 88, 2)).not.toContain('class="wind"');
});

test("the sea closes clockwise round the frame on the right of the coast (OSM: land on the left)", () => {
  // A straight coast running south down the middle: land on its left (east) → sea to the west.
  const coast: [number, number][][] = [[[32.9, 35.05], [32.7, 35.05]]];
  const f = fitFrame([HOME, { lat: 32.79, lon: 35.03 }], 182, 88);
  const [d] = seaPaths(coast, f.P, 182, 88);
  const xs = [...d.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
  expect(Math.min(...xs)).toBeLessThan(-100);                    // walks out to the west…
  expect(Math.max(...xs)).toBeLessThan(182);                     // …never round the east
});

test("coast pieces join end to start; simplification keeps the ends and drops sub-pixel wiggles", () => {
  const chains = joinChains([[[1, 1], [2, 2]], [[0, 0], [1, 1]], [[2, 2], [3, 3]]]);
  expect(chains).toEqual([[[0, 0], [1, 1], [2, 2], [3, 3]]]);
  expect(simplify([[0, 0], [5, 0.2], [10, 0]], 0.5)).toEqual([[0, 0], [10, 0]]);
  expect(simplify([[0, 0], [5, 3], [10, 0]], 0.5)).toHaveLength(3);
});

test("2-bit draws the sea dark grey and towns light grey; 1-bit uses a dot screen and leaves towns white", () => {
  const features: MapFeature[] = [
    { kind: "coast", pts: [[32.9, 35.05], [32.7, 35.05]] },
    { kind: "built", pts: [[32.80, 35.10], [32.81, 35.10], [32.81, 35.11], [32.80, 35.10]] },
    { kind: "primary", pts: [[32.79, 35.06], [32.81, 35.11]] },
  ];
  const grey = renderStationMap(INPUT, features, 182, 88, 2), bw = renderStationMap(INPUT, features, 182, 88, 1);
  expect(grey).toMatch(/class="sea"[^>]*fill="#555"/);
  expect(grey).toContain('fill="#aaa"');
  expect(bw).toMatch(/class="sea"[^>]*fill="url\(#map-dots\)"/);
  expect(bw).not.toContain('fill="#aaa"');
  expect(bw).not.toContain('fill="#555"');
});
