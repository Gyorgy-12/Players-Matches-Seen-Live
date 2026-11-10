export const matchConfigs = {
  '4921829': { gameId: '4921829', date: '2026-11-08', score: '1:0', round: 'Matchday 14', competition: 'Danish Superliga', home: { id: '190', name: 'FC Copenhagen' }, away: { id: '206', name: 'Brøndby IF' }, stadium: 'Parken', city: 'Copenhagen', country: 'Denmark', leagueId: 'DK1', cutoff: '2026-11-01', attendance: 34348, attendanceUrl: 'https://www.fck.dk/nyhed/kampreferat-clems-droemmemaal-afgjorde-derby-efter-staerk-holdindsats' },
  '4914583': { gameId: '4914583', date: '2026-11-02', score: '1:0', round: 'Matchday 14', home: { id: '6429', name: 'U Cluj' }, away: { id: '301', name: 'FCSB' }, stadium: 'Cluj Arena', cutoff: '2026-11-01' },
  '5059965': { gameId: '5059965', date: '2026-10-28', score: '1:3', round: 'Group B · Matchday 2', competition: 'Romanian Cup', home: { id: '7769', name: 'CFR Cluj' }, away: { id: '6429', name: 'U Cluj' }, stadium: 'Dr. Constantin Rădulescu', cutoff: '2026-10-15' },
  '4914561': { gameId: '4914561', date: '2026-10-08', score: '1:3', round: 'Matchday 4', home: { id: '7769', name: 'CFR Cluj' }, away: { id: '6429', name: 'U Cluj' }, stadium: 'Dr. Constantin Rădulescu' },
  '4914525': { gameId: '4914525', date: '2026-10-12', score: '3:4', round: 'Matchday 11', home: { id: '6429', name: 'U Cluj' }, away: { id: '455', name: 'FC Rapid' }, stadium: 'Cluj Arena' },
  '4914606': { gameId: '4914606', date: '2026-10-19', score: '2:2', round: 'Matchday 12', home: { id: '6429', name: 'U Cluj' }, away: { id: '41278', name: 'FC Arges' }, stadium: 'Cluj Arena' },
  '4914732': { gameId: '4914732', date: '2026-10-25', score: '2:2', round: 'Matchday 13', home: { id: '7769', name: 'CFR Cluj' }, away: { id: '312', name: 'FC Dinamo' }, stadium: 'Dr. Constantin Rădulescu', cutoff: '2026-10-15' },
};
export const config = matchConfigs[process.env.TMGH_GAME || '4921829'];
if (!config) throw new Error('Ismeretlen mérkőzésazonosító');
