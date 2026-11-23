// Builds the season data files served next to index.html:
//   data/season-best.json     the top TOP games for every sortable column (small; loaded when the Season tab opens)
//   data/season-games.json    every player-game and team-game row (loaded only when filtering best games)
//   data/season-players.json  season totals per player (per-game leaders)
// Incremental: games already in data/season-games.json are never fetched again. Run nightly by
// .github/workflows/season-data.yml; locally: `node scripts/build-season.mjs`. No dependencies (Node 20+).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
export const TOP = 50;

// ---------------------------------------------------------------- row layouts (shared with index.html)
export const PCOLS = ['g', 'p', 't', 'o', 'home', 'gs', 'min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta',
  'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm'];
// team rows carry the opponent's possession inputs so ratings work without the opponent's row
export const TCOLS = ['g', 't', 'o', 'home', 'min', 'pts', 'opp', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta',
  'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'ofgm', 'ofga', 'ofta', 'oorb', 'odrb', 'otov'];
const SUMS = ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm'];
export const SCOLS = ['p', 't', 'gp', 'gs', ...SUMS, 'gmsc'];

const obj = (cols, r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]));
const div = (a, b) => (b > 0 ? a / b : null);

// ---------------------------------------------------------------- metrics (index.html has identical copies; a test compares them)
// best: -1 = higher is better, 1 = lower is better. q: rows that may rank (others sort last).
export const PMETRICS = {
  gmsc: { best: -1, v: r => r.pts + 0.4 * r.fgm - 0.7 * r.fga - 0.4 * (r.fta - r.ftm) + 0.7 * r.orb + 0.3 * r.drb + r.stl + 0.7 * r.ast + 0.7 * r.blk - 0.4 * r.pf - r.tov },
  min: { best: -1, v: r => r.min }, pts: { best: -1, v: r => r.pts }, reb: { best: -1, v: r => r.orb + r.drb },
  ast: { best: -1, v: r => r.ast }, stl: { best: -1, v: r => r.stl }, blk: { best: -1, v: r => r.blk },
  tov: { best: -1, v: r => r.tov }, fgm: { best: -1, v: r => r.fgm + r.fga / 1000 }, tpm: { best: -1, v: r => r.tpm + r.tpa / 1000 },
  ftm: { best: -1, v: r => r.ftm + r.fta / 1000 }, pm: { best: -1, v: r => r.pm },
  ts: { best: -1, v: r => (r.fga + 0.44 * r.fta >= 10 ? (100 * r.pts) / (2 * (r.fga + 0.44 * r.fta)) : null) },
};
const poss = r => r.fga + 0.4 * r.fta - 1.07 * (div(r.orb, r.orb + r.odrb) || 0) * (r.fga - r.fgm) + r.tov;
const oposs = r => r.ofga + 0.4 * r.ofta - 1.07 * (div(r.oorb, r.oorb + r.drb) || 0) * (r.ofga - r.ofgm) + r.otov;
const gameposs = r => 0.5 * (poss(r) + oposs(r));
export const TMETRICS = {
  pts: { best: -1, v: r => r.pts }, opp: { best: 1, v: r => r.opp }, mar: { best: -1, v: r => r.pts - r.opp },
  ortg: { best: -1, v: r => (100 * r.pts) / gameposs(r) }, drtg: { best: 1, v: r => (100 * r.opp) / gameposs(r) },
  pace: { best: -1, v: r => (48 * gameposs(r)) / (r.min / 5) },
  fgp: { best: -1, v: r => (100 * r.fgm) / r.fga }, tpm: { best: -1, v: r => r.tpm }, tpp: { best: -1, v: r => (r.tpa >= 15 ? (100 * r.tpm) / r.tpa : null) },
  ast: { best: -1, v: r => r.ast }, reb: { best: -1, v: r => r.orb + r.drb }, tov: { best: 1, v: r => r.tov },
  stl: { best: -1, v: r => r.stl }, blk: { best: -1, v: r => r.blk },
};

// indices of the rows that are in the top n by any metric (ties at the cut included)
export function topUnion(rows, cols, metrics, n = TOP) {
  const keep = new Set();
  const os = rows.map(r => obj(cols, r));
  for (const m of Object.values(metrics)) {
    const vals = os.map((o, i) => [m.v(o), i]).filter(([v]) => v != null && Number.isFinite(v)).sort((a, b) => m.best * (a[0] - b[0]));
    if (!vals.length) continue;
    const cut = vals[Math.min(n, vals.length) - 1][0];
    for (const [v, i] of vals) { if (m.best * (v - cut) > 0) break; keep.add(i); }
  }
  return [...keep].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- box score parsing
function parsePlayers(tp) {
  const st = tp.statistics?.[0] || {};
  const labels = (st.labels || st.names || []).map(x => String(x).toUpperCase());
  const keys = st.keys || [];
  const idx = (lab, key) => { const i = labels.indexOf(lab); return i >= 0 ? i : keys.indexOf(key); };
  const I = { min: idx('MIN', 'minutes'), pts: idx('PTS', 'points'), fg: idx('FG', 'fieldGoalsMade-fieldGoalsAttempted'),
    tp: idx('3PT', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'), ft: idx('FT', 'freeThrowsMade-freeThrowsAttempted'),
    orb: idx('OREB', 'offensiveRebounds'), drb: idx('DREB', 'defensiveRebounds'), ast: idx('AST', 'assists'), stl: idx('STL', 'steals'),
    blk: idx('BLK', 'blocks'), tov: idx('TO', 'turnovers'), pf: idx('PF', 'fouls'), pm: idx('+/-', 'plusMinus') };
  return (st.athletes || []).filter(a => !a.didNotPlay && a.stats?.length).map(a => {
    const s = a.stats, num = i => { const v = parseFloat(i < 0 ? '' : s[i]); return Number.isFinite(v) ? v : 0; };
    const pair = i => String(i < 0 ? '' : s[i]).split('-').map(x => +x || 0);
    const [fgm, fga] = pair(I.fg), [tpm, tpa] = pair(I.tp), [ftm, fta] = pair(I.ft);
    return { id: String(a.athlete?.id), name: a.athlete?.displayName || '?', short: a.athlete?.shortName || a.athlete?.displayName || '?',
      gs: a.starter ? 1 : 0, min: num(I.min), pts: num(I.pts), fgm, fga, tpm, tpa, ftm, fta, orb: num(I.orb), drb: num(I.drb),
      ast: num(I.ast), stl: num(I.stl), blk: num(I.blk), tov: num(I.tov), pf: num(I.pf), pm: num(I.pm) };
  }).filter(p => p.min > 0);
}

export const emptyState = season => ({ v: 1, season, through: null, teams: [], players: [], games: [], pcols: PCOLS, rows: [], tcols: TCOLS, trows: [] });

// Add one final game's summary to the state. date: YYYY-MM-DD (ET game day); id: the ESPN event id.
export function addGame(S, s, date, id) {
  const comp = s.header?.competitions?.[0] || {};
  id = String(id);
  if (S.games.some(g => g[0] === id)) return false;
  const teamIdx = abbr => { let i = S.teams.indexOf(abbr); if (i < 0) { i = S.teams.length; S.teams.push(abbr); } return i; };
  const pIdx = new Map(S.players.map((p, i) => [p[0], i]));
  const playerIdx = p => { let i = pIdx.get(p.id); if (i == null) { i = S.players.length; S.players.push([p.id, p.name, p.short]); pIdx.set(p.id, i); } return i; };
  const cs = comp.competitors || [];
  const side = ha => cs.find(c => c.homeAway === ha);
  const away = side('away'), home = side('home');
  const periods = Math.max(4, ...cs.map(c => c.linescores?.length || 0));
  const g = S.games.length;
  const teams = (s.boxscore?.players || []).map(tp => {
    const abbr = tp.team?.abbreviation, c = cs.find(x => String(x.team?.id) === String(tp.team?.id));
    const ps = parsePlayers(tp);
    const tstat = (s.boxscore?.teams || []).find(x => String(x.team?.id) === String(tp.team?.id))?.statistics || [];
    const teamTov = +(tstat.find(x => x.name === 'teamTurnovers')?.displayValue) || 0;
    const tot = Object.fromEntries(SUMS.map(k => [k, ps.reduce((a, p) => a + p[k], 0)]));
    tot.tov += teamTov;
    return { abbr, home: c?.homeAway === 'home' ? 1 : 0, pts: +c?.score || tot.pts, ps, tot };
  });
  if (teams.length !== 2 || !teams.every(t => t.ps.length)) return false;
  S.games.push([id, date, teamIdx(away?.team?.abbreviation), teamIdx(home?.team?.abbreviation), +away?.score || 0, +home?.score || 0, periods]);
  const gameMin = 5 * (48 + 5 * (periods - 4));
  for (const [T, O] of [[teams[0], teams[1]], [teams[1], teams[0]]]) {
    const t = teamIdx(T.abbr), o = teamIdx(O.abbr);
    for (const p of T.ps) S.rows.push([g, playerIdx(p), t, o, T.home, p.gs, ...PCOLS.slice(6).map(k => p[k])]);
    const a = T.tot, b = O.tot;
    S.trows.push([g, t, o, T.home, gameMin, T.pts, O.pts, a.fgm, a.fga, a.tpm, a.tpa, a.ftm, a.fta, a.orb, a.drb, a.ast, a.stl, a.blk, a.tov, a.pf,
      b.fgm, b.fga, b.fta, b.orb, b.drb, b.tov]);
  }
  return true;
}

// Re-index a subset of rows so the small file only carries the players/games it uses.
function subset(S, keepRows, keepTrows) {
  const gMap = new Map(), pMap = new Map(), games = [], players = [];
  const gi = g => { if (!gMap.has(g)) { gMap.set(g, games.length); games.push(S.games[g]); } return gMap.get(g); };
  const pi = p => { if (!pMap.has(p)) { pMap.set(p, players.length); players.push(S.players[p]); } return pMap.get(p); };
  const rows = keepRows.map(i => { const r = S.rows[i].slice(); r[0] = gi(r[0]); r[1] = pi(r[1]); return r; });
  const trows = keepTrows.map(i => { const r = S.trows[i].slice(); r[0] = gi(r[0]); return r; });
  return { ...S, players, games, rows, trows };
}

// The three output files from the full state.
export function outputs(S, updated = new Date().toISOString()) {
  const full = { ...S, updated };
  const best = { ...subset(S, topUnion(S.rows, PCOLS, PMETRICS), topUnion(S.trows, TCOLS, TMETRICS)), updated, top: TOP };
  const teamGames = S.teams.map((_, t) => S.trows.filter(r => r[1] === t).length);
  const agg = new Map();
  for (const r of S.rows) {
    const o = obj(PCOLS, r);
    let a = agg.get(o.p);
    if (!a) agg.set(o.p, (a = { p: o.p, t: o.t, gp: 0, gs: 0, gmsc: 0, ...Object.fromEntries(SUMS.map(k => [k, 0])) }));
    a.t = o.t; a.gp++; a.gs += o.gs; a.gmsc += PMETRICS.gmsc.v(o);
    for (const k of SUMS) a[k] += o[k];
  }
  const totals = [...agg.values()].map(a => SCOLS.map(k => (k === 'gmsc' ? Math.round(a.gmsc * 10) / 10 : a[k])));
  const players = { v: 1, season: S.season, through: S.through, updated, teams: S.teams, teamGames, players: S.players, cols: SCOLS, rows: totals };
  return { 'season-games.json': full, 'season-best.json': best, 'season-players.json': players };
}

// ---------------------------------------------------------------- network (CLI only)
async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(res => setTimeout(res, 2000 * i));
    }
  }
}
const ymd = d => d.replaceAll('-', '');
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

async function main() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  await mkdir(dir, { recursive: true });
  const sb = await getJSON(API + '/scoreboard');
  const league = sb.leagues?.[0] || {};
  const season = league.season?.year;
  const reg = await getJSON(`${CORE}/seasons/${season}/types/2`);
  const start = reg.startDate.slice(0, 10), end = reg.endDate.slice(0, 10), today = etToday();
  let S;
  try { S = JSON.parse(await readFile(join(dir, 'season-games.json'), 'utf8')); } catch { S = null; }
  if (!S || S.season !== season || S.v !== 1) S = emptyState(season);
  const days = (league.calendar || []).map(d => (typeof d === 'string' ? d : d.startDate).slice(0, 10))
    .filter(d => d >= start && d <= end && d <= today && (!S.through || d >= S.through));
  console.log(`season ${season}: ${S.games.length} games stored, checking ${days.length} day(s) from ${days[0] || '-'}`);
  let added = 0, through = S.through;
  for (const day of days) {
    const board = await getJSON(`${API}/scoreboard?dates=${ymd(day)}`);
    const events = (board.events || []).filter(e => e.season?.type === 2);
    const todo = events.filter(e => e.status?.type?.completed && !S.games.some(g => g[0] === String(e.id)));
    for (const e of todo) {
      const s = await getJSON(`${API}/summary?event=${e.id}`);
      if (addGame(S, s, day, e.id)) added++;
      else console.warn('skipped', e.id, e.shortName, '(no box score)');
    }
    // `through`: the last day whose games are all settled (final, postponed or cancelled); the next run starts there
    if (events.every(e => e.status?.type?.state === 'post')) through = day;
    else break;
  }
  S.through = through;
  console.log(`added ${added} game(s); through ${through}; ${S.games.length} games, ${S.rows.length} player rows`);
  if (!added) { console.log('nothing new; files unchanged'); return; }
  for (const [name, data] of Object.entries(outputs(S))) {
    const json = JSON.stringify(data);
    await writeFile(join(dir, name), json + '\n');
    console.log(`${name.padEnd(20)} ${(json.length / 1024).toFixed(0)} KB`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
