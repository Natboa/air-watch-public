#!/usr/bin/env bun
/** Find candidates using private .env coordinates; does not choose or save station IDs. */
import { readHome } from "../src/settings";
import { nearestStations } from "../src/discovery";
import { apiDay, SvivaClient } from "../src/sviva";

const home = readHome(process.env);
const now = new Date();
const client = new SvivaClient();
await client.auth();
const candidates = nearestStations(home, await client.stations());
const readings = await Promise.allSettled(candidates.map(({ station }) => client.samples(
  station.id, apiDay(new Date(now.getTime() - 70 * 60_000)), apiDay(now),
)));
const rows = candidates.map(({ station, distanceKm }, i) => {
  const result = readings[i];
  const samples = result.status === "fulfilled" ? result.value.filter((s) => s.t <= now) : [];
  const newest = samples.length ? Math.max(...samples.map((s) => s.t.getTime())) : null;
  const recent = newest === null ? [] : samples.filter((s) => s.t.getTime() > newest - 60 * 60_000);
  const channels: Record<string, number> = {};
  for (const sample of recent) for (const channel of Object.keys(sample.values)) channels[channel] = (channels[channel] ?? 0) + 1;
  return {
    id: station.id, name: station.name, distanceKm: +distanceKm.toFixed(2), mobile: station.mobile,
    newestAgeMin: newest === null ? null : Math.round((now.getTime() - newest) / 60_000),
    samplesPerChannel: channels,
    fetch: result.status === "fulfilled" ? (samples.length ? "ok" : "no samples") : "failed",
  };
});
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.table(rows.map((r) => ({
    ID: r.id, Station: r.name, "km": r.distanceKm, Mobile: r.mobile,
    "Newest (min)": r.newestAgeMin ?? "—",
    "Samples per channel": Object.entries(r.samplesPerChannel).map(([key, count]) => `${key}:${count}`).join(", ") || r.fetch,
  })));
  console.log("Candidates only: select local stations within AIR_LOCAL_RADIUS_KM. Check at least 6 samples per pollutant and newest age <= 45 min. Wind needs both WD and WS. Keep this output private; distances can reveal your location.");
}
