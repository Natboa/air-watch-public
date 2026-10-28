# Agent-assisted location and station setup

Use this guide when a user asks an agent to configure Air Watch for their address. Read the README and existing `.env.example` first. Do not publish the user's configuration or change repository visibility as part of setup.

## 1. Resolve the target

- Prefer user-provided coordinates or an exact map pin. If the user supplies an address, resolve it with an appropriate map/geocoding tool; explain that the address is being sent to that service. Verify country, city and street/building match. Ask the user to resolve ambiguity rather than guessing between several matches.
- Save only decimal latitude/longitude as `AIR_HOME_LAT` and `AIR_HOME_LON` in the ignored `.env`. Do not put the address in tracked files, commit messages, reports or screenshots. Use a city or generic label for `AIR_PLACE`.
- This implementation uses Israeli monitoring data and Israeli time. Do not claim global support or fabricate nearby stations when the user is outside the network's coverage.
- Preserve an existing `.env`; change only settings the user has asked to change. Never overwrite it by blindly copying the example.

## 2. Discover the closest sampling points

From the repository root, with coordinates already saved:

```sh
bun run stations --json
```

This works before `AIR_LOCAL_STATION_IDS` is filled. It uses the official MoEP guest API to rank active station metadata by great-circle distance and inspect recent readings for the 12 nearest candidates. The station catalog, not an old README list, is authoritative for current mobile-station positions.

Treat the output as private because relative distances can identify the target. Do not paste it into public issues, logs or documentation. If requests fail, report what could not be verified; do not invent readings or set the state to good.

## 3. Select by purpose, distance, freshness and coverage

1. **Local pollutants:** choose representative nearby stations within the configured radius, normally 3 km. Check which of PM10, PM2.5, NO2, SO2 and Benzene they actually measure. O3 is displayed as information but does not set the score. An active flag alone does not mean useful samples exist.
2. **Freshness:** the newest sample for a pollutant must be at most 45 minutes old, with at least six valid readings in the hour ending at that pollutant's newest sample. The discovery helper's channel counts are candidate diagnostics, not a substitute for the engine's per-channel freshness check. Use `air-check.ts --stations` after selecting IDs to verify actual means/ages.
3. **Wind:** use stations with jointly valid WD and WS readings. Put the best representative one first in `AIR_WIND_STATION_IDS`; empty means forecast fallback. The closest station is not automatically the best wind station.
4. **Industrial sources:** only configure `AIR_BAZAN_STATION_IDS` or `AIR_TASHAN_STATION_IDS` for the corresponding Haifa Bay source. These are source sentinel/fence groups, not home-local stations. Identify them from current official station metadata and site context. Leave them empty elsewhere. A different source requires a named source definition and calibration in the code, not relabeling an existing group.
5. **Coverage gaps:** if no suitable station is within the radius, tell the user coverage is inadequate. Do not silently expand the radius, use a distant fence station as local air, or invent a sensor at the address.

Save all four station lists in `.env`. IDs are positive integers separated by commas. Empty optional lists are valid; the local list is required for normal checks. Explain the selected stations to the user privately, including gaps and mobile stations.

## 4. Verify the setup

```sh
bun test
bun run check
bun run air-check.ts --stations
```

Confirm that invalid configuration fails before network calls, suitable samples are available, and an unavailable reading produces unknown. `bun run check` does not save status/history. A real `bun run air-check.ts` is needed before rendering a live dashboard; explain that it creates private state and history.

Do not install a scheduler, connect Telegram, deploy firmware or publish anything unless that work is included in the user's request. If scheduling is requested, follow the README's working-directory and absolute Bun-path guidance.

## 5. Check privacy before a handoff or publication

Verify `.env` is ignored with `git check-ignore .env`, inspect the Git diff and staged filenames, and exclude runtime data, diagnostics, raw address text and real home maps. `.env.test` is a synthetic test fixture, not a user's configuration. Do not use old private Git history in a new public export.
