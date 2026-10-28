/**
 * The station map under the sky disc: home, every monitoring station we use (a dot), each pollution
 * source (a factory), the 3 km circle that decides which stations count as "local", and the wind.
 * Nothing in it is placed by hand: the frame is fitted around home and the stations, sources sit by
 * the stations that watch them, labels place themselves, and the basemap is OSM data for that frame
 * (basemap.ts) — so it works for any address.
 *
 * Styled for e-ink, not copied from a web map (raster maps dither into noise at this size): in 2-bit
 * the sea is dark grey and built-up areas light grey; in 1-bit they become a dot screen and white.
 * Industry is hatched, main roads are black lines.
 */
import { icon } from "./icons";
import type { LatLon } from "./geo";
import type { Bits } from "./eink";

export type FeatureKind = "coast" | "water" | "built" | "industry" | "motorway" | "trunk" | "primary" | "secondary";
export interface MapFeature { kind: FeatureKind; pts: [number, number][] }   // [lat, lon]
export interface MapStation extends LatLon { id: number; /** "local", or the key of the source it watches */ group: string }
export interface MapInput {
  home: LatLon;
  stations: MapStation[];
  sources: { key: string; nameHe: string }[];
  windFromDeg: number | null;
  /** Key of the source the wind is bringing air from right now, if any — its name is set in bold. */
  upwind: string | null;
  localRadiusKm: number;
}

const f1 = (n: number) => +n.toFixed(1);
const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2;
const unX = (x: number) => x * 360 - 180;
const unY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export interface Frame {
  /** lat/lon → map pixels. */
  P: (p: LatLon) => [number, number];
  pxPerKm: number;
  /** The frame in degrees, for fetching the basemap. */
  bounds: { south: number; west: number; north: number; east: number };
}

/** A W×H Web Mercator frame around every point, padded by `pad` of their spread on each side. */
export function fitFrame(pts: LatLon[], W: number, H: number, pad = 0.22): Frame {
  const xs = pts.map((p) => mercX(p.lon)), ys = pts.map((p) => mercY(p.lat));
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const spread = Math.max(x1 - x0, y1 - y0, 1e-5);
  const px = Math.max((x1 - x0) * pad, spread * 0.05), py = Math.max((y1 - y0) * pad, spread * 0.05);
  x0 -= px; x1 += px; y0 -= py; y1 += py;
  const want = W / H, have = (x1 - x0) / (y1 - y0);
  if (have < want) { const d = ((y1 - y0) * want - (x1 - x0)) / 2; x0 -= d; x1 += d; }
  else { const d = ((x1 - x0) / want - (y1 - y0)) / 2; y0 -= d; y1 += d; }
  const latMid = unY((y0 + y1) / 2);
  return {
    P: (p) => [f1(((mercX(p.lon) - x0) / (x1 - x0)) * W), f1(((mercY(p.lat) - y0) / (y1 - y0)) * H)],
    pxPerKm: W / ((x1 - x0) * 40075 * Math.cos((latMid * Math.PI) / 180)),
    bounds: { south: unY(y1), west: unX(x0), north: unY(y0), east: unX(x1) },
  };
}

/** Join coastline pieces end to start into chains (OSM splits the coast into many ways). */
export function joinChains(pieces: [number, number][][]): [number, number][][] {
  const left = pieces.filter((w) => w.length > 1).map((w) => [...w]), out: [number, number][][] = [];
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  while (left.length) {
    let c = left.shift()!, grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i];
        if (same(w[0], c[c.length - 1])) { c = c.concat(w.slice(1)); left.splice(i, 1); grown = true; break; }
        if (same(w[w.length - 1], c[0])) { c = w.concat(c.slice(1)); left.splice(i, 1); grown = true; break; }
      }
    }
    out.push(c);
  }
  return out;
}

/**
 * Sea outlines in map pixels. OSM keeps the land on the left of a coastline, so an open chain is closed
 * by walking a frame well outside the map clockwise from where the coast ends back to where it starts;
 * a closed chain (an island, a lake drawn as coast) is used as it is.
 */
export function seaPaths(coast: [number, number][][], P: Frame["P"], W: number, H: number): string[] {
  const M = 400, L = W + 2 * M, T = H + 2 * M, total = 2 * (L + T);
  const corner: [number, number][] = [[W + M, -M], [W + M, H + M], [-M, H + M], [-M, -M]];        // ends of the 4 sides, clockwise
  const cornerAt = [L, L + T, 2 * L + T, total];
  /** Distance clockwise along the outer frame from its top-left corner to the point nearest p. */
  const along = ([x, y]: [number, number]) => {
    const cx = Math.max(-M, Math.min(W + M, x)), cy = Math.max(-M, Math.min(H + M, y));
    const d = [cy + M, W + M - cx, H + M - cy, cx + M], side = d.indexOf(Math.min(...d));
    return side === 0 ? cx + M : side === 1 ? L + cy + M : side === 2 ? L + T + W + M - cx : 2 * L + T + H + M - cy;
  };
  return joinChains(coast).map((chain) => {
    const pts = chain.map(([lat, lon]) => P({ lat, lon }));
    let d = "M" + pts.map((p) => p.join(" ")).join(" L");
    const a = chain[0], b = chain[chain.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) {
      // The frame's corners passed going clockwise from the coast's end to its start, in that order.
      const from = along(pts[pts.length - 1]), gap = (along(pts[0]) - from + total) % total;
      const passed = corner.map((c, k) => ({ c, step: (cornerAt[k] - from + total) % total }))
        .filter((e) => e.step > 0 && e.step < gap).sort((x, y) => x.step - y.step);
      d += passed.map((e) => ` L${e.c.join(" ")}`).join("");
    }
    return d + "Z";
  });
}

/** Douglas–Peucker in pixels: no point keeping detail the panel cannot show. */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > worst) { worst = d; at = i; }
  }
  return worst <= tol ? [pts[0], pts[pts.length - 1]] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

const ROAD_W: Partial<Record<FeatureKind, number>> = { secondary: 0.6, primary: 0.9, trunk: 1.4, motorway: 1.7 };

/** The map, W×H at the origin (the caller translates it). `features` null → pins on white. */
export function renderStationMap(inp: MapInput, features: MapFeature[] | null, W: number, H: number, bits: Bits): string {
  const frame = fitFrame([inp.home, ...inp.stations], W, H), { P } = frame;
  const out: string[] = [];
  const sea = bits === 2 ? "#555" : "url(#map-dots)", built = bits === 2 ? "#aaa" : "none";
  out.push(`<g class="station-map"><defs><clipPath id="map-box"><rect width="${W}" height="${H}" rx="6"/></clipPath>`,
    `<pattern id="map-dots" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#fff"/><rect x="1" y="1" width="1" height="1" fill="#000"/></pattern>`,
    `<pattern id="map-ind" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4.5" stroke="#000" stroke-width="0.6"/></pattern></defs>`,
    `<g clip-path="url(#map-box)"><rect width="${W}" height="${H}" fill="#fff"/>`);
  if (features) {
    const px = (f: MapFeature) => simplify(f.pts.map(([lat, lon]) => P({ lat, lon })), 0.5);
    const path = (f: MapFeature, close: boolean) => "M" + px(f).map((p) => p.join(" ")).join(" L") + (close ? "Z" : "");
    for (const f of features) if (f.kind === "built" && built !== "none") out.push(`<path d="${path(f, true)}" fill="${built}"/>`);
    for (const f of features) if (f.kind === "industry") out.push(`<path d="${path(f, true)}" fill="url(#map-ind)"/>`);
    for (const d of seaPaths(features.filter((f) => f.kind === "coast").map((f) => f.pts), P, W, H)) out.push(`<path class="sea" d="${d}" fill="${sea}" fill-rule="evenodd"/>`);
    for (const f of features) if (f.kind === "water") out.push(`<path d="${path(f, true)}" fill="${sea}"/>`);
    for (const k of ["secondary", "primary", "trunk", "motorway"] as const) for (const f of features) if (f.kind === k) {
      out.push(`<path d="${path(f, false)}" fill="none" stroke="#000" stroke-width="${ROAD_W[k]}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  const [hx, hy] = P(inp.home), r = f1(inp.localRadiusKm * frame.pxPerKm);
  out.push(`<circle cx="${hx}" cy="${hy}" r="${r}" fill="none" stroke="#fff" stroke-width="2.8"/><circle class="local-radius" cx="${hx}" cy="${hy}" r="${r}" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="2 2"/>`);

  const labels: string[] = [];
  const label = (x: number, y: number, s: string, weight: number, anchor: string) =>
    `<text x="${f1(x)}" y="${f1(y)}" font-family="Heebo" font-size="10" font-weight="${weight}" text-anchor="${anchor}" direction="rtl" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${s}</text>`;
  // Sources: a factory just beyond the stations that watch it, on the side away from home, so it never hides them.
  for (const src of inp.sources) {
    const mine = inp.stations.filter((s) => s.group === src.key).map(P);
    if (!mine.length) continue;
    const mx = mine.reduce((a, p) => a + p[0], 0) / mine.length, my = mine.reduce((a, p) => a + p[1], 0) / mine.length;
    const spread = Math.max(...mine.map(([x, y]) => Math.hypot(x - mx, y - my)));
    const dx = mx - hx, dy = my - hy, len = Math.hypot(dx, dy) || 1, push = spread + 11;
    const cx = Math.max(9, Math.min(W - 9, mx + (dx / len) * push)), cy = Math.max(10, Math.min(H - 8, my + (dy / len) * push));
    const d = `M${f1(cx - 7)} ${f1(cy + 5)} V${f1(cy - 1)} L${f1(cx - 3)} ${f1(cy - 4)} V${f1(cy - 1)} L${f1(cx + 1)} ${f1(cy - 4)} V${f1(cy - 1)} H${f1(cx + 3)} V${f1(cy - 8)} H${f1(cx + 6)} V${f1(cy + 5)}Z`;
    out.push(`<path d="${d}" fill="#fff" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/><path class="source" d="${d}" fill="#000"/>`);
    labels.push(label(Math.max(14, Math.min(W - 14, cx)), cy + 17 <= H - 2 ? cy + 17 : cy - 11, src.nameHe, inp.upwind === src.key ? 900 : 700, "middle"));
  }
  for (const s of inp.stations) { const [x, y] = P(s); out.push(`<circle class="station" cx="${x}" cy="${y}" r="2.8" fill="#000" stroke="#fff" stroke-width="1.3"/>`); }
  out.push(`<circle cx="${hx}" cy="${hy}" r="7" fill="#fff" stroke="#000" stroke-width="1.5"/><path class="home" d="M${f1(hx - 4)} ${f1(hy + 3.5)} v-4 l4 -4 l4 4 v4 z" fill="#000"/>`);
  labels.push(hx + 40 < W ? label(hx + 10, hy + 4, "בית", 900, "start") : label(hx - 10, hy + 4, "בית", 900, "end"));
  out.push(...labels, `</g><rect width="${W}" height="${H}" rx="6" fill="none" stroke="#000" stroke-width="1.6"/>`);
  // Wind: the weather panel's own pointer (where the air goes), on a white pill in the top corner.
  if (inp.windFromDeg !== null) {
    out.push(`<rect class="wind" x="${W - 50}" y="4" width="46" height="20" rx="10" fill="#fff" stroke="#000" stroke-width="1.2"/>`,
      icon("navigation-2", W - 47, 6, 16, { stroke: 2.2, rotate: (inp.windFromDeg + 180) % 360 }),
      `<text x="${W - 9}" y="18" font-family="Heebo" font-size="11" font-weight="700" text-anchor="end" direction="rtl">רוח</text>`);
  }
  out.push(`</g>`);
  return out.join("\n");
}
