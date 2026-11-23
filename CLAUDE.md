# CLAUDE.md

Static NBA live dashboard served by GitHub Pages at nsanders.me (`CNAME`). Everything ships in **one file, `index.html`**: vanilla JS/CSS, no build step, no runtime dependencies, no images (favicon is an inline SVG data URI). Keep it that way unless the owner agrees otherwise. `package.json`/`node_modules` exist only for tests.

## Layout
- `index.html` – the whole app. Script sections: fetching → box score parsing + advanced stats (`buildBox`, Basketball-Reference formulas) → scoreboard → game view → plays → box rendering → top performers → views/routing.
- `test/app.test.js` – `node:test` suite; `test/harness.js` boots `index.html` in jsdom with `fetch` stubbed to serve `test/fixtures/*.json` (routes keyed `scoreboard[:YYYYMMDD]` / `summary:<id>`). Page-scope functions are reachable via `app.eval('name')`.
- `test/fixtures/` – trimmed real API responses captured 2026-11-22 (one final, four live, one pre-game; `summary-401910030-next` is a later snapshot of the same live game for append-only tests).
- `test/make-fixtures.mjs` – trims raw responses to the fields the app reads: `node test/make-fixtures.mjs summary-<id>=raw.json scoreboard=raw-sb.json`.

Run tests: `npm test`.

## Hard constraints
- Low data: play-by-play polled every 10 s only while the selected game is live; scoreboard (all other games, one request) every 60 s if any game is live; leaders every 60 s only while that view is open; all polling paused while the tab is hidden; final games are cached in localStorage (`nbapbp.box.<id>`) and never refetched.
- Client-side only, static files only.
- Build DOM with `textContent`/`createElement`; never `innerHTML` with API data (a test greps for it).
- Dense and readable at 360 px and desktop (≥1000 px shows plays and box side by side); light/dark via `prefers-color-scheme`.

## API gotchas (verified against live responses)
- `fetch(url)` must stay a CORS "simple" request: **no options, no custom headers**. `cache:'no-cache'` adds a `Cache-Control` request header → preflight → the API returns 403 to `OPTIONS` and the page gets no data. A test enforces this.
- Responses carry `Cache-Control: max-age≈10` and **no ETag/Last-Modified**, so conditional requests/304s are impossible.
- The API's edge returns 403 to the `HeadlessChrome` user agent. Browser tests must answer API calls from fixtures (Playwright `context.route`), not hit the network.
- Summary header teams have `name` ("Heat") but no `shortDisplayName`; scoreboard teams have both.
- Player `MIN` is whole minutes, so team sums drift (241 instead of 240). Finals use the exact game length (48 + 5 per OT, from `linescores.length`) for pace and per-minute rates.
- Team-only turnovers (shot clock etc.) are only in `boxscore.teams[].statistics` (`teamTurnovers`/`totalTurnovers`); they're added into possessions, team TOV% and the USG% denominator.
- Box score stats are mapped by label (`MIN, PTS, FG, 3PT, FT, REB, AST, TO, STL, BLK, OREB, DREB, PF, +/-`) with `keys` as a fallback, because column order has changed before.
- Pre-game scoreboard scores are `'0'`; the UI hides scores by `state === 'pre'`.

## Box score column widths
`COLS[].w` (em) are fixed so both team tables align and scroll together. They were sized from the widest header/value measured in Chromium across real games; re-measure if you add columns or change the font.
