# NBA Gameday

A free, ad-free, low-data NBA live dashboard: **https://nsanders.me**

- **Games**: live play-by-play (filter by scoring plays, team or quarter) next to a full box score.
- **Box score**: counting stats plus advanced stats computed in the browser (TS%, eFG%, USG%, AST%, TOV%, rebound/steal/block rates, Game Score), team pace, possessions, offensive/defensive rating and the four factors. Pick which team is listed first.
- **Top performers**: leaders across every game on a given day in 12 categories.
- Works on phones and desktops, light and dark mode. Player names link to Basketball Reference.

## Low data by design

It's one static `index.html`: no build step, no frameworks, no images, no trackers.
Data is only fetched while it can change: play-by-play every 10 s while the game you're watching is live,
every other game once a minute (one scoreboard request covers them all) while any game is live, and nothing while the tab is hidden. Finished games are cached in
your browser and never downloaded again.

While you watch a live game, only the new plays (a couple of KB) are fetched every 10 s; the full box score is
refreshed about once a minute, and only when something happened. Polling slows down during timeouts, between
quarters and at halftime. Watching a whole live game uses at most about 9 MB (it was ~30 MB when the whole game was re-downloaded every 10 s).

The ⚙ button lets you change every refresh interval and shows the estimated and actual data used.

## Links

URLs are shareable: `#d=20261122` (date), `#g=<gameId>` (game), `#t=box` (box score tab on mobile), `#v=leaders` (top performers).

## Development

Open `index.html` in a browser (or `npx http-server .`). Tests run the page in jsdom against recorded game data:

```bash
npm install
```

```bash
npm test
```

Not affiliated with the NBA or Sports Reference.
