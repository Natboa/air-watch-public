/**
 * Basemap data for the station map, from OpenStreetMap (© OpenStreetMap contributors, ODbL) via the
 * Overpass API. Fetched once per frame and kept on disk: coast, roads and land use do not move, so
 * the panel's refreshes never touch Overpass. Overpass is a shared free service that often answers
 * 429/502/504 when busy, so a fetch retries with backoff, and any failure leaves the map without a
 * basemap (pins on white) rather than failing the dashboard.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { Frame, FeatureKind, MapFeature } from "./stationmap";

const OVERPASS = "https://overpass-api.de/api/interpreter";
type Bounds = Frame["bounds"];

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
/** A cache name for a frame: its bounds, rounded so a frame that moved by metres reuses the file. */
export const basemapKey = (b: Bounds) => [b.south, b.west, b.north, b.east].map((n) => n.toFixed(3)).join("_");

/** Overpass QL for a frame. The coast is asked for well beyond it, so the sea can be closed off-map. */
export function overpassQuery(b: Bounds): string {
  const h = b.north - b.south, w = b.east - b.west;
  const box = `(${r5(b.south)},${r5(b.west)},${r5(b.north)},${r5(b.east)})`;
  const wide = `(${r5(b.south - h)},${r5(b.west - w)},${r5(b.north + h)},${r5(b.east + w)})`;
  return `[out:json][timeout:90];(way["natural"="coastline"]${wide};way["highway"~"^(motorway|trunk|primary|secondary)$"]${box};` +
    `way["landuse"~"^(residential|industrial)$"]${box};way["natural"="water"]${box};);out geom;`;
}

/** Overpass JSON → the few features the map draws, coordinates rounded to ~1 m. */
export function parseOverpass(json: unknown): MapFeature[] {
  const out: MapFeature[] = [];
  for (const e of (json as { elements?: unknown[] })?.elements ?? []) {
    const el = e as { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };
    const t = el.tags ?? {}, g = el.geometry;
    if (!Array.isArray(g) || g.length < 2) continue;
    const kind: FeatureKind | null = t.natural === "coastline" ? "coast" : t.natural === "water" ? "water"
      : t.landuse === "residential" ? "built" : t.landuse === "industrial" ? "industry"
      : (["motorway", "trunk", "primary", "secondary"] as const).find((k) => t.highway === k) ?? null;
    if (kind) out.push({ kind, pts: g.map((p) => [r5(p.lat), r5(p.lon)]) });
  }
  return out;
}

/** The basemap for a frame: from the cache, else Overpass (retrying while it is busy); null if neither. */
export async function loadBasemap(b: Bounds, cacheDir: string, fetchFn: typeof fetch = fetch, waitMs = [5_000, 20_000, 60_000]): Promise<MapFeature[] | null> {
  const file = `${cacheDir}/${basemapKey(b)}.json`;
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, "utf8")) as MapFeature[]; } catch { /* corrupt: fetch again */ }
  }
  for (let attempt = 0; attempt <= waitMs.length; attempt++) {
    try {
      const res = await fetchFn(OVERPASS, {
        method: "POST", body: new URLSearchParams({ data: overpassQuery(b) }),
        headers: { "User-Agent": "air-watch/1.0 (personal e-ink air-quality dashboard)" }, signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        const features = parseOverpass(await res.json());
        if (features.length) {
          mkdirSync(cacheDir, { recursive: true });
          writeFileSync(file, JSON.stringify(features));
          return features;
        }
      } else if (![429, 502, 503, 504].includes(res.status)) return null;   // a real refusal: do not hammer it
    } catch { /* network or timeout: retry */ }
    if (attempt < waitMs.length) await new Promise((r) => setTimeout(r, waitMs[attempt]));
  }
  return null;
}
