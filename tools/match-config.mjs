export const matchConfigs = {
  '4914561': { gameId: '4914561', date: '2026-10-08', score: '1:3', round: 'Matchday 4', home: { id: '7769', name: 'CFR Cluj' }, away: { id: '6429', name: 'U Cluj' }, stadium: 'Dr. Constantin Rădulescu' },
  '4914525': { gameId: '4914525', date: '2026-10-12', score: '3:4', round: 'Matchday 11', home: { id: '6429', name: 'U Cluj' }, away: { id: '455', name: 'FC Rapid' }, stadium: 'Cluj Arena' },
};
export const config = matchConfigs[process.env.TMGH_GAME || '4914525'];
if (!config) throw new Error('Ismeretlen mérkőzésazonosító');
