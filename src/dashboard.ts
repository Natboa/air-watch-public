/**
 * The e-ink dashboard: one 800×480 image for the TRMNL 7.5" (OG) DIY kit.
 * Air (the point of it) on the right, weather on the left, a day/night disc in
 * the corner, a week-long pollution graph across the bottom. It is drawn in black
 * and white so it reads on a 1-bit panel; eink.ts turns it into the panel's
 * PNG (1-bit, or 4 greys where the firmware allows, which only smooths edges
 * and the moon photo). State is carried by words, icons, fill and hatching,
 * never by colour. Hebrew is laid out RTL; resvg handles the bidi with Heebo.
 */
import { HOME, LEVELS, LOCAL_RADIUS_KM, LOCAL_STATION_IDS, SOURCES } from "./config";
import { HOME_TZ, hourIn } from "./time";
import { icon, windowIcon } from "./icons";
import { wmo, type Weather } from "./weather";
import { hourlyPeaks } from "./weekly";
import type { AirStatus } from "./format";
import type { HistoryEntry } from "./history";
import { renderSkyDisc } from "./skydisc";
import { svgToEinkPng, type Bits, type Circle } from "./eink";
import { fitFrame, renderStationMap, type MapFeature, type MapStation } from "./stationmap";
import type { StationMeta } from "./sviva";

export interface DashboardModel {
  now: Date;
  status: AirStatus;
  /** At least the last week of data/history.jsonl (the graph spans GRAPH_HOURS). */
  history: HistoryEntry[];
  weather: Weather | null;
  place: string;
  /** The panel's own last report (sent when it fetches the image); null until one arrives. */
  device?: { batteryPct: number; rssi: number } | null;
  /** The station map under the sky disc: stations with positions (mapStations) and its basemap (basemap.ts, null → pins on white). */
  map?: { stations: MapStation[]; features: MapFeature[] | null } | null;
}

export const W = 800, H = 480;
const B = "#000", Wt = "#fff";
const HOUR = 3_600_000;
const f1 = (n: number) => +n.toFixed(1);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
interface TextOpts { size: number; weight?: 400 | 700 | 900; anchor?: "start" | "middle" | "end"; fill?: string; cls?: string }
/** Text at (x, y). anchor is visual: "end" = right edge at x (how resvg anchors RTL runs). */
function t(x: number, y: number, s: string, o: TextOpts): string {
  const cls = o.cls ? ` class="${o.cls}"` : "";
  return `<text${cls} x="${x}" y="${y}" font-family="Heebo" font-size="${o.size}" font-weight="${o.weight ?? 400}" text-anchor="${o.anchor ?? "end"}" direction="rtl" fill="${o.fill ?? B}">${esc(s)}</text>`;
}

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TZ, ...opts }).format(d);
const hhmm = (d: Date) => fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false });
const dm = (d: Date) => fmt(d, { day: "numeric", month: "numeric" });
const WEEKDAY_HE: Record<string, string> = { Sun: "ראשון", Mon: "שני", Tue: "שלישי", Wed: "רביעי", Thu: "חמישי", Fri: "שישי", Sat: "שבת" };
const weekday = (d: Date) => WEEKDAY_HE[new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, weekday: "short" }).format(d)];
const WIND_HE = ["צפונית", "צפון-מזרחית", "מזרחית", "דרום-מזרחית", "דרומית", "דרום-מערבית", "מערבית", "צפון-מערבית"];
const windHe = (deg: number) => WIND_HE[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const ADVICE_HE: Record<AirStatus["windows"], string> = {
  open: "אפשר לפתוח חלונות", short: "אוורור קצר בלבד", closed: "עדיף לסגור חלונות", unknown: "אין נתונים עדכניים",
};
const CAUSE_HE: Record<string, string> = { PM10: "אבק", "PM2.5": "אבק", Benzene: "בנזן", NO2: "תחבורה (NO2)", SO2: "SO2" };

/** Wi-Fi bars for an RSSI in dBm: 4 at ≥ −55, one fewer per 10 dB, 0 below −85. */
const wifiBars = (rssi: number) => (rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : rssi >= -85 ? 1 : 0);

/** Battery outline filled to its level, then the percentage — "טען" in words when low. Returns [svg, width]. */
function battery(x: number, pct: number): [string, number] {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const low = p <= 15;
  const fill = Math.max(p > 0 ? 2 : 0, Math.round((p / 100) * 24));
  const body = `<g class="battery"><rect x="${x}" y="15" width="28" height="15" rx="3" fill="none" stroke="${Wt}" stroke-width="2"/>
    <rect x="${x + 28}" y="19" width="3" height="7" rx="1" fill="${Wt}"/>
    <rect x="${x + 2}" y="17" width="${fill}" height="11" rx="1.5" fill="${Wt}"/></g>`;
  const label = low ? `טען ${p}%` : `${p}%`;
  return [body + t(x + 37, 29, label, { size: 16, weight: low ? 900 : 700, fill: Wt, anchor: "start" }), 37 + label.length * 9];
}

function wifi(x: number, rssi: number): string {
  const on = wifiBars(rssi);
  return [0, 1, 2, 3].map((i) => {
    const h = 5 + i * 4;
    return `<rect class="bar${i < on ? " on" : ""}" x="${x + i * 6}" y="${30 - h}" width="4" height="${h}" rx="1" fill="${i < on ? Wt : B}" stroke="${Wt}" stroke-width="1.2"/>`;
  }).join("");
}

function header(m: DashboardModel): string {
  const out = [`<rect x="0" y="0" width="${W}" height="44" fill="${B}"/>`, t(784, 30, m.place, { size: 21, weight: 700, fill: Wt })];
  // Left to right: Wi-Fi, battery, day/date/time — then sunrise/sunset in the middle.
  let x = 14;
  if (m.device) {
    out.push(wifi(x, m.device.rssi));
    x += 32;
    const [bat, w] = battery(x, m.device.batteryPct);
    out.push(bat);
    x += w + 10;
  }
  out.push(t(x, 30, `${weekday(m.now)} ${dm(m.now)} · ${hhmm(m.now)}`, { size: 20, weight: 700, fill: Wt, anchor: "start" }));
  if (m.weather) {
    out.push(icon("sunrise", 380, 9, 26, { stroke: 2.2, color: Wt }), t(410, 30, hhmm(m.weather.today.sunrise), { size: 17, fill: Wt, anchor: "start" }));
    out.push(icon("sunset", 470, 9, 26, { stroke: 2.2, color: Wt }), t(500, 30, hhmm(m.weather.today.sunset), { size: 17, fill: Wt, anchor: "start" }));
  }
  return out.join("\n");
}

function airPanel(s: AirStatus): string {
  const R = 788, out: string[] = [];
  const open = s.windows === "open" || s.windows === "short";
  out.push(windowIcon(open, R - 80, 58, 80));
  out.push(t(R - 94, 96, ADVICE_HE[s.windows], { size: 31, weight: 900 }));
  if (s.score !== null) out.push(t(R - 94, 128, `${s.nameHe} · ציון ${s.score}`, { size: 21, weight: 700 }));
  if (s.lead) {
    const cause = CAUSE_HE[s.lead.pollutant] ?? s.lead.pollutant;
    const why = s.lead.origin === "upwind" && s.upwind ? `${cause} מ${s.upwind.nameHe} · בעוד כ-${s.upwind.etaMin} דק'` : `${cause} באזור`;
    out.push(t(R - 94, 156, why, { size: 19 }));
  }
  // Level meter: six segments, filled from the right up to the confirmed level.
  const segW = 56, gap = 6, y0 = 172;
  for (let i = 0; i < 6; i++) {
    const on = s.level !== null && i <= s.level;
    const x = R - (i + 1) * segW - i * gap;
    out.push(`<rect class="seg${on ? " on" : ""}" x="${x}" y="${y0}" width="${segW}" height="16" rx="3" fill="${on ? B : Wt}" stroke="${B}" stroke-width="2"/>`);
  }
  out.push(t(R, y0 + 34, LEVELS[0].nameHe, { size: 14 }), t(R - 6 * segW - 5 * gap, y0 + 34, LEVELS[5].nameHe, { size: 14, anchor: "start" }));
  // A tile per pollutant — every scored one plus ozone (shown, never scored), 3 × 2, right to left.
  // The one that sets the level is drawn inverted, so whichever it is, it stands out.
  const tiles: [string, string][] = [["Benzene", "בנזן"], ["PM10", "PM10"], ["PM2.5", "PM2.5"], ["NO2", "NO2"], ["SO2", "SO2"], ["O3", "אוזון"]];
  const tw = 120, th = 41, tg = 8, rg = 6, ty = 215;
  tiles.forEach(([key, label], i) => {
    const x = R - ((i % 3) + 1) * tw - (i % 3) * tg, y = ty + Math.floor(i / 3) * (th + rg);
    const lead = s.lead?.pollutant === key;
    const p = s.pollutants?.[key];
    const ink = lead ? Wt : B;
    out.push(`<g class="tile${lead ? " lead" : ""}"><rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="7" fill="${lead ? B : Wt}" stroke="${B}" stroke-width="2"/>`);
    out.push(t(x + tw - 8, y + 18, label, { size: 15, weight: 700, fill: ink }));
    out.push(t(x + tw - 8, y + 34, p?.pct != null ? `${p.pct}% מהסף` : "µg/m³", { size: 12, fill: ink }));
    out.push(t(x + 8, y + 30, p ? String(p.ugm3) : "—", { size: 25, weight: 900, anchor: "start", fill: ink }) + "</g>");
  });
  return out.join("\n");
}

function weatherPanel(m: DashboardModel): string {
  const R = 396, out: string[] = [];
  const w = m.weather;
  if (!w) return t(R, 120, "אין נתוני מזג אוויר", { size: 22, weight: 700 });
  const now = wmo(w.now.code, w.now.isDay);
  out.push(icon(now.icon, R - 84, 54, 84, { stroke: 3.2 }));
  out.push(t(R - 98, 128, `${Math.round(w.now.temp)}°`, { size: 76, weight: 900 }));
  out.push(t(R, 168, `${now.he} · ${Math.round(w.today.max)}°/${Math.round(w.today.min)}°`, { size: 21, weight: 700 }));
  out.push(t(R, 194, `מרגיש ${Math.round(w.now.feels)}° · לחות ${Math.round(w.now.humidity)}%`, { size: 17 }));
  // Wind: prefer the station's measured wind (what the air estimate used).
  const fromDeg = m.status.wind?.fromDeg ?? w.now.windFromDeg;
  const ms = m.status.wind?.speedMs ?? w.now.windMs;
  out.push(icon("navigation-2", R - 22, 203, 22, { stroke: 2.2, rotate: (fromDeg + 180) % 360 }));
  out.push(t(R - 30, 220, `רוח ${windHe(fromDeg)} · ${ms.toFixed(1)} מ/ש`, { size: 17 }));
  // Next six slots, every two hours, soonest on the right.
  const next = w.hourly.filter((h) => h.t.getTime() > m.now.getTime()).filter((_, i) => i % 2 === 0).slice(0, 6);
  const sw = 64;
  next.forEach((h, i) => {
    const cx = R - sw / 2 - i * sw;
    const c = wmo(h.code, h.isDay);
    out.push(`<g class="hour">${t(cx, 248, hhmm(h.t), { size: 14, weight: 700, anchor: "middle" })}`);
    out.push(icon(c.icon, cx - 14, 254, 28, { stroke: 2.2 }));
    const rain = h.rainPct >= 30 ? ` ${Math.round(h.rainPct)}%` : "";
    out.push(t(cx, 300, `${Math.round(h.temp)}°${rain}`, { size: 15, weight: 700, anchor: "middle" }) + "</g>");
  });
  return out.join("\n");
}

/** Graph zones: levels 0–1 share "טוב" (both mean windows open); the top zone is capped at 400. */
const ZONES = [
  { from: 0, to: 66, he: "טוב" },
  { from: 66, to: 100, he: "סביר" },
  { from: 100, to: 150, he: "גבוה" },
  { from: 150, to: 300, he: "גבוה מאוד" },
  { from: 300, to: 400, he: "מסוכן" },
];

/** The graph covers the last week, one point per hour (its peak). */
export const GRAPH_HOURS = 7 * 24;

function graph(m: DashboardModel): string {
  const x0 = 76, x1 = 786, y0 = 344, y1 = 452, out: string[] = [];
  out.push(t(788, 332, "זיהום בשבוע האחרון", { size: 17, weight: 700 }));
  out.push(t(12, 332, "מקור: המשרד להגנת הסביבה · Open-Meteo", { size: 12, anchor: "start" }));
  const from = new Date(m.now.getTime() - GRAPH_HOURS * HOUR);
  const peaks = hourlyPeaks(m.history, from, m.now);
  const X = (hours: number) => +(x0 + (hours / GRAPH_HOURS) * (x1 - x0)).toFixed(1);
  // Equal-height zones, one per level: height shows WHICH level it was (a
  // linear axis squeezed 66–150 into a few pixels whenever dust spiked);
  // within a zone the value is linear, and the exact number is on the "now" chip.
  const Y = (v: number) => {
    const z = ZONES.findIndex((zn) => v < zn.to);
    const i = z === -1 ? ZONES.length - 1 : z;
    const zn = ZONES[i];
    const frac = Math.min(1, (Math.max(v, zn.from) - zn.from) / (zn.to - zn.from));
    return +(y1 - ((i + frac) / ZONES.length) * (y1 - y0)).toFixed(1);
  };
  out.push(`<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${B}" stroke-width="2.5"/></pattern>`,
    `<clipPath id="above100"><rect x="${x0}" y="${y0 - 10}" width="${x1 - x0}" height="${Y(100) - y0 + 10}"/></clipPath></defs>`);
  // Dashed dividers between zones; each zone's name in a gutter left of the plot, so no label ever covers the line.
  ZONES.forEach((zn, i) => {
    if (i > 0) out.push(`<line class="zone" x1="${x0}" y1="${Y(zn.from)}" x2="${x1}" y2="${Y(zn.from)}" stroke="${B}" stroke-width="1.2" stroke-dasharray="5 5"/>`);
    const mid = (Y(zn.from) + Y(Math.min(zn.to, 400))) / 2;
    out.push(t(x0 - 6, mid + 4, zn.he, { size: 12, weight: 700, anchor: "end", cls: "zone-label" }));
  });
  out.push(`<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" stroke="${B}" stroke-width="2"/>`);
  // Days along the bottom: a faint divider at each Israeli midnight, and each day's name centred on the
  // part of it the graph shows (the oldest and today are partial; today is "היום"). Too narrow → no name.
  const at = (ms: number) => X((ms - from.getTime()) / HOUR);
  const cuts = [from.getTime()];
  for (let h = 1; h <= GRAPH_HOURS; h++) {
    const exact = Math.floor((from.getTime() + h * HOUR) / HOUR) * HOUR;
    if (exact < m.now.getTime() && hourIn(new Date(exact)) === 0) cuts.push(exact);
  }
  cuts.push(m.now.getTime());
  for (const c of cuts.slice(1, -1)) out.push(`<line class="day" x1="${at(c)}" y1="${y0}" x2="${at(c)}" y2="${y1 + 5}" stroke="${B}" stroke-width="0.8" stroke-dasharray="1 3"/>`);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = at(cuts[i]), b = at(cuts[i + 1]);
    if (b - a < 34) continue;
    const name = i === cuts.length - 2 ? "היום" : weekday(new Date((cuts[i] + cuts[i + 1]) / 2));
    out.push(t((a + b) / 2, y1 + 21, name, { size: 13, weight: 700, anchor: "middle", cls: "day-name" }));
  }
  // The line (broken over gaps), and hatching wherever it was orange or worse.
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  peaks.forEach((p, i) => {
    if (p.peak === null) { if (cur.length) runs.push(cur); cur = []; return; }
    cur.push({ x: X(i + 0.5), y: Y(p.peak) });
  });
  if (cur.length) runs.push(cur);
  // End the line at "now" with the current score, so the labelled dot matches the panel above.
  const lastPeak = peaks.findLastIndex((p) => p.peak !== null);
  const nowScore = m.status.score;
  if (nowScore !== null && lastPeak >= peaks.length - 2 && runs.length) runs.at(-1)!.push({ x: X(GRAPH_HOURS), y: Y(nowScore) });
  for (const r of runs) {
    const pts = r.map((p) => `${p.x},${p.y}`).join(" ");
    out.push(`<polygon points="${r[0].x},${y1} ${pts} ${r[r.length - 1].x},${y1}" fill="url(#hatch)" clip-path="url(#above100)"/>`);
    out.push(`<polyline points="${pts}" fill="none" stroke="${B}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  const last = runs.at(-1)?.at(-1);
  if (last) {
    out.push(`<circle class="now" cx="${last.x}" cy="${last.y}" r="6" fill="${B}" stroke="${Wt}" stroke-width="2"/>`);
    const v = nowScore ?? peaks[lastPeak].peak!;
    const ly = Math.max(y0 + 2, last.y - 30);
    out.push(`<rect x="${last.x - 44}" y="${ly}" width="36" height="19" rx="4" fill="${B}"/>`, t(last.x - 26, ly + 15, String(v), { size: 14, weight: 900, anchor: "middle", fill: Wt }));
  }
  return out.join("\n");
}

/** Where the day/night disc sits: the top-left corner, beside the temperature. */
const DISC_AT = { x: 12, y: 50 };
/** The station map: under the disc, down to the forecast row. */
export const MAP_AT = { x: 12, y: 144 }, MAP_W = 182, MAP_H = 88;

/** The stations the map shows — the local ones and each source's — with today's positions (mobile stations move). */
export function mapStations(meta: StationMeta[]): MapStation[] {
  const groups: [number, string][] = [...LOCAL_STATION_IDS.map((id): [number, string] => [id, "local"]), ...SOURCES.flatMap((s) => s.stationIds.map((id): [number, string] => [id, s.key]))];
  return groups.flatMap(([id, group]) => { const s = meta.find((x) => x.id === id); return s ? [{ id, group, lat: s.lat, lon: s.lon }] : []; });
}

/** The frame the map will use for these stations, for fetching its basemap. */
export const mapBounds = (stations: MapStation[]) => fitFrame([HOME, ...stations], MAP_W, MAP_H).bounds;

/** The SVG, plus the circles holding photos (for eink.ts to dither rather than snap). */
export function renderDashboard(m: DashboardModel, bits: Bits = 1): { svg: string; dither: Circle[] } {
  const disc = renderSkyDisc(m.now, HOME.lat, HOME.lon);
  const map = m.map?.stations.length ? renderStationMap({
    home: HOME, stations: m.map.stations, sources: SOURCES, localRadiusKm: LOCAL_RADIUS_KM,
    windFromDeg: m.status.wind?.fromDeg ?? m.weather?.now.windFromDeg ?? null, upwind: m.status.upwind?.source ?? null,
  }, m.map.features, MAP_W, MAP_H, bits) : "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${Wt}"/>`,
    header(m),
    airPanel(m.status),
    `<line x1="404" y1="58" x2="404" y2="300" stroke="${B}" stroke-width="2"/>`,
    weatherPanel(m),
    `<g transform="translate(${DISC_AT.x} ${DISC_AT.y})">${disc.svg}</g>`,
    map && `<g transform="translate(${MAP_AT.x} ${MAP_AT.y})">${map}</g>`,
    `<line x1="12" y1="310" x2="788" y2="310" stroke="${B}" stroke-width="2"/>`,
    graph(m),
    "</svg>",
  ].join("\n");
  const dither = disc.dither ? [{ cx: disc.dither.cx + DISC_AT.x, cy: disc.dither.cy + DISC_AT.y, r: disc.dither.r }] : [];
  return { svg, dither };
}

export const renderDashboardSvg = (m: DashboardModel): string => renderDashboard(m).svg;

/** The panel's PNG: 1-bit, or 2-bit (4 greys) for firmware that supports it. */
export function renderDashboardPng(m: DashboardModel, bits: Bits = 1): Uint8Array {
  const { svg, dither } = renderDashboard(m, bits);
  return svgToEinkPng(svg, bits, dither);
}
