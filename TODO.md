# TODO

## Season tab: daily changes to per-game averages (not started)

The Season tab exists (per-game leaders, best player games, best team games), built from the nightly data
files (`scripts/build-season.mjs`, `.github/workflows/season-data.yml`). Still to do: a column showing how much
the selected day's game moved each player's average (e.g. a 30-point night takes 25.0 PPG over 15 games to 25.3),
with live games shown as a projection ("if the game ended now").

### Use our own data, not ESPN's season stats

`data/season-games.json` holds every player-game row with its date. So:

- **Averages as of any day** are the rows up to that day: no dependence on when ESPN updates its season totals,
  and past dates work too (this was the infeasible part when relying on ESPN).
- **Change on day D** = average through D − average through the previous game day, per player.
- **Today's live games**: the nightly file covers games through `through` (the last fully settled day), so
  today's games are never in it; add today's box line (already loaded by the page) to get the projection.
- Cost: the full file (~100 KB gzip now, ~380 KB by April), already cached by the browser once someone filters
  best games. Only the Per game section with a non-today date, or the delta column, would need it.

### Background: ESPN's own season stats lag (measured 2026-11-22/23)

Kept for reference in case we ever use ESPN's season totals directly.

| What | Endpoint | Notes |
|---|---|---|
| Every player's season stats | `site.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?limit=50&sort=offensive.avgPoints:desc` | Name, id, team, `gamesPlayed`, averages and totals. Sortable, paged. CORS `*`, `max-age≈300`. ~38 KB gzip per 50 players; all 321 (`limit=1000`) ~220 KB. |
| Season leaders by category | `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/types/2/leaders?limit=10` | ~4 KB, but athletes are `$ref` links only (no names, no games played). |
| A player's game list | `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/<id>/eventlog?limit=100` | ~0.7 KB; `played`, per-game `statistics` `$ref`. Includes preseason, tagged the same as regular season; no filter parameter works. |
| A player's season stats (core) | `…/seasons/2027/types/2/athletes/<id>/statistics/0` | ~5 KB; same lag as `byathlete`. |

- DET@ATL ended ≈ 22:53 UTC on 2026-11-22. The event log listed it as played (with stats) at the first check,
  2¼ h later; OKC@MIA (final ≈ 01:31 UTC) was in the event log within 40 minutes.
- Season `gamesPlayed` had **not** moved for any of the 18 DET@ATL players or 19 OKC@MIA players by 02:11 UTC
  (3¼ h after DET@ATL ended). Alexander-Walker's season line was exactly his first 16 games (335 points);
  with this game it would be 17 games / 362.
- To tell whether a game is counted: season `gamesPlayed` vs regular-season games played in the event log (needs
  the team's regular-season schedule to drop preseason). Per-game vs nightly batch updates: not determined.
