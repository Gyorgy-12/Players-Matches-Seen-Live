export const matchConfigs = {
  '4914561': { gameId: '4914561', date: '2026-10-08', score: '1:3', round: 'Matchday 4', home: { id: '7769', name: 'CFR Cluj' }, away: { id: '6429', name: 'U Cluj' }, stadium: 'Dr. Constantin Rădulescu' },
  '4914525': { gameId: '4914525', date: '2026-10-12', score: '3:4', round: 'Matchday 11', home: { id: '6429', name: 'U Cluj' }, away: { id: '455', name: 'FC Rapid' }, stadium: 'Cluj Arena' },
  '4914606': { gameId: '4914606', date: '2026-10-19', score: '2:2', round: 'Matchday 12', home: { id: '6429', name: 'U Cluj' }, away: { id: '41278', name: 'FC Arges' }, stadium: 'Cluj Arena' },
  '4914732': { gameId: '4914732', date: '2026-10-25', score: '2:2', round: 'Matchday 13', home: { id: '7769', name: 'CFR Cluj' }, away: { id: '312', name: 'FC Dinamo' }, stadium: 'Dr. Constantin Rădulescu', cutoff: '2026-10-15' },
};
export const config = matchConfigs[process.env.TMGH_GAME || '4914732'];
if (!config) throw new Error('Ismeretlen mérkőzésazonosító');
