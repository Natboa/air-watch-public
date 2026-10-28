#!/usr/bin/env bun
/**
 * Renders the e-ink dashboard to a PNG from real inputs, for previews.
 *   bun run scripts/dashboard-demo.ts [--status data/air-status.json] [--history data/history.jsonl] [--out dashboard.png]
 *                                     [--device 87,-61] [--bits 1|2] [--at 2026-10-16T15:35:00+03:00]
 * --device fakes the panel's battery % and Wi-Fi RSSI until real hardware reports them.
 * --bits 2 writes the 4-grey version (TRMNL firmware ≥ 1.6); default 1-bit.
 * --at renders another moment (the disc and the moon follow it; weather stays live).
 * Weather is fetched live from Open-Meteo, station positions from the MoEP API, the basemap from
 * OpenStreetMap once (cached in data/map).
 */
import { readFileSync, writeFileSync } from "fs";
import { mapBounds, mapStations, renderDashboard, renderDashboardPng } from "../src/dashboard";
import { SvivaClient } from "../src/sviva";
import { loadBasemap } from "../src/basemap";
import { fetchWeather } from "../src/weather";
import { parseHistory } from "../src/history";
import { HOME, PLACE } from "../src/config";
import type { AirStatus } from "../src/format";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const dir = `${import.meta.dir}/../data`;
const status = JSON.parse(readFileSync(arg("status", `${dir}/air-status.json`), "utf8")) as AirStatus;
const historyFile = Bun.file(arg("history", `${dir}/history.jsonl`));
const history = parseHistory(await historyFile.exists() ? await historyFile.text() : "");
const now = new Date(arg("at", new Date().toISOString()));
let weather = null;
try { weather = await fetchWeather(HOME.lat, HOME.lon); } catch (e) { console.error(`[demo] weather failed: ${e}`); }

let map = null;
try {
  const sviva = new SvivaClient();
  await sviva.auth();
  const stations = mapStations(await sviva.stations());
  map = { stations, features: await loadBasemap(mapBounds(stations), `${dir}/map`) };
  if (!map.features) console.error("[demo] no basemap (Overpass busy?); pins on white");
} catch (e) { console.error(`[demo] no station map: ${e}`); }

const dev = arg("device", "");
const device = dev ? { batteryPct: Number(dev.split(",")[0]), rssi: Number(dev.split(",")[1]) } : null;
const bits = arg("bits", "1") === "2" ? 2 : 1;
const model = { now, status, history, weather, place: PLACE, device, map };
const out = arg("out", `${dir}/dashboard.png`);
writeFileSync(out, renderDashboardPng(model, bits));
writeFileSync(out.replace(/\.png$/, ".svg"), renderDashboard(model, bits).svg);
console.log(`wrote ${out} (${bits}-bit)`);
