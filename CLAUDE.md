# CLAUDE.md

Static NBA live dashboard served by GitHub Pages at https://nsanders.me/nba-gameday (a project site under the owner's user-site domain, so all paths must stay relative). There is deliberately no `CNAME` file: the custom domain belongs to the owner's user-site repo. Everything ships in **one file, `index.html`**: vanilla JS/CSS, no build step, no runtime dependencies, no images (favicon is an inline SVG data URI). Keep it that way unless the owner agrees otherwise. `package.json`/`node_modules` exist only for tests.

## Layout
- `index.html` – the whole app. Script sections: fetching (+ byte counting) → box score parsing + advanced stats (`buildBox`, Basketball-Reference formulas) → scoreboard → game view / live loop (`loadPBP`, `tickFull`, `tickLite`, `nextDelay`) → plays → box rendering → top performers → settings + data usage → views/routing.
- `test/app.test.js` – `node:test` suite; `test/harness.js` boots `index.html` in jsdom with `fetch` stubbed to serve `test/fixtures/*.json`. Route keys: `scoreboard[:YYYYMMDD]`, `summary:<id>`, `core:plays:<id>` (a full play list, paged by the harness like the real API), `core:status:<id>`. `app.delays` records every `setTimeout` (function name + ms) for polling tests. Page-scope functions/variables are reachable via `app.eval('name')`.
- `test/fixtures/` – trimmed real responses captured 2026-11-22/23: one final, four live, one pre-game, `summary-401910030-next` (later snapshot of the same game), `summary-401910033-endq` (end of 1st quarter), and for `401910032` a summary plus core plays/status captured ~4 min later (9 new plays and one real correction to an existing play).
- `test/make-fixtures.mjs` – trims raw responses (shape auto-detected): `node test/make-fixtures.mjs summary-<id>=raw.json core-plays-<id>=raw-core.json …`.

Run tests: `npm test`.

## Hard constraints
- Low data. Defaults (user-adjustable in the ⚙ panel, saved in `nbapbp.settings`): watched live game every 10 s; its box score at most every 60 s; scoreboard (all other games, one request) every 60 s while any game is live; home and Top performers (per-game box data for every live game) every 5 min while open. Followed teams (`settings.follow`, ESPN abbreviations from `TEAMS`, default LAL/SA/PHI; the Spurs are `SA`) put their games first via `orderedGames()` and tint their players' leaderboard rows (`li.fol`). Settings are stored as differences from `DEFAULTS` (`v: 2`), so changing a default reaches users who didn't pick that value. All polling pauses while the tab is hidden. Final games are cached in localStorage (`nbapbp.box.<id>`) and never refetched.
- Client-side only, static files only.
- Build DOM with `textContent`/`createElement`; never `innerHTML` with API data (a test greps for it).
- Dense and readable at 360 px and desktop (≥1000 px shows plays and box side by side); light/dark via `prefers-color-scheme`.

## Views and routing
- Three views: `home` (default, empty hash), `game`, `leaders` (`#v=leaders`); plus `#d=YYYYMMDD` and `#t=box`. The game view has two modes (`#gameView[data-mode]`, set by `syncMode()`): `#v=game` is a grid of game cards, `#g=<id>` is one game. The "Games" button always goes to the grid; no game is ever auto-picked. The header strip of games shows only inside a game. `applyHash()` applies the URL on load and on `popstate`.
- User navigations call `pushNav()` (pushState of the current URL) and then mutate state; every state change rewrites the current entry with `writeHash()` (replaceState). This is what makes browser Back/Forward work. View state (play filter/quarter/order/box sort on a game; team/search/all/sort in Season) is in the URL too: `writeViewState()` adds it to every `writeHash()` (only non-default values), `readViewState()` applies it in `applyHash()`; the URL is the source of truth, so anything it omits resets to the default. A team play filter from the URL (`pf=MIA`) stays pending in `state.filterAbbr` until the game's teams load.
- "Listing" pages (`listing()`: home, the games grid, Top performers) share `loadLeaders()` (summaries for every started game, finals cached, interval `settings.leaders`) and `renderListing()`. Game cards (`gameCard()`) render immediately from the scoreboard (line scores, records, each team's PTS/REB/AST leader) and switch to the top three players by Game Score once box data arrives.
- The date label (`#day`) is a button that opens the browser's native date picker (a hidden but rendered `<input type="date" id="dayPick">`, via `showPicker()`, falling back to focus). Picking ESPN's "today" (`state.todayDate`, remembered from the undated scoreboard) returns to the live default with no `d=` in the URL.
- Dated scoreboard responses have **no `day` field** and start times are UTC, so the displayed date comes from the requested date (`state.date`), never from event times. Getting this wrong made the previous-day button get stuck.
- CSS has a global `[hidden]{display:none!important}`: several elements have `display` rules that would otherwise override the attribute.
- Tests: `boot()` defaults to `#g=401910030` (a live game); pass `hash: ''` for home or `'#v=game'` for the games grid.

## Live loop
- First load and box refreshes use the full game summary (~35 KB gzip). Between them, the lightweight path fetches the core API's `…/competitions/<id>/status` (~0.3 KB) and `…/plays?limit=25&page=⌊have/25⌋+1` (~2 KB), merging plays by id (ids are identical in both APIs; the core API is often a play or two ahead). Score comes from the newest play.
- The box refreshes only when `settings.box` has elapsed **and** new plays arrived. More than one page behind, or the game just went final → one full refresh. Two lightweight failures in a row → full summaries for that game.
- `nextDelay()`: halftime 60 s, end of quarter 30 s (`STATUS_END_PERIOD`, verified), timeout with no change since → 30 s, any other unchanged poll → 20 s then 30 s; never faster than the user's interval. `STATUS_HALFTIME` (verified 2026-11-23); the detail text `/^half/i` is a fallback.
- Corrections happen: ESPN rewrites earlier plays (e.g. a miss becomes a block). `updatePlays` redraws and highlights new and changed plays.

## Season data (nightly build)
- `scripts/build-season.mjs` (Node 22, no dependencies) is the one exception to "no build step": the GitHub Action `.github/workflows/season-data.yml` runs it daily at 11:23 UTC (scheduled runs use the default branch's copy of the workflow), on manual dispatch, and on pushes that change the script or workflow on `claude/season-leaders-todo`. It commits `data/` only when games were added.
- Incremental: `data/season-games.json` is also the build state. Each run walks the scoreboard `calendar` days from `through` (last day whose regular-season games were all settled), adds `completed` regular-season games (`season.type === 2`) not yet stored, and stops at the first unsettled day.
- Files: `season-best.json` (union of the top 50 rows for every sortable metric, players/games re-indexed; ~25 KB gzip), `season-games.json` (every player-game and team-game row; loaded by the page only when best games are filtered), `season-players.json` (per-player season totals + summed Game Score; per-game leaders).
- Row layouts are `PCOLS`, `TCOLS`, `SCOLS` in the script; team rows carry the opponent's possession inputs so ratings need no second row. Metrics exist twice, `PMETRICS`/`TMETRICS` in the script and `SEASON_P`/`SEASON_T` in `index.html`; `test/season.test.js` checks they agree. Best-games tables sort only in each column's "best" direction (the only exact one for the top-50 union); per-game sorts both ways.
- The page fetches `data/*.json` with `cache: 'no-cache'` (GitHub Pages sends ETags, so revisits are 304s); ESPN calls stay `no-store`.
- Locally the script needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` in this sandbox (Node's fetch ignores HTTPS_PROXY otherwise).

## Data usage tracking
`getJSON(url, kind)` counts bytes from `Content-Length` (CORS-safelisted, and the compressed size for gzip responses) into `usage` (this visit) and `nbapbp.usage` (since a date), and keeps a running average per kind in `nbapbp.sizes`. `perMinute()` turns settings + sizes into the estimates in the panel.

## API gotchas (verified against live responses)
- `fetch(url, { cache: 'no-store' })`. Cache modes don't trigger a CORS preflight (verified in Chromium against a local server), but **custom request headers would**, and both ESPN hosts answer `OPTIONS` with 403. Responses have no ETag/Last-Modified (no 304s possible), and the core API sends `stale-while-revalidate=7200`, so the default cache mode can serve stale plays.
- Both hosts send `Access-Control-Allow-Origin: *` on GET.
- ESPN's edge returns 403 to the `HeadlessChrome` user agent (that, not a preflight, is why headless runs failed early on). Browser checks must answer API calls from fixtures (Playwright `context.route`); don't spoof the UA.
- Summary header teams have `name` ("Heat") but no `shortDisplayName`; scoreboard teams have both. Core-API plays give the team as a `$ref` URL (`…/teams/14?…`); `refId()` extracts the id.
- Player `MIN` is whole minutes, so team sums drift (241 instead of 240). Finals use the exact game length (48 + 5 per OT, from `linescores.length`) for pace and per-minute rates.
- Team-only turnovers (shot clock etc.) are only in `boxscore.teams[].statistics` (`teamTurnovers`/`totalTurnovers`); they're added into possessions, team TOV% and the USG% denominator.
- Box score stats are mapped by label (`MIN, PTS, FG, 3PT, FT, REB, AST, TO, STL, BLK, OREB, DREB, PF, +/-`) with `keys` as a fallback, because column order has changed before.
- Pre-game scoreboard scores are `'0'`; the UI hides scores by `state === 'pre'`.
- The scoreboard can be older than the watched game's last refresh; `loadScoreboard` keeps the watched game's fresher score on its tile.

## Box score column widths
`COLS[].w` (em) are fixed so both team tables align and scroll together. They were sized from the widest header/value measured in Chromium across real games; re-measure if you add columns or change the font.

## Box score sorting
Every column header (including Player, by last name) sorts both team tables together; click again to reverse. Column order starts Player, GS, GmSc. Default `state.sort` is `GS` (starter) descending with Game Score as the tie-breaker, i.e. starters first, each group by GmSc. Blank values (e.g. FG% with no attempts) always sort last. Made-attempted columns sort by makes, then attempts. The sort is not persisted: every visit starts from the default.
