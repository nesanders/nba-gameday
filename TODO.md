# TODO

## Season leaders tab with daily deltas (not started)

**Goal:** a "Season" tab listing season-average leaders (about 8 categories), with a column showing how much the
selected day's game moved each player's average (e.g. a 30-point night takes 25.0 PPG over 15 games to 25.3).
Live games would show a projected change ("if the game ended now").

### Data sources (checked against live responses, 2026-11-22/23)

| What | Endpoint | Notes |
|---|---|---|
| Every player's season stats | `site.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?limit=50&sort=offensive.avgPoints:desc` | Name, id, team, `gamesPlayed`, averages **and totals**. Sortable, paged (`page=`). `Access-Control-Allow-Origin: *`, `max-age≈300`. ~38 KB gzip per 50 players; all 321 players (`limit=1000`) ~220 KB. Same host the app already uses. |
| Season leaders by category | `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/types/2/leaders?limit=10` | 16 categories, ~4 KB, but athletes are `$ref` links only (no names, no games played): one extra request per player. Prefer `byathlete`. |
| A player's game list | `sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/<id>/eventlog?limit=100` | ~0.7 KB. Each item: event `$ref`, `played`, `teamId`, per-game `statistics` `$ref`. **Includes preseason**, tagged the same as regular season (`type.abbreviation` is `STD` for both); no filter parameter works (`types/2/…` → 404, `seasontype=`/`type=` ignored). |
| A player's season stats (core) | `…/seasons/2027/types/2/athletes/<id>/statistics/0` | ~5 KB; same lag as `byathlete`. |

### The catch: season stats lag behind finished games

Example: Nickeil Alexander-Walker, DET@ATL on 2026-11-22, final ≈ 22:53 UTC, 27 points.

- **Event log** listed the game as played, with its stats, when first checked about 2¼ hours after the final.
- **Season stats** still showed 16 games / 335 points: exactly the sum of his first 16 regular-season games
  (with this game it would be 17 / 362). At 01:11 UTC, **0 of the 18 players** who played in that game had an
  updated `gamesPlayed`.

So a delta can't assume the season totals include the selected day. With season total `T`, games `n` and that
day's line `g`:

- not yet counted: change = `(T + g) / (n + 1) − T / n`
- already counted: change = `T / n − (T − g) / (n − 1)`

**Detecting which case applies:** a player's season `gamesPlayed` equals the number of regular-season games
their event log shows as played → the game is counted. If it's one short, it isn't. Because the event log
includes preseason, counting regular-season games needs the team's regular-season schedule too
(`site.api.espn.com/…/teams/<id>/schedule?seasontype=2`, one request per team per day; not yet measured).
Preseason in 2026 ran Oct 5–17; the regular season started Oct 21.

### Still open

- **How long the lag is, and whether ESPN updates a whole game's players at once.** If updates are per game, checking
  one player per game is enough; if they happen on a fixed overnight run, a simple time rule might do. A monitor
  was started at 01:11 UTC on 2026-11-23 (every 10 min for 2 h), recording for each game when it went final,
  when the event log listed it, and when players' season `gamesPlayed` went up. Its results weren't in when this
  note was written.
- **Past dates aren't feasible.** The API only gives averages as of now. Averages "as of" an earlier day would mean
  rebuilding the season from every box score (~1,200 games, ~50 MB). Offer deltas only for today and recent days.

### Proposed design

- New view `#v=season`: one `byathlete` request when the tab opens (sorted by the chosen category, top 50),
  cached for the day; refresh at most every 5 min while open, and only if games are live or recently final.
- Delta column for players whose team played on the selected day, from the box data the app already loads
  (`leaders` map / `nbapbp.box.<id>`); athlete ids match between the box score and `byathlete`.
- Inclusion check per the rule above, cached per player per game.
- Tests: capture `byathlete` and `eventlog` fixtures before and after an update (the monitor's window is a good
  time to grab both).
