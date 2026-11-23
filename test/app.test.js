import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fixture, HTML, defaultRoutes } from './harness.js';

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

test('full refresh (lightweight updates off) appends only the new plays and highlights them', async () => {
  const app = await boot({ storage: { 'nbapbp.settings': { lite: false } } });
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

test('fetches bypass the HTTP cache and send no custom headers', async () => {
  const app = await boot();
  await app.settle(() => app.calls.some(c => c.key.startsWith('summary:')));
  for (const c of app.calls) assert.deepEqual({ ...c.opts }, { cache: 'no-store' }, c.key);   // spread: jsdom realm object
});

test('polling: selected live game every 10s, scoreboard (other games) every 60s', async () => {
  const app = await boot();
  await app.settle(() => app.delays.some(d => d.fn === 'loadPBP') && app.delays.some(d => d.fn === 'loadScoreboard'));
  assert.deepEqual([...new Set(app.delays.filter(d => d.fn === 'loadPBP').map(d => d.ms))], [10000]);
  assert.deepEqual([...new Set(app.delays.filter(d => d.fn === 'loadScoreboard').map(d => d.ms))], [60000]);
});

test('polling: a final selected game is not polled at all', async () => {
  const app = await boot({ hash: '#g=401910029' });
  await app.settle(() => app.$('#status').textContent === 'Final.');
  assert.equal(app.delays.filter(d => d.fn === 'loadPBP').length, 0);
});

// ---------------------------------------------------------------- lightweight live updates (core API)
const G = '401910032';   // summary captured at t0 (129 plays); core plays + status captured ~4 min later (138 plays)
const liteRoutes = () => ({ ...defaultRoutes(), ['core:plays:' + G]: 'core-plays-' + G, ['core:status:' + G]: 'core-status-' + G });
async function liteApp(opts = {}) {
  const app = await boot({ hash: '#g=' + G, routes: liteRoutes(), ...opts });
  await app.settle(() => app.$$('#list li').length === 129 && /^Live/.test(app.$('#status').textContent));
  app.calls.length = 0; app.delays.length = 0;
  return app;
}
const tick = async (app, until) => { app.eval('loadPBP()'); await app.settle(until); };

test('lite tick: fetches status + one page of plays, appends new plays, updates score', async () => {
  const app = await liteApp();
  const core = fixture('core-plays-' + G).items;
  await tick(app, () => app.$$('#list li').length === core.length);
  assert.deepEqual(app.calls.map(c => c.key).sort(), ['core:plays:' + G, 'core:status:' + G]);
  // 9 new plays + 1 real correction ESPN made to an existing play ("misses jumper" -> "... blocks ...")
  assert.equal(app.$$('#list li.new').length, core.length - 129 + 1);
  assert.ok(app.$$('#list li.new .tx').some(t => /Trevon Brazile blocks Josh Giddey/.test(t.textContent)));
  assert.ok(!app.$$('#list li .tx').some(t => t.firstChild.textContent === 'Josh Giddey misses 5-foot jumper'));
  const last = core.at(-1);
  assert.deepEqual(app.$$('#score .pts').map(e => e.textContent), [String(last.awayScore), String(last.homeScore)]);
  assert.match(app.$('#score .mid').textContent, new RegExp(fixture('core-status-' + G).displayClock));
  assert.equal(app.$('#list li .tx').firstChild.textContent, last.text);
  // team abbreviation comes from the $ref team id
  const teamPlay = core.findLast(p => p.team);
  const li = app.$$('#list li').find(x => x.querySelector('.tx').firstChild.textContent === teamPlay.text);
  assert.match(li.querySelector('.tm').textContent, /^[A-Z]{2,4}$/);
  // box header scores follow the live score
  assert.deepEqual(app.$$('.th[data-team] .pts').map(e => e.textContent).sort(), [String(last.awayScore), String(last.homeScore)].sort());
});

test('lite: box refreshes via full summary only when due AND new plays arrived', async () => {
  const app = await liteApp();
  await tick(app, () => app.calls.length === 2);                       // lite tick, new plays -> dirty
  app.eval('live.lastBox = Date.now() - 61000');
  app.calls.length = 0;
  await tick(app, () => app.calls.length >= 1);
  assert.deepEqual(app.calls.map(c => c.key), ['summary:' + G]);
  app.eval('live.lastBox = Date.now() - 600000; live.dirty = false');   // stale box but nothing new: stay lite
  app.calls.length = 0;
  await tick(app, () => app.calls.length >= 2);
  assert.ok(app.calls.every(c => c.key.startsWith('core:')));
});

test('lite: more than a page behind -> one full refresh instead of paging', async () => {
  const app = await liteApp();
  app.eval('state.plays = state.plays.slice(0, 100)');
  await tick(app, () => app.calls.some(c => c.key.startsWith('summary:')));
  assert.equal(app.calls.filter(c => c.key === 'core:plays:' + G).length, 1);
});

test('lite: falls back to full summaries after two failures', async () => {
  const app = await liteApp({ routes: defaultRoutes() });               // no core routes -> 404
  for (let i = 1; i <= 2; i++) await tick(app, () => app.calls.filter(c => c.key === 'core:status:' + G).length === i && app.delays.length === i);
  app.calls.length = 0;
  await tick(app, () => app.calls.length >= 1);
  assert.deepEqual(app.calls.map(c => c.key), ['summary:' + G]);
});

test('lite updates off: every tick is a full summary', async () => {
  const app = await liteApp({ storage: { 'nbapbp.settings': { lite: false } } });
  await tick(app, () => app.calls.length >= 1);
  assert.deepEqual(app.calls.map(c => c.key), ['summary:' + G]);
});

// ---------------------------------------------------------------- breaks
test('end of quarter (real capture): checks every 30s and says so', async () => {
  const routes = { ...defaultRoutes(), 'summary:401910033': 'summary-401910033-endq' };
  const app = await boot({ hash: '#g=401910033', routes });
  await app.settle(() => app.delays.some(d => d.fn === 'loadPBP'));
  assert.equal(app.delays.find(d => d.fn === 'loadPBP').ms, 30000);
  assert.match(app.$('#status').textContent, /Between quarters, checking every 30s/);
  assert.match(app.$('#score .mid').textContent, /End of 1st/);
});

test('break, timeout and idle back-off rules', async () => {
  const app = await liteApp();
  const delay = (st, idle = 0, lastType = 'Jump Shot', s = {}) => {
    app.eval(`Object.assign(settings, ${JSON.stringify({ live: 10, breaks: true, ...s })});
      state.gameState = 'in'; state.statusName = ${JSON.stringify(st.name)}; state.detail = ${JSON.stringify(st.detail)};
      live.idle = ${idle}; state.plays.at(-1).type = ${JSON.stringify(lastType)};`);
    return app.eval('nextDelay()');
  };
  const play = { name: 'STATUS_IN_PROGRESS', detail: '5:25 - 3rd' };
  assert.equal(delay(play), 10000);
  assert.equal(delay({ name: 'STATUS_HALFTIME', detail: 'Halftime' }), 60000);
  assert.equal(delay({ name: 'STATUS_END_PERIOD', detail: 'End of 3rd' }), 30000);
  assert.equal(delay(play, 0, 'Full Timeout'), 10000);                   // timeout just called: check once more soon
  assert.equal(delay(play, 1, 'Full Timeout'), 30000);
  assert.deepEqual([1, 2, 3, 9].map(i => delay(play, i)), [20000, 30000, 30000, 30000]);
  assert.equal(delay({ name: 'STATUS_HALFTIME', detail: 'Halftime' }, 0, 'x', { breaks: false }), 10000);
  assert.equal(delay(play, 2, 'x', { live: 60 }), 60000);                // never faster than the chosen interval
});

test('idle back-off in practice: identical responses slow polling to 20s then 30s', async () => {
  const app = await liteApp();
  await tick(app, () => app.delays.length === 1);   // new plays
  await tick(app, () => app.delays.length === 2);   // same
  await tick(app, () => app.delays.length === 3);   // same
  assert.deepEqual(app.delays.map(d => d.ms), [10000, 20000, 30000]);
  assert.match(app.$('#status').textContent, /Play stopped, checking every 30s/);
});

// ---------------------------------------------------------------- settings + usage
test('estimates: lite vs full per-minute math', async () => {
  const app = await boot();
  await app.settle(() => /^Live/.test(app.$('#status').textContent));
  app.eval('Object.assign(SIZE, { summary: 34000, plays: 2300, status: 300, scoreboard: 13000 }); Object.assign(settings, DEFAULTS)');
  assert.equal(Math.round(app.eval("perMinute('game', 1)")), 6 * 2600 + 34000 + 13000);
  app.eval('settings.lite = false');
  assert.equal(Math.round(app.eval("perMinute('game', 1)")), 6 * 34000 + 13000);
  assert.equal(Math.round(app.eval("perMinute('leaders', 5)")), 5 * 34000 / 5 + 13000);   // 5 games every 5 min
  assert.equal(app.eval("perMinute('scores', 0)"), 0);
});

test('settings panel: opens, saves, re-times pending polls, shows usage', async () => {
  const app = await boot();
  await app.settle(() => app.delays.some(d => d.fn === 'loadScoreboard') && app.delays.some(d => d.fn === 'loadPBP'));
  assert.equal(app.$('#settings').hidden, true);
  app.$('#gear').click();
  assert.equal(app.$('#settings').hidden, false);
  assert.equal(app.$('#gear').getAttribute('aria-expanded'), 'true');
  const sels = app.$$('#setControls select');
  assert.equal(sels.length, 4);
  assert.equal(sels[0].value, '10');
  app.delays.length = 0;
  sels[2].value = '30'; sels[2].dispatchEvent(new app.window.Event('change'));          // other games: 60s -> 30s
  assert.equal(JSON.parse(app.window.localStorage.getItem('nbapbp.settings')).others, 30);
  assert.deepEqual(app.delays.map(d => [d.fn, d.ms]), [['loadScoreboard', 30000]]);    // pending 60s poll pulled in
  const usage = app.$('#usage').textContent;
  assert.match(usage, /Right nowWatching OKC–MIA live/);
  assert.match(usage, /Used this visit: \d+ KB in \d+ requests/);
  const lite = app.$$('#setControls input[type=checkbox]')[1];                         // lite off disables box interval
  lite.checked = false; lite.dispatchEvent(new app.window.Event('change'));
  assert.equal(app.$$('#setControls select')[1].disabled, true);
  app.$$('#setControls button').find(b => b.textContent === 'Defaults').click();
  assert.equal(app.eval('settings.lite'), true);
  assert.equal(app.eval('settings.others'), 60);
});

test('a later scoreboard response does not overwrite the watched game tile with older data', async () => {
  const app = await liteApp();   // scoreboard fixture is older (21–21, 1st) than the game summary (38–41, 2nd)
  app.eval('loadScoreboard()');
  await app.settle(() => app.calls.some(c => c.key === 'scoreboard'));
  await app.settle(() => /2nd/.test(app.$$('#games .g').find(b => b.textContent.startsWith('DEN')).textContent));
  const tile = app.$$('#games .g').find(b => b.textContent.startsWith('DEN'));
  assert.match(tile.textContent, /38.*41/);
});

// ---------------------------------------------------------------- box score sorting
const colIdx = (app, h) => Array.from(app.$$('table.bx')[0].querySelectorAll('thead th')).findIndex(t => t.textContent === h);
const colVals = (app, h, t = 0) => Array.from(app.$$('table.bx')[t].querySelectorAll('tbody tr'))
  .map(tr => tr.children[colIdx(app, h)].textContent);
const clickHead = (app, h) => Array.from(app.$$('table.bx')[0].querySelectorAll('thead th')).find(t => t.textContent === h).click();

test('box default sort: starters first (GS column), then Game Score descending', async () => {
  const app = await boot({ hash: '#g=401910029' });
  await app.settle(() => app.$$('table.bx').length === 2);
  for (const t of [0, 1]) {
    const gs = colVals(app, 'GS', t), gm = colVals(app, 'GmSc', t).map(Number);
    assert.equal(gs.filter(x => x === '●').length, 5);
    assert.deepEqual(gs, [...gs].sort().reverse(), 'starters first');
    const starters = gm.slice(0, 5), bench = gm.slice(5);
    assert.deepEqual(starters, [...starters].sort((a, b) => b - a));
    assert.deepEqual(bench, [...bench].sort((a, b) => b - a));
    assert.equal(app.$$('table.bx')[t].querySelectorAll('tbody tr')[5].className, 'b0');   // starter/bench divider
  }
  assert.equal(app.$('table.bx th[aria-sort]').textContent, 'GS');
});

test('every column sorts on click: desc, then asc; both tables follow; blanks last', async () => {
  const app = await boot({ hash: '#g=401910029' });
  await app.settle(() => app.$$('table.bx').length === 2);
  const heads = Array.from(app.$$('table.bx')[0].querySelectorAll('thead th')).map(t => t.textContent);
  assert.equal(heads.length, 33);
  for (const h of heads.filter(h => h !== 'Player' && h !== 'GS')) {
    clickHead(app, h);
    const key = v => (v === '' ? null : parseFloat(v));
    for (const t of [0, 1]) {
      const vals = colVals(app, h, t).map(key), nums = vals.filter(v => v != null);
      assert.deepEqual(nums, [...nums].sort((a, b) => b - a), h + ' desc');
      assert.ok(vals.indexOf(null) < 0 || vals.slice(vals.indexOf(null)).every(v => v == null), h + ' blanks last');
    }
    assert.equal(app.$('table.bx th[aria-sort]').getAttribute('aria-sort'), 'descending');
    clickHead(app, h);
    const asc = colVals(app, h).map(key).filter(v => v != null);
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b), h + ' asc');
    assert.equal(app.$('table.bx th[aria-sort]').getAttribute('aria-sort'), 'ascending');
  }
  clickHead(app, 'Player');
  const names = colVals(app, 'Player').map(n => n.replace(/\s*[A-Z]{1,2}$/, '').split(' ').slice(1).join(' '));
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(app.$$('table.bx tbody tr.b0').length, 0, 'no starter divider unless sorted by GS');
  // FG sorts by makes, then attempts
  clickHead(app, 'FG');
  const fg = colVals(app, 'FG').map(v => v.split('-').map(Number));
  for (let i = 1; i < fg.length; i++) assert.ok(fg[i - 1][0] > fg[i][0] || (fg[i - 1][0] === fg[i][0] && fg[i - 1][1] >= fg[i][1]));
  // team totals row stays in the footer
  assert.equal(app.$$('table.bx tfoot td')[0].textContent, 'Team');
});

test('sort is keyboard accessible and survives live refreshes', async () => {
  const app = await boot();
  await app.settle(() => app.$$('table.bx').length === 2);
  const th = Array.from(app.$$('table.bx')[0].querySelectorAll('thead th')).find(t => t.textContent === 'PTS');
  th.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(app.$('table.bx th[aria-sort]').textContent, 'PTS');
  assert.equal(app.document.activeElement.textContent, 'PTS');
  app.eval('renderBox()');                                    // what each box refresh does
  assert.equal(app.$('table.bx th[aria-sort]').textContent, 'PTS');
});

test('settings panel has a title and a working close button', async () => {
  const app = await boot();
  await app.settle(() => /^Live/.test(app.$('#status').textContent));
  app.$('#gear').click();
  assert.match(app.$('#settings h2').textContent, /Refresh speed/);
  app.$('#setClose').click();
  assert.equal(app.$('#settings').hidden, true);
  assert.equal(app.$('#gear').getAttribute('aria-expanded'), 'false');
});

test('usage counters accumulate and persist', async () => {
  const app = await boot();
  await app.settle(() => app.eval('usage.requests') >= 2);
  const total = JSON.parse(app.window.localStorage.getItem('nbapbp.usage'));
  assert.ok(total.bytes > 0 && total.bytes === app.eval('usage.total.bytes'));
});

// ---------------------------------------------------------------- day navigation + browser history
// Like the real API: a dated scoreboard has no `day`, and evening games start on the next UTC day.
const datedBoard = ymd => {
  const sb = fixture('scoreboard'), next = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6) + 1));
  return { events: sb.events.slice(0, 2).map((e, i) => ({ ...e, id: ymd + i, date: next.toISOString().slice(0, 10) + 'T00:30Z' })) };
};

test('previous-day button keeps going back (dated responses have no `day`)', async () => {
  const routes = defaultRoutes();
  for (const d of ['20261121', '20261120', '20261119', '20261118']) routes['scoreboard:' + d] = datedBoard(d);
  const app = await boot({ routes });
  await app.settle(() => app.$$('#games .g').length === 7);
  for (const d of ['20261121', '20261120', '20261119']) {
    app.$('#prev').click();
    await app.settle(() => app.calls.some(c => c.key === 'scoreboard:' + d) && app.$('#day').textContent.includes(String(+d.slice(6))));
    assert.match(app.window.location.hash, new RegExp('d=' + d));
  }
  app.$('#next').click();
  await app.settle(() => app.calls.filter(c => c.key === 'scoreboard:20261120').length === 2);
});

test('browser Back/Forward move between home, games and days', async () => {
  const routes = defaultRoutes();
  routes['scoreboard:20261121'] = datedBoard('20261121');
  const app = await boot({ hash: '', routes });
  await app.settle(() => app.$$('#homeGames .gc').length === 7);
  app.$$('#homeGames .gc')[0].click();                                  // open the final game
  await app.settle(() => app.$('#status').textContent === 'Final.');
  assert.match(app.window.location.hash, /g=401910029/);
  app.$('#prev').click();                                               // then the previous day
  await app.settle(() => /d=20261121/.test(app.window.location.hash));
  app.window.history.back();                                            // back to the game, on today
  await app.settle(() => !app.$('#gameView').hidden && !/d=/.test(app.window.location.hash) && app.calls.filter(c => c.key === 'scoreboard').length >= 2);
  app.window.history.back();                                            // back to home
  await app.settle(() => !app.$('#homeView').hidden);
  assert.equal(app.window.location.hash, '');
  app.window.history.forward();
  await app.settle(() => !app.$('#gameView').hidden && /g=401910029/.test(app.window.location.hash));
});

// ---------------------------------------------------------------- home page
test('home is the landing page: game cards with line scores, strip hidden', async () => {
  const app = await boot({ hash: '' });
  await app.settle(() => app.$$('#homeGames .gc').length === 7 && app.$$('#homeLeaders .card').length === 4);
  assert.equal(app.$('#homeView').hidden, false);
  assert.equal(app.$('#gameView').hidden, true);
  assert.equal(app.$('#games').hidden, true);
  const fin = app.$$('#homeGames .gc')[0];
  assert.deepEqual(Array.from(fin.querySelectorAll('thead th'), t => t.textContent), ['', '1', '2', '3', '4', 'T']);
  const atl = Array.from(fin.querySelectorAll('tbody tr')[1].children, td => td.textContent);
  assert.deepEqual(atl.slice(1), ['29', '22', '23', '33', '107']);
  assert.match(atl[0], /^ATL\d+-\d+$/);                                 // abbreviation + record
  const pre = app.$$('#homeGames .gc')[5];
  assert.equal(pre.querySelector('thead'), null);
  assert.match(pre.querySelector('.st').textContent, /PM/);
  assert.ok(app.$$('#homeGames .gc.live').length === 4);
  // top 3 players per team, from box data
  assert.equal(fin.querySelectorAll('.pl .who')[0].querySelectorAll('.pp').length, 3);
});

test('home top performers: four categories, top 3 with ties, link to all categories', async () => {
  const app = await boot({ hash: '' });
  await app.settle(() => app.$$('#homeLeaders .card').length === 4 && /updated/.test(app.$('#homeStatus').textContent));
  assert.deepEqual(app.$$('#homeLeaders h3').map(h => h.textContent), ['Points', 'Rebounds', 'Game Score', 'Assists'].sort((a, b) =>
    ['Points', 'Rebounds', 'Assists', 'Game Score'].indexOf(a) - ['Points', 'Rebounds', 'Assists', 'Game Score'].indexOf(b)));
  for (const c of app.$$('#homeLeaders .card')) assert.ok(c.querySelectorAll('li').length >= 3 && c.querySelectorAll('li').length <= 6);
  assert.equal(app.$('#homeLeaders .card .val').textContent, '27');    // top scorer on the slate
  app.$('#allLeaders').click();
  await app.settle(() => !app.$('#leadersView').hidden && app.$$('#leaders .card').length === 12);
  assert.equal(app.window.location.hash, '#v=leaders');
});

test('home cards fall back to the scoreboard team leaders when box data is unavailable', async () => {
  const app = await boot({ hash: '', routes: { scoreboard: 'scoreboard' } });   // every summary 404s
  await app.settle(() => /failed to load/.test(app.$('#homeStatus').textContent));
  const fin = app.$$('#homeGames .gc')[0];
  assert.match(fin.querySelector('.pl').textContent, /PTS N\. Alexander-Walker 27/);
});

test('Games shows a grid of all games (from anywhere); a card opens its game; Back returns to the grid', async () => {
  const app = await boot();                                          // inside the live OKC@MIA game
  await app.settle(() => /^Live/.test(app.$('#status').textContent));
  assert.equal(app.$('#games').hidden, false);                       // header strip shows inside a game
  app.$('#navGame').click();
  await app.settle(() => app.$$('#gameList .gc').length === 7);
  assert.equal(app.window.location.hash, '#v=game');
  assert.equal(app.$('#gameView').dataset.mode, 'list');
  assert.equal(app.$('#games').hidden, true);                        // ...but not above the grid
  assert.equal(app.$('#navGame').getAttribute('aria-pressed'), 'true');
  assert.equal(app.calls.filter(c => c.key === 'summary:401910030').length >= 1, true);
  await app.settle(() => /updated/.test(app.$('#status').textContent)); // box data for the cards' top players
  assert.equal(app.$$('#gameList .gc')[0].querySelectorAll('.pl .who')[0].querySelectorAll('.pp').length, 3);
  app.$$('#gameList .gc').find(c => /DEN/.test(c.textContent)).click();
  await app.settle(() => /g=401910032/.test(app.window.location.hash) && /^Live/.test(app.$('#status').textContent));
  assert.equal(app.$('#gameView').dataset.mode, 'game');
  app.window.history.back();
  await app.settle(() => app.$('#gameView').dataset.mode === 'list' && app.window.location.hash === '#v=game');
});

test('a #v=game link opens the grid and never auto-picks a game', async () => {
  const app = await boot({ hash: '#v=game' });
  await app.settle(() => app.$$('#gameList .gc').length === 7 && /updated/.test(app.$('#status').textContent));
  assert.equal(app.calls.filter(c => c.key === 'summary:401910030').length, 1);   // only the shared box-data pass
  assert.equal(app.delays.some(d => d.fn === 'loadPBP'), false);
  assert.equal(app.window.location.hash, '#v=game');
});

test('box score: Game Score is right after GS', async () => {
  const app = await boot();
  await app.settle(() => app.$$('table.bx').length === 2);
  assert.deepEqual(Array.from(app.$('table.bx thead tr').children, th => th.textContent).slice(0, 4), ['Player', 'GS', 'GmSc', 'MIN']);
});

test('logo returns home; home cards open their game', async () => {
  const app = await boot();
  await app.settle(() => /^Live/.test(app.$('#status').textContent));
  app.$('#logo').click();
  assert.equal(app.$('#homeView').hidden, false);
  assert.equal(app.window.location.hash, '');
  const card = app.$$('#homeGames .gc').find(c => /DEN/.test(c.textContent));
  card.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await app.settle(() => /g=401910032/.test(app.window.location.hash) && /^Live/.test(app.$('#status').textContent));
});

test('leaderboard rows open their game (click or Enter); the player name still links out', async () => {
  const app = await boot({ hash: '#v=leaders' });
  await app.settle(() => app.$$('#leaders .card').length === 12);
  const row = app.$('#leaders .card li.go');                         // top scorer: Alexander-Walker, ATL vs DET (final)
  row.querySelector('a').click();                                     // name -> Basketball Reference, not the game
  assert.equal(app.$('#leadersView').hidden, false);
  assert.match(row.querySelector('a').href, /basketball-reference\.com/);
  row.querySelector('.sub').click();
  await app.settle(() => app.$('#status').textContent === 'Final.');
  assert.match(app.window.location.hash, /g=401910029/);
  app.window.history.back();                                          // Back returns to the leaderboard
  await app.settle(() => !app.$('#leadersView').hidden);
  const live = app.$$('#leaders .card li.go').find(li => /live/.test(li.textContent));
  live.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await app.settle(() => !app.$('#gameView').hidden && /^Live/.test(app.$('#status').textContent));
  // home's summary cards work the same way
  app.$('#logo').click();
  await app.settle(() => app.$$('#homeLeaders li.go').length > 0);
  app.$('#homeLeaders li.go .val').click();
  await app.settle(() => !app.$('#gameView').hidden);
});

test('top performers and home refresh every 5 minutes by default', async () => {
  const app = await boot({ hash: '#v=leaders' });
  await app.settle(() => app.delays.some(d => d.fn === 'loadLeaders'));
  assert.equal(app.delays.find(d => d.fn === 'loadLeaders').ms, 300000);
  assert.match(app.$('#ldStatus').textContent, /live games refresh every 5 min/);
});

test('settings migrate: old full saves pick up the new default; choices persist as differences', async () => {
  const old = { live: 10, box: 60, others: 60, leaders: 60, breaks: true, lite: true };   // pre-v2 save of the old defaults
  const ready = a => a.settle(() => /^Live/.test(a.$('#status').textContent)).then(() => a);
  let app = await ready(await boot({ storage: { 'nbapbp.settings': old } }));
  assert.equal(app.eval('settings.leaders'), 300);
  app = await ready(await boot({ storage: { 'nbapbp.settings': { v: 2, leaders: 60 } } }));        // an explicit choice of 1 min
  assert.equal(app.eval('settings.leaders'), 60);
  app = await ready(await boot({ storage: { 'nbapbp.settings': { ...old, leaders: 120, live: 20 } } }));
  assert.equal(app.eval('settings.leaders'), 120);
  app.$('#gear').click();
  const sel = app.$$('#setControls select')[0];
  sel.value = '30'; sel.dispatchEvent(new app.window.Event('change'));
  assert.deepEqual({ ...JSON.parse(app.window.localStorage.getItem('nbapbp.settings')) }, { v: 2, live: 30, leaders: 120 });
});

test('scoreboard failure on home shows the error, not "no games"', async () => {
  const app = await boot({ hash: '', routes: {} });
  await app.settle(() => /Couldn’t load scoreboard/.test(app.$('#homeStatus').textContent));
  assert.ok(app.$('#homeStatus').classList.contains('err'));
});
