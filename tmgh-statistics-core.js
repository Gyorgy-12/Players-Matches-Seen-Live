/* Pure aggregation shared by the offline pages and build-time tests. */
(() => {
  const metrics = ['goals', 'assists', 'yellow', 'red', 'secondYellow', 'penalties', 'penaltyGoals', 'penaltiesWon', 'penaltiesCaused', 'minutes'];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('hu').replace(/[^a-z0-9]+/g, ' ').trim();
  const compareNames = (a, b) => a.localeCompare(b, 'hu', { sensitivity: 'base', numeric: true });
  function aggregate(data, mode, filters = {}) {
    const playerMap = new Map(data.players.map(p => [p.id, p]));
    const eligibleMatches = data.matches.filter(m => (!filters.season || m.season === filters.season) && (!filters.competition || m.competition === filters.competition) && (!filters.match || m.id === filters.match));
    const matchIds = new Set(eligibleMatches.map(m => m.id));
    const groups = new Map();
    const init = (id, name) => ({ id, name, apps: 0, teams: new Set(), unknown: 0, missing: Object.fromEntries(metrics.map(k => [k, 0])), goalsAgainst: 0, difference: 0, wins: 0, draws: 0, losses: 0, awarded: 0, penaltiesAgainst: 0, ...Object.fromEntries(metrics.map(k => [k, 0])) });
    if (mode === 'players') {
      for (const a of data.appearances) {
        if (!matchIds.has(a.match) || (filters.team && a.team !== filters.team)) continue;
        const p = playerMap.get(a.player);
        if (!p) continue;
        if (!groups.has(p.id)) groups.set(p.id, init(p.id, p.name));
        const row = groups.get(p.id);
        row.apps++; row.teams.add(data.teams[a.team]); row.unknown += Number(!a.known);
        for (const k of metrics) { row[k] += Number(a[k]) || 0; row.missing[k] += Number(a[k] == null); }
      }
    } else {
      const events = new Map();
      for (const a of [...data.appearances, ...data.benchCards]) {
        const key = `${a.match}|${a.team}`;
        if (!events.has(key)) events.set(key, []);
        events.get(key).push(a);
      }
      const coverage = new Map(data.coverage.map(c => [c.match, c.complete]));
      for (const m of eligibleMatches) for (const side of ['home', 'away']) {
        const id = m[side];
        if (filters.team && filters.team !== id) continue;
        if (!groups.has(id)) groups.set(id, init(id, data.teams[id]));
        const row = groups.get(id), home = side === 'home';
        const scored = home ? m.goalsHome : m.goalsAway, conceded = home ? m.goalsAway : m.goalsHome;
        row.apps++; row.goals += scored; row.goalsAgainst += conceded; row.difference += scored - conceded;
        row.wins += Number(scored > conceded); row.draws += Number(scored === conceded); row.losses += Number(scored < conceded);
        row.unknown += Number(!coverage.get(m.id));
        let won = 0, attempts = 0;
        for (const a of events.get(`${m.id}|${id}`) || []) {
          for (const k of metrics.filter(k => k !== 'goals')) row[k] += Number(a[k]) || 0;
          won += Number(a.penaltiesWon) || 0; attempts += Number(a.penalties) || 0;
        }
        // Handball penalties may have no credited winner. Never count an
        // attempt and its attributed winner as two different awards.
        row.awarded += Math.max(won, attempts);
        const opponentEvents = events.get(`${m.id}|${home ? m.away : m.home}`) || [];
        row.penaltiesAgainst += Math.max(opponentEvents.reduce((n, a) => n + (Number(a.penaltiesWon) || 0), 0), opponentEvents.reduce((n, a) => n + (Number(a.penalties) || 0), 0));
      }
    }
    const query = normalize(filters.query);
    const key = filters.sort || 'goals', direction = filters.direction === 'asc' ? 1 : -1;
    let rows = [...groups.values()].filter(r => (!query || normalize(r.name).includes(query)) && r.apps >= (Number(filters.minApps) || 1) && (mode !== 'players' || r[key] > 0));
    rows.sort((a, b) => direction * (a[key] - b[key]) || b.apps - a.apps || compareNames(a.name, b.name) || compareNames(a.id, b.id));
    return rows.map(r => ({ ...r, teams: [...r.teams].sort(compareNames) }));
  }
  globalThis.TMGHStatistics = { aggregate, normalize, compareNames, metrics };
})();
