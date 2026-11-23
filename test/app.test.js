import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fixture, HTML } from './harness.js';

const FINAL = '401910029', LIVE = '401910030', PRE = '401910034';

// ESPN's own per-team totals row, mapped by label, for cross-checking our sums.
function espnTotals(tp) {
  const s = tp.statistics[0], at = l => s.totals[s.labels.indexOf(l)];
  const [fgm, fga] = at('FG').split('-').map(Number), [tpm, tpa] = at('3PT').split('-').map(Number), [ftm, fta] = at('FT').split('-').map(Number);
  return { pts: +at('PTS'), fgm, fga, tpm, tpa, ftm, fta, reb: +at('REB'), orb: +at('OREB'), drb: +at('DREB'),
    ast: +at('AST'), stl: +at('STL'), blk: +at('BLK'), tov: +at('TO'), pf: +at('PF') };
}

test('source never assigns innerHTML/outerHTML or uses insertAdjacentHTML', () => {
  const script = HTML.slice(HTML.indexOf('<script>'));
  assert.doesNotMatch(script, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/);
});

test('fixtures: every summary uses the labels the parser expects', () => {
  for (const id of [FINAL, LIVE, '401910031', '401910032', '401910033']) {
    for (const tp of fixture('summary-' + id).boxscore.players) {
      const s = tp.statistics[0];
      for (const l of ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'])
        assert.ok(s.labels.includes(l), id + ' missing label ' + l);
      for (const a of s.athletes) if (!a.didNotPlay) assert.equal(a.stats.length, s.labels.length);
    }
  }
});

test('parseEvent reads the real scoreboard', async () => {
  const app = await boot();
  const games = fixture('scoreboard').events.map(e => app.eval('parseEvent')(e));
  assert.equal(games.length, 7);
  assert.deepEqual(games.map(g => g.state), ['post', 'in', 'in', 'in', 'in', 'pre', 'pre']);
  const g = games[1];
  assert.equal(g.away.abbr, 'OKC'); assert.equal(g.home.abbr, 'MIA');
  assert.equal(g.home.name, 'Heat'); assert.equal(g.home.color, '#98002e');
  assert.equal(g.home.score, '70');
  assert.equal(games[5].away.score, '0');          // pre-game scores are '0'; the UI hides them by state
  app.close();
});

test('summary header team names match the scoreboard (no shortDisplayName in header)', async () => {
  const app = await boot();
  const team = app.eval('team');
  for (const c of fixture('summary-' + FINAL).header.competitions[0].competitors) assert.match(team(c).name, /^(Hawks|Pistons)$/);
  app.close();
});

test('buildBox: totals match ESPN totals, team turnovers counted, advanced stats sane', async () => {
  const app = await boot();
  const s = fixture('summary-' + FINAL);
  const box = app.eval('buildBox')(s);
  assert.ok(box);
  for (const [i, T] of box.teams.entries()) {
    const want = espnTotals(s.boxscore.players[i]);
    for (const [k, v] of Object.entries(want)) assert.equal(T.tot[k], v, T.abbr + ' ' + k);
    const total = +s.boxscore.teams.find(t => t.team.id === T.id).statistics.find(x => x.name === 'totalTurnovers').displayValue;
    assert.equal(T.tot.tov + T.tot.teamTov, total, T.abbr + ' total turnovers');
    assert.ok(Math.abs(T.tot.min - 240) <= 3, T.abbr + ' minutes ' + T.tot.min);   // MIN is rounded per player
    assert.equal(T.gameMin, 240);
    assert.ok(T.poss > 85 && T.poss < 115, 'poss ' + T.poss);
    assert.ok(T.pace > 85 && T.pace < 115, 'pace ' + T.pace);
    // usage across the five on court averages to 20%: minute-weighted USG% sums to ~100
    const usg = T.players.filter(p => p.a?.usg != null).reduce((a, p) => a + p.a.usg * p.min, 0) / (T.gameMin / 5);
    assert.ok(Math.abs(usg - 100) < 6, T.abbr + ' usage sum ' + usg);
    const reb = T.players.filter(p => p.a?.trbp != null).reduce((a, p) => a + p.a.trbp * p.min, 0) / (T.gameMin / 5);
    assert.ok(Math.abs(reb - T.tot.a.trbp) < 0.01, 'TRB% shares sum to team TRB%');
  }
  const [A, B] = box.teams;
  assert.ok(Math.abs(A.ortg - B.drtg) < 1e-9);
  assert.equal(A.tot.pts, 97); assert.equal(B.tot.pts, 107);
  const dnp = A.players.filter(p => p.dnp);
  assert.ok(dnp.length > 0 && dnp.every(p => p.min === 0));
  const p = A.players.find(x => x.name === 'Cade Cunningham') || A.players.find(x => !x.dnp);
  assert.equal(p.a.ts, 100 * p.pts / (2 * (p.fga + 0.44 * p.fta)));
  app.close();
});

test('buildBox returns null before tip-off', async () => {
  const app = await boot();
  assert.equal(app.eval('buildBox')(fixture('summary-' + PRE)), null);
  app.close();
});

test('game view: auto-selects the first live game and renders plays + box', async () => {
  const app = await boot();
  await app.settle(() => app.$$('#list li').length > 0 && app.$$('table.bx').length === 2);
  assert.equal(app.$$('#games .g').length, 7);
  assert.equal(app.$('#games .g[aria-current=true]').textContent.slice(0, 3), 'OKC');
  assert.match(app.window.location.hash, new RegExp('g=' + LIVE));
  const sc = app.$('#score').textContent;
  assert.match(sc, /OKC/); assert.match(sc, /Heat/); assert.match(sc, /Thunder/);
  assert.match(app.$('#score .mid').textContent, /3rd/);
  assert.equal(app.$$('#list li').length, fixture('summary-' + LIVE).plays.length);
  assert.deepEqual(app.$$('#period option').map(o => o.textContent), ['All', 'Q1', 'Q2', 'Q3']);
  // newest first: top play is the last one in the feed
  const plays = fixture('summary-' + LIVE).plays;
  assert.equal(app.$('#list li .tx').firstChild.textContent, plays.at(-1).text);
  assert.match(app.$('#status').textContent, /^Live/);
  // box: links to BBRef search, starters first, team row
  const a = app.$('table.bx tbody a');
  assert.match(a.href, /^https:\/\/www\.basketball-reference\.com\/search\/search\.fcgi\?search=/);
  assert.equal(a.target, '_blank');
  assert.equal(app.$$('table.ff tbody tr').length, 2);
  assert.ok(app.$$('table.bx tfoot td')[0].textContent === 'Team');
  app.close();
});

test('live refresh appends only the new plays and highlights them', async () => {
  const app = await boot();
  await app.settle(() => app.$$('#list li').length > 0);
  const before = app.$$('#list li').length;
  const firstEl = app.$('#list li');
  app.routes['summary:' + LIVE] = 'summary-' + LIVE + '-next';
  app.eval('loadPBP()');
  const after = fixture('summary-' + LIVE + '-next').plays.length;
  await app.settle(() => app.$$('#list li').length === after);
  assert.equal(app.$$('#list li.new').length, after - before);
  assert.ok(firstEl.isConnected, 'existing rows were kept, not redrawn');
  app.close();
});

test('filters: scoring and per-team', async () => {
  const app = await boot();
  await app.settle(() => app.$$('#filters button').length === 4);
  const btn = label => app.$$('#filters button').find(b => b.textContent === label);
  btn('Scoring').click();
  const lis = app.$$('#list li');
  assert.ok(lis.length > 0 && lis.every(li => li.classList.contains('scoring')));
  btn('MIA').click();
  assert.ok(app.$$('#list li .tm').every(t => t.textContent === 'MIA'));
  app.$('#period').value = '1'; app.$('#period').dispatchEvent(new app.window.Event('change'));
  assert.ok(app.$$('#list .per h2').every(h => h.textContent === '1st Quarter'));
  app.close();
});

test('team-on-top preference reorders box score and persists', async () => {
  const app = await boot();
  await app.settle(() => app.$$('#topSel button').length === 2);
  assert.equal(app.$('.th .ab').textContent, 'OKC');   // away on top by default
  app.$$('#topSel button').find(b => b.textContent === 'MIA').click();
  assert.equal(app.$('.th .ab').textContent, 'MIA');
  assert.equal(JSON.parse(app.window.localStorage.getItem('nbapbp.top')), 'MIA');
  app.close();
});

test('final game: no polling, box cached for leaders', async () => {
  const app = await boot({ hash: '#g=' + FINAL + '&t=box' });
  await app.settle(() => app.$('#status').textContent === 'Final.');
  assert.equal(app.$('#gameView').dataset.tab, 'box');
  const cached = JSON.parse(app.window.localStorage.getItem('nbapbp.box.' + FINAL));
  assert.equal(cached.final, true);
  assert.ok(cached.rows.length > 10);
  assert.ok(!app.$('#score .mid').classList.contains('live'));
  app.close();
});

test('pre-game: placeholder box and status', async () => {
  const app = await boot({ hash: '#g=' + PRE });
  await app.settle(() => /hasn’t started/.test(app.$('#status').textContent));
  assert.match(app.$('#box').textContent, /appears once the game starts/);
  assert.equal(app.$('#controls').hidden, true);
  app.close();
});

test('leaders: all started games, skips pre-game, never refetches finals', async () => {
  const app = await boot({ hash: '#v=leaders' });
  await app.settle(() => app.$$('#leaders .card').length > 0 && /updated/.test(app.$('#ldStatus').textContent));
  const summaryCalls = app.calls.filter(c => c.key.startsWith('summary:')).map(c => c.key.split(':')[1]).sort();
  assert.deepEqual(summaryCalls, [FINAL, LIVE, '401910031', '401910032', '401910033']);
  assert.equal(app.$$('#leaders .card').length, 12);
  // top scorer across the slate
  let best = 0;
  for (const id of [FINAL, LIVE, '401910031', '401910032', '401910033'])
    for (const tp of fixture('summary-' + id).boxscore.players) {
      const s = tp.statistics[0], i = s.labels.indexOf('PTS');
      for (const a of s.athletes) if (a.stats.length) best = Math.max(best, +a.stats[i]);
    }
  const pts = app.$$('#leaders .card').find(c => c.querySelector('h3').textContent === 'Points');
  assert.equal(+pts.querySelector('.val').textContent, best);
  assert.match(app.$('#ldStatus').textContent, /^5 of 7 games/);
  // second pass: finals come from cache; just-fetched live games are skipped too
  app.calls.length = 0;
  await app.eval('loadLeaders()');
  assert.equal(app.calls.filter(c => c.key === 'summary:' + FINAL).length, 0);
  app.close();
});

test('final box from localStorage survives a reload without refetch', async () => {
  const first = await boot({ hash: '#v=leaders' });
  await first.settle(() => /updated/.test(first.$('#ldStatus').textContent));
  const entry = JSON.parse(first.window.localStorage.getItem('nbapbp.box.' + FINAL));
  first.close();
  const app = await boot({ hash: '#v=leaders', storage: { ['nbapbp.box.' + FINAL]: entry } });
  await app.settle(() => /updated/.test(app.$('#ldStatus').textContent));
  assert.equal(app.calls.filter(c => c.key === 'summary:' + FINAL).length, 0);
  app.close();
});

test('day navigation requests the right date and shows Today button', async () => {
  const app = await boot();
  await app.settle(() => app.$$('#games .g').length === 7);
  app.routes['scoreboard:20261121'] = { day: { date: '2026-11-21' }, events: [] };
  app.$('#prev').click();
  await app.settle(() => app.calls.some(c => c.key === 'scoreboard:20261121') && /No games/.test(app.$('#status').textContent));
  assert.equal(app.$('#today').hidden, false);
  assert.match(app.$('#day').textContent, /21/);
  assert.match(app.window.location.hash, /d=20261121/);
  app.close();
});

test('fetches are simple CORS requests (no options that would trigger a preflight)', async () => {
  const app = await boot();
  await app.settle(() => app.calls.some(c => c.key.startsWith('summary:')));
  for (const c of app.calls) assert.equal(c.opts, undefined, c.key + ' passed fetch options');
});
