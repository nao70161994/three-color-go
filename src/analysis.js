import { COLORS, pointsOnBoard } from './game.js';
import { simulate } from './agent.js';

const policies=['baseline','tactical'];
function validCount(n,name,max=5000) {
  if(!Number.isInteger(n)||n<1||n>max)throw new Error(name+' must be 1..'+max);
}
function winStats() {return Object.fromEntries(COLORS.map(c=>[c,0]));}
function round(n) {return Math.round(n*10000)/10000;}
function record(run) {
  return {
    version:1,radius:run.state.radius,mode:'local',seed:run.seed,
    strategies:run.strategies,actions:run.history.map(m=>m.pass?{type:'pass'}:{type:'play',q:m.q,r:m.r}),
    scores:run.state.scores,winners:run.state.winners,truncated:run.truncated
  };
}

/** Small deterministic, repeatable measurement: all 3 seats use the same policy. */
export function analyzeGames({games=300,seed=1,radius=3,maxTurns=400,strategy='tactical',samples=3}={}) {
  validCount(games,'games');validCount(samples+1,'samples+1',6);
  if(!policies.includes(strategy))throw new Error('Unknown strategy');
  // Validate radius before running games (also prevents surprises during batch work).
  const cells=pointsOnBoard(radius).length;
  if(!Number.isInteger(radius)||radius<2||radius>10)throw new Error('radius must be 2..10');
  const wins=winStats(),soleWins=winStats(),totalScore=winStats();
  let finished=0,truncated=0,ties=0,turns=0,occupancy=0;
  let captures=0,capturedStones=0,jointCaptures=0,passes=0;
  const records=[];
  for(let i=0;i<games;i++) {
    const run=simulate({seed:seed+i,radius,maxTurns,strategies:[strategy,strategy,strategy]});
    const h=run.history,s=run.state;
    if(run.truncated)truncated++;
    else {
      finished++;
      if(s.winners.length>1)ties++;
      for(const color of s.winners)wins[color]+=1/s.winners.length;
      if(s.winners.length===1)soleWins[s.winners[0]]++;
    }
    turns+=h.length;
    occupancy+=Object.keys(s.board).length/cells;
    for(const color of COLORS)totalScore[color]+=s.scores[color];
    for(const move of h) {
      if(move.pass)passes++;
      if(move.captured>0){captures++;capturedStones+=move.captured;}
      if(move.jointCapture)jointCaptures++;
    }
    if(records.length<samples)records.push(record(run));
  }
  return {
    kind:'same-policy',version:1,settings:{games,seed,radius,maxTurns,strategy,samples},
    finished,truncated,ties,averageTurns:round(turns/games),
    averageOccupancy:round(occupancy/games),captures,capturedStones,jointCaptures,passes,
    winShare:Object.fromEntries(COLORS.map(c=>[c,round(wins[c])])),
    winRate:Object.fromEntries(COLORS.map(c=>[c,finished?round(wins[c]/finished):null])),
    soleWins,averageScore:Object.fromEntries(COLORS.map(c=>[c,round(totalScore[c]/games)])),
    sampleRecords:records
  };
}

/** Rotating the tactical player through each seat reduces seat confounding. */
export function compareStrategies({rounds=30,seed=1,radius=3,maxTurns=400,samples=3}={}) {
  validCount(rounds,'rounds',1000);
  if(!Number.isInteger(samples)||samples<0||samples>5)throw new Error('samples must be 0..5');
  const seats=COLORS.map(color=>({color,games:0,finished:0,tacticalWinShare:0,soleTacticalWins:0}));
  let finished=0,truncated=0,ties=0,jointCaptures=0;
  const records=[];
  for(let roundIndex=0;roundIndex<rounds;roundIndex++) {
    for(let seat=0;seat<3;seat++) {
      const strategies=['baseline','baseline','baseline'];
      strategies[seat]='tactical';
      const gameSeed=seed+roundIndex*3+seat;
      const run=simulate({seed:gameSeed,radius,maxTurns,strategies});
      const stats=seats[seat];stats.games++;
      jointCaptures+=run.history.filter(m=>m.jointCapture).length;
      if(run.truncated)truncated++;
      else {
        finished++;stats.finished++;
        if(run.state.winners.length>1)ties++;
        if(run.state.winners.includes(COLORS[seat])) {
          stats.tacticalWinShare+=1/run.state.winners.length;
          if(run.state.winners.length===1)stats.soleTacticalWins++;
        }
      }
      if(records.length<samples)records.push(record(run));
    }
  }
  const winShare=seats.reduce((s,x)=>s+x.tacticalWinShare,0);
  return {
    kind:'rotated-matchup',version:1,
    settings:{rounds,games:rounds*3,seed,radius,maxTurns,samples,
      design:'one tactical versus two baseline; tactical rotates through all 3 seats'},
    finished,truncated,ties,jointCaptures,
    tacticalWinShare:round(winShare),
    tacticalWinRate:finished?round(winShare/finished):null,
    seats:seats.map(s=>({...s,tacticalWinShare:round(s.tacticalWinShare),
      tacticalWinRate:s.finished?round(s.tacticalWinShare/s.finished):null})),
    sampleRecords:records
  };
}
