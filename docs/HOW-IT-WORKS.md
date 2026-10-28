# How Air Watch works

Air Watch estimates conditions at the target configured in private environment variables. It does not measure air at the target itself. See [README](../README.md) for setup and [agent setup](AGENT-SETUP.md) for assisted station selection.

## Data and commands

Run commands from the repository root so Bun can load the right `.env`:

```sh
bun run air-check.ts --status
bun run air-check.ts --alerts 5
bun run air-check.ts --stations
bun run stations --json
```

MoEP provides station metadata and five-minute samples through its public guest API. Readings can arrive late. Open-Meteo supplies forecast wind and dashboard weather; Overpass supplies the optional cached basemap. No personal API key is used by the current clients.

## Estimate

1. The private target and selected local station IDs come from `.env`. For each pollutant, use the hour ending at each station's newest valid sample. Require at least six samples and a newest sample no older than 45 minutes. Exclude local stations outside `AIR_LOCAL_RADIUS_KM`. Combine the remaining means using inverse distance squared, with a 0.2 km distance floor.
2. Try wind stations in configured order. Use the vector mean of paired WD/WS samples, otherwise the nearest forecast hour within 90 minutes. Below 1 m/s, skip upwind attribution because direction is unreliable.
3. For each configured industrial source group, derive its bearing and distance from the target to its station positions. If the wind is within 35 degrees, treat the maximum measured source concentration times the configured dilution as incoming. Empty groups disable those warnings.
4. The score is the worst local or incoming pollutant as a percentage of the project reference concentration. Current references (micrograms per cubic metre): PM2.5 25, PM10 50, NO2 50, SO2 125, Benzene 3.9. These comparisons use one-hour means and are not the official MoEP air-quality index. Ozone is information only.
5. The six score bands start at 0, 33, 66, 100, 150 and 300. Below 66 suggests open windows, 66 to below 100 suggests brief ventilation, and 100 or more suggests closed windows. No fresh local data remains unknown.

The industrial dilution is 0.08, calibrated against a regional backtest; it is not a general dispersion model. Changing location requires reviewing the source relevance and calibration, not just the coordinates. The local station lists and optional wind/source lists are all deployment settings.

## Alerts and history

A rising level needs two consecutive runs; a falling level needs three. Unknown needs four runs. Hysteresis is 15 percent below the held level's threshold. During 23:00-07:00 Israel time, only the top two levels notify immediately. Changes between the bottom three levels do not notify; a later run can deliver a held daytime change.

`air-check.ts` writes current status, alert state, per-run history and alert records under `AIR_DIR` or `data/`. It prints text for another process to deliver; it does not send messages itself. Mobile station movement over 500 metres can produce a separate notice, and stations outside the local radius stop contributing.

`air-weekly.ts` summarizes the previous seven days, renders a chart and prints a Hebrew caption. It skips weeks with fewer than 72 covered hours. Without explicit historical input it also prunes stored history to 60 days. Scheduling and external delivery are separate deployment tasks.

## Display and limitations

The 800x480 dashboard is a 1-bit PNG, optionally 2-bit for compatible firmware. It combines air advice, pollutant tiles, weather, a day/night disc, an optional station map and seven days of history. Missing history gives an empty graph; unavailable weather or map data degrades gracefully. It contains no built-in device server or hardware transport.

Nearby monitoring stations can miss a local plume. Calm conditions, stale channels, mobile stations and silent source sensors all affect coverage. Inspect actual station readings when explaining an estimate. Do not describe a missing value as zero pollution or a confirmed safe condition.

Never publish live target maps or private runtime files; use synthetic coordinates and sample data for demonstrations.
