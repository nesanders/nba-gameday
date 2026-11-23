// Trim raw API responses down to the fields index.html reads, so fixtures stay small.
//   node test/make-fixtures.mjs <name>=<raw.json> [...]
//   e.g. node test/make-fixtures.mjs summary-final=raw/sum_401910029.json scoreboard=raw/sb.json
// A raw file whose top level has `events` is treated as a scoreboard, otherwise as a summary.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pick = (o, keys) => (o == null ? o : Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])));
const team = t => pick(t, ['id', 'abbreviation', 'displayName', 'shortDisplayName', 'name', 'color', 'alternateColor']);
const status = s => s && { ...pick(s, ['displayClock', 'period']), type: pick(s.type, ['state', 'completed', 'detail', 'shortDetail']) };
const competitor = c => ({ ...pick(c, ['id', 'homeAway', 'score', 'winner']), team: team(c.team),
  ...(c.linescores ? { linescores: c.linescores.map(l => pick(l, ['displayValue', 'value', 'period'])) } : {}) });

function scoreboard(d) {
  return { day: d.day, events: d.events.map(e => ({ ...pick(e, ['id', 'date', 'shortName']), status: status(e.status),
    competitions: e.competitions.map(c => ({ competitors: c.competitors.map(competitor), status: status(c.status) })) })) };
}

function summary(d) {
  const b = d.boxscore || {};
  return {
    header: { competitions: d.header.competitions.map(c => ({ competitors: c.competitors.map(competitor), status: status(c.status) })) },
    boxscore: {
      teams: (b.teams || []).map(t => ({ homeAway: t.homeAway, team: team(t.team), statistics: t.statistics.map(s => pick(s, ['name', 'displayValue'])) })),
      players: (b.players || []).map(tp => ({ team: team(tp.team), statistics: tp.statistics.map(s => ({
        ...pick(s, ['names', 'keys', 'labels', 'totals']),
        athletes: s.athletes.map(a => ({ ...pick(a, ['starter', 'didNotPlay', 'reason', 'ejected', 'stats']),
          athlete: { ...pick(a.athlete, ['id', 'displayName', 'shortName']), position: pick(a.athlete.position, ['abbreviation']) } })),
      })) })),
    },
    plays: (d.plays || []).map(p => pick(p, ['id', 'sequenceNumber', 'type', 'text', 'awayScore', 'homeScore', 'period', 'clock',
      'scoringPlay', 'scoreValue', 'team', 'participants', 'shootingPlay'])).map(p => ({ ...p, type: pick(p.type, ['id', 'text']),
      period: pick(p.period, ['number']), clock: pick(p.clock, ['displayValue']) })),
  };
}

mkdirSync(OUT, { recursive: true });
for (const arg of process.argv.slice(2)) {
  const [name, file] = arg.split('=');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const out = raw.events ? scoreboard(raw) : summary(raw);
  const json = JSON.stringify(out);
  writeFileSync(join(OUT, name + '.json'), json + '\n');
  console.log(name.padEnd(22), (readFileSync(file).length / 1024).toFixed(0).padStart(5), 'KB ->', (json.length / 1024).toFixed(0).padStart(4), 'KB');
}
