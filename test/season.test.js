// Season data: the nightly builder (scripts/build-season.mjs) and the Season tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fixture, defaultRoutes } from './harness.js';
import { emptyState, addGame, outputs, topUnion, PCOLS, TCOLS, PMETRICS, TMETRICS, SCOLS } from '../scripts/build-season.mjs';

// Build a small "season" from the captured box scores (the live ones are treated as finished games here).
const GAMES = [['401910029', '2026-11-22'], ['401910030', '2026-11-22'], ['401910031', '2026-11-21'], ['401910032', '2026-11-20'], ['401910033', '2026-11-19']];
function season() {
  const S = emptyState(2027);
  for (const [id, day] of GAMES) assert.ok(addGame(S, fixture('summary-' + id), day, id), id);
  S.through = '2026-11-22';
  return S;
}
const files = () => outputs(season(), '2026-11-23T11:40:00Z');
const seasonRoutes = (f = files()) => ({ ...defaultRoutes(), ...Object.fromEntries(Object.entries(f).map(([k, v]) => ['data:' + k, v])) });
const obj = (cols, r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]));

// ---------------------------------------------------------------- builder
test('builder: player and team rows match the box score totals, incl. team turnovers', () => {
  const S = season();
  assert.equal(S.games.length, 5);
  assert.equal(addGame(S, fixture('summary-401910029'), '2026-11-22', '401910029'), false, 'a game is only added once');
  const s = fixture('summary-401910029');
  for (const tp of s.boxscore.players) {
    const st = tp.statistics[0], at = l => st.totals[st.labels.indexOf(l)];
    const t = S.teams.indexOf(tp.team.abbreviation);
    const rows = S.rows.filter(r => r[0] === 0 && r[2] === t).map(r => obj(PCOLS, r));
    assert.equal(rows.reduce((a, r) => a + r.pts, 0), +at('PTS'));
    assert.equal(rows.reduce((a, r) => a + r.ast, 0), +at('AST'));
    assert.equal(rows.length, st.athletes.filter(a => a.stats.length && a.stats[0] !== '0').length);
    const tr = obj(TCOLS, S.trows.find(r => r[0] === 0 && r[1] === t));
    const totalTov = +s.boxscore.teams.find(x => x.team.abbreviation === tp.team.abbreviation).statistics.find(x => x.name === 'totalTurnovers').displayValue;
    assert.equal(tr.tov, totalTov);
    assert.equal(tr.min, 240);
  }
  const [det, atl] = ['DET', 'ATL'].map(a => obj(TCOLS, S.trows.find(r => r[0] === 0 && r[1] === S.teams.indexOf(a))));
  assert.deepEqual([det.pts, det.opp, det.home, atl.home], [97, 107, 0, 1]);
  assert.equal(det.ofga, atl.fga);
  assert.ok(Math.abs(TMETRICS.ortg.v(det) - TMETRICS.drtg.v(atl)) < 1e-9, 'ratings agree from both sides');
});

test('builder: the small file contains the exact top n for every column (ties included)', () => {
  const S = season();
  for (const [rows, cols, metrics] of [[S.rows, PCOLS, PMETRICS], [S.trows, TCOLS, TMETRICS]]) {
    const n = 5, keep = new Set(topUnion(rows, cols, metrics, n));
    if (cols === PCOLS) assert.ok(keep.size < rows.length);   // (a 5-game sample keeps every team row)
    for (const [k, m] of Object.entries(metrics)) {
      const vals = rows.map((r, i) => [m.v(obj(cols, r)), i]).filter(([v]) => v != null).sort((a, b) => m.best * (a[0] - b[0]));
      if (!vals.length) continue;
      const cut = vals[Math.min(n, vals.length) - 1][0];           // fewer than n rows may qualify (e.g. 3P% needs 15 attempts)
      for (const [v, i] of vals) if (m.best * (v - cut) <= 0) assert.ok(keep.has(i), k + ' row ' + i);
    }
  }
});

test('builder: outputs re-index the small file consistently; per-player totals add up', () => {
  const S = season(), f = files();
  const best = f['season-best.json'], full = f['season-games.json'], pl = f['season-players.json'];
  assert.equal(full.rows.length, S.rows.length);
  const key = (d, r) => d.players[r[1]][0] + '|' + d.games[r[0]][0] + '|' + r.slice(2).join(',');
  const all = new Set(full.rows.map(r => key(full, r)));
  for (const r of best.rows) assert.ok(all.has(key(full === best ? full : best, r)));
  assert.ok(best.players.length <= full.players.length && best.top === 50);
  // every player appears once with the right games played and points
  for (const r of pl.rows) {
    const o = obj(SCOLS, r), mine = S.rows.filter(x => x[1] === o.p);
    assert.equal(o.gp, mine.length);
    assert.equal(o.pts, mine.reduce((a, x) => a + x[PCOLS.indexOf('pts')], 0));
  }
  assert.equal(pl.teamGames.reduce((a, b) => a + b, 0), S.games.length * 2);
});

test('page metrics match the builder’s on every row', async () => {
  const S = season(), app = await boot({ hash: '' });
  await app.settle(() => /updated/.test(app.$('#homeStatus').textContent));   // let the page finish loading first
  for (const [rows, cols, mine, page] of [[S.rows, PCOLS, PMETRICS, 'SEASON_P'], [S.trows, TCOLS, TMETRICS, 'SEASON_T']]) {
    const pm = app.eval(page);
    assert.deepEqual(Object.keys(pm).sort(), Object.keys(mine).sort());
    for (const r of rows) for (const k of Object.keys(mine)) {
      const o = obj(cols, r);
      assert.equal(pm[k].v(o), mine[k].v(o), k);
      assert.equal(pm[k].best, mine[k].best, k);
    }
  }
});

// ---------------------------------------------------------------- Season tab
const tableCol = (app, h) => {
  const idx = Array.from(app.$('#seasonTable thead tr').children, th => th.textContent).indexOf(h);
  return Array.from(app.$$('#seasonTable tbody tr'), tr => tr.children[idx].textContent);
};
// sorting re-renders asynchronously (loadSeason); wait for the header to show the new sort
async function clickHead(app, h, dir) {
  Array.from(app.$('#seasonTable thead tr').children).find(th => th.textContent === h).click();
  await app.settle(() => { const th = app.$('#seasonTable th[aria-sort]'); return th?.textContent === h && (!dir || th.getAttribute('aria-sort') === dir); });
}
const num = v => (v === '' ? null : parseFloat(v));
const isSorted = (vals, dir) => vals.every((v, i) => i === 0 || dir * (v - vals[i - 1]) >= 0);

test('season tab: per-game leaders, qualified by games played, sortable both ways', async () => {
  const app = await boot({ hash: '#v=season', routes: seasonRoutes() });
  await app.settle(() => app.$$('#seasonTable tbody tr').length > 0);
  assert.equal(app.$('#seasonView').hidden, false);
  assert.equal(app.$('#navSeason').getAttribute('aria-pressed'), 'true');
  assert.ok(['#prev', '#day', '#next', '#games'].every(s => app.$(s).hidden), 'no date controls or strip');
  assert.deepEqual(app.calls.filter(c => c.key.startsWith('data:')).map(c => c.key), ['data:season-players.json']);
  assert.match(app.$('#seasonStatus').textContent, /through Nov 22 · \d+ players \(qualified\)/);
  assert.ok(isSorted(tableCol(app, 'PTS').map(Number), -1));
  const qualified = app.$$('#seasonTable tbody tr').length;
  app.$('#seasonAll').click();
  await app.settle(() => app.$('#seasonAll').checked && app.$$('#seasonTable tbody tr').length >= qualified);
  await clickHead(app, 'AST', 'descending');
  assert.ok(isSorted(tableCol(app, 'AST').map(Number), -1));
  await clickHead(app, 'AST', 'ascending');                                             // per-game sorts both ways
  assert.ok(isSorted(tableCol(app, 'AST').map(Number), 1));
  assert.equal(app.$('#seasonTable th[aria-sort]').getAttribute('aria-sort'), 'ascending');
  app.$('#seasonFind').value = 'jok'; app.$('#seasonFind').dispatchEvent(new app.window.Event('input'));
  await app.settle(() => app.$$('#seasonTable tbody tr').length === 1);
  assert.match(app.$('#seasonTable tbody tr').textContent, /Nikola Jokic/);
});

test('season tab: best player games from the small file; filtering loads every game', async () => {
  const app = await boot({ hash: '#v=season&s=pg', routes: seasonRoutes(), storage: { 'nbapbp.settings': { v: 2, follow: ['MIA'] } } });
  await app.settle(() => app.$$('#seasonTable tbody tr').length > 0);
  assert.deepEqual(app.calls.filter(c => c.key.startsWith('data:')).map(c => c.key), ['data:season-best.json']);
  assert.deepEqual({ ...app.calls.find(c => c.key === 'data:season-best.json').opts }, { cache: 'no-cache' });
  assert.equal(app.$$('#seasonTable tbody tr').length, 50);
  assert.ok(isSorted(tableCol(app, 'GmSc').map(Number), -1));
  assert.ok(app.$$('#seasonTable tbody tr.fol').every(tr => /^MIA /.test(tr.children[1].textContent)));
  await clickHead(app, 'PTS');
  const pts = tableCol(app, 'PTS').map(Number);
  assert.ok(isSorted(pts, -1));
  await clickHead(app, 'PTS');                                             // best games: only the exact (best-first) direction
  assert.deepEqual(tableCol(app, 'PTS').map(Number), pts);
  app.$('#seasonTeam').value = 'DET'; app.$('#seasonTeam').dispatchEvent(new app.window.Event('change'));
  await app.settle(() => app.calls.some(c => c.key === 'data:season-games.json') && app.$$('#seasonTable tbody tr').length > 0
    && tableCol(app, 'Game').every(g => g.startsWith('DET')));
  assert.match(app.$('#seasonStatus').textContent, /of \d+ player games/);
  assert.equal(app.$('#seasonFind').hidden, false);
  // a row opens its game on its own day; Back returns to the table
  app.$$('#seasonTable tbody tr')[0].children[2].click();
  await app.settle(() => /d=20261122&g=401910029/.test(app.window.location.hash) && app.$('#status').textContent === 'Final.');
  app.window.history.back();
  await app.settle(() => !app.$('#seasonView').hidden && app.window.location.hash === '#v=season&s=pg');
});

test('season tab: best team games; "lower is better" columns rank lowest first', async () => {
  const app = await boot({ hash: '#v=season&s=tg', routes: seasonRoutes() });
  await app.settle(() => app.$$('#seasonTable tbody tr').length === 10);   // 5 games x 2 teams
  assert.equal(app.$('#seasonFind').hidden, true);
  assert.ok(isSorted(tableCol(app, '+/-').map(Number), -1));
  assert.equal(tableCol(app, 'Result')[0], 'W 107–97'.replace('107–97', tableCol(app, 'Result')[0].slice(2)));
  await clickHead(app, 'DRtg');
  assert.ok(isSorted(tableCol(app, 'DRtg').map(Number), 1));
  assert.equal(app.$('#seasonTable th[aria-sort]').getAttribute('aria-sort'), 'ascending');
  await clickHead(app, 'TO');
  assert.ok(isSorted(tableCol(app, 'TO').map(Number), 1));
});

test('season tab: switching sections keeps history; missing data shows an error', async () => {
  const app = await boot({ hash: '', routes: seasonRoutes() });
  app.$('#navSeason').click();
  await app.settle(() => app.$$('#seasonTable tbody tr').length > 0);
  assert.equal(app.window.location.hash, '#v=season');
  app.$$('#seasonTabs button')[2].click();
  await app.settle(() => app.window.location.hash === '#v=season&s=tg' && app.$$('#seasonTable tbody tr').length === 10);
  app.window.history.back();
  await app.settle(() => app.window.location.hash === '#v=season' && /players/.test(app.$('#seasonStatus').textContent));
  app.$('#logo').click();
  assert.equal(app.$('#games').hidden, true);
  assert.equal(app.$('#prev').hidden, false, 'date controls return outside the season tab');

  const bare = await boot({ hash: '#v=season' });                     // no data files deployed yet
  await bare.settle(() => /isn’t available yet/.test(bare.$('#seasonStatus').textContent));
});
