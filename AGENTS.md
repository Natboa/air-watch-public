# Air Watch contributor instructions

Read `README.md` before changing configuration. When configuring this project for a user's address or finding nearby sampling stations, follow `docs/AGENT-SETUP.md`.

- Keep the target coordinates and all deployment station selections in ignored `.env` files. Never hardcode a residential address or coordinates in source, fixtures, documentation or screenshots.
- Use `.env.test`'s synthetic location for tests. Do not copy a developer's `.env` into public examples or test data.
- A station's active flag does not establish fresh pollutant coverage. Check per-channel samples and distinguish local, wind and source station groups.
- No station coverage means unknown air quality. Do not expand the radius or repurpose industrial source stations without the user's knowledge.
- `bun test` runs the suite. `bun run check` is a live dry run and needs API access; it does not write runtime data.
- Publishing or changing visibility requires a separate privacy review of files and history. Preserve existing private configuration and other people's uncommitted work.
