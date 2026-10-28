# Private location configuration and portfolio preparation

Implement directly in this checkout; no subagents. Do not publish until the user has reviewed the screen. Do not expose the existing Git history.

Goal: let each deployment supply its coordinates through an ignored `.env`, provide a safe example, and prepare a clean public snapshot and local portfolio preview.

Architecture: `src/settings.ts` validates environment input, and `src/config.ts` exports the selected location and station settings to existing consumers. Bun loads `.env`; `.env.test` uses a synthetic location. Exact personal coordinates stay in ignored local files. Address geocoding is outside this change.

## Tasks

- [x] Audit tracked files and reachable Git history; identify private coordinates, street addresses, deployment paths and commit email.
- [x] Generate a compact wall-mounted ivory e-ink mockup beside a window; populate its graph from a week of real public station samples at a synthetic target. Awaiting final user review.
- [x] Add failing settings tests for missing/invalid coordinates, zero coordinates, station lists, display name, radius and every source station list.
- [x] Implement settings, example/test env files and dashboard integration; preserve current deployment in ignored `.env`.
- [x] Replace private details in current documentation and test fixtures; preserve original notes in ignored `data/private-docs`.
- [x] Run settings tests and full suite, plus clean configuration smoke checks.
- [x] Build and scan a history-free public snapshot; leave existing remote private.
- [x] Prepare and inspect the local portfolio addition in the existing visual style.
- [ ] Show previews and publication choices; wait for the user's approval.

Review focus: missing coordinates must fail before network calls; blank/NaN/out-of-range values must not silently become zero; tests must not depend on a user's home; other locations must choose their monitoring stations; no ignored data or history may enter the public snapshot.

Station discovery: `bun run stations --json` verified live at the synthetic test target: 12 candidates, 8 with readings. Full suite: 127 tests passed. Portfolio draft: tested light/dark at 390/768/1440 with no overflow. No code, visibility or portfolio publication has occurred.
