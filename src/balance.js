import { COLORS, createGame, pass, play, pointsOnBoard, scores } from './game.js';
import { simulate } from './agent.js';

const POLICIES=['baseline','tactical','guarded','balanced'];
const r4=n=>Math.round(n*10000)/10000;
function validInt(x,label,lo,hi) {
  if(!Number.isSafeInteger(x)||x<lo||x>hi)throw Error(label+' must be '+lo+'..'+hi);
}
function checkOptions({rounds,seed,radius,maxTurns,samples}) {
  validInt(rounds,'rounds',1,500);
  validInt(seed,'seed',0,4294967295);
  validInt(radius,'radius',2,5);
  validInt(maxTurns,'maxTurns',1,2000);
  validInt(samples,'samples',0,5);
}
function share(winners,player) {
  return winners.includes(player)?1/winners.length:0;
}
function sample(run) {
  return {version:1,radius:run.state.radius,mode:'local',seed:run.seed,
    strategies:run.strategies,actions:run.history.map(h=>h.pass?{type:'pass'}:{type:'play',q:h.q,r:h.r}),
    scores:run.state.scores,winners:run.state.winners,truncated:run.truncated};
}
function metrics(run) {
  const cells=pointsOnBoard(run.state.radius).length;
  let replay=createGame(run.state.radius),lastLeader=null,leadChanges=0;
  let captures=0,capturedStones=0,jointCaptures=0,passes=0;
  let noCaptureLastThird=0,lastThird=0;
  for(let i=0;i<run.history.length;i++){
    const h=run.history[i];
    const result=h.pass?pass(replay):play(replay,h.q,h.r);
    if(!result.ok)throw Error('Invalid simulated record at move '+i);
    replay=result.state;
    if(h.pass)passes++;
    if(h.captured>0){captures++;capturedStones+=h.captured;}
    if(h.jointCapture)jointCaptures++;
    if(i>=Math.floor(run.history.length*2/3) && !h.pass) {
      lastThird++;
      if(!h.captured)noCaptureLastThird++;
    }
    const score=scores(replay), max=Math.max(...Object.values(score));
    const leaders=COLORS.filter(c=>score[c]===max);
    if(leaders.length===1) {
      if(lastLeader!==null && lastLeader!==leaders[0])leadChanges++;
      lastLeader=leaders[0];
    }
  }
  const vals=Object.values(run.state.scores).sort((a,b)=>b-a);
  if(JSON.stringify(replay.board)!==JSON.stringify(run.state.board))
    throw Error('Replay mismatch');
  return {
    turns:run.history.length,captures,capturedStones,jointCaptures,passes,leadChanges,
    lastThirdQuietFraction:lastThird?noCaptureLastThird/lastThird:null,
    occupancy:Object.keys(run.state.board).length/cells,finalMargin:vals[0]-vals[1],
    nearlyFull:Object.keys(run.state.board).length/cells>=.8
  };
}

/** Same-policy seats. The win-rate is a measure of this bot's positional bias. */
export function analyzeBalance({rounds=90,seed=20261031,radius=3,maxTurns=400,samples=3,policy='balanced'}={}) {
  checkOptions({rounds,seed,radius,maxTurns,samples});
  if(!POLICIES.includes(policy))throw Error('Invalid policy');
  const seats=COLORS.map(color=>({color,soleWins:0,winShare:0}));
  const totals={finished:0,truncated:0,ties:0,turns:0,captures:0,capturedStones:0,
    jointCaptures:0,passes:0,leadChanges:0,occupancy:0,finalMargin:0,
    nearlyFull:0,quietLastThird:0,quietSamples:0};
  const records=[];
  for(let i=0;i<rounds;i++){
    const run=simulate({radius,seed:seed+i,maxTurns,strategies:[policy,policy,policy]});
    const m=metrics(run);
    if(records.length<samples)records.push(sample(run));
    for(const key of ['turns','captures','capturedStones','jointCaptures','passes','leadChanges','occupancy'])
      totals[key]+=m[key];
    if(m.lastThirdQuietFraction!==null){totals.quietLastThird+=m.lastThirdQuietFraction;totals.quietSamples++;}
    if(run.truncated)totals.truncated++;
    else {
      totals.finished++;
      if(run.state.winners.length>1)totals.ties++;
      totals.finalMargin+=m.finalMargin;
      if(m.nearlyFull)totals.nearlyFull++;
      for(let seat=0;seat<3;seat++){
        const s=seats[seat],color=COLORS[seat];
        s.winShare+=share(run.state.winners,color);
        if(run.state.winners.length===1 && run.state.winners[0]===color)s.soleWins++;
      }
    }
  }
  return {
    kind:'balance-selfplay',version:1,settings:{rounds,seed,radius,maxTurns,samples,policy},
    finished:totals.finished,truncated:totals.truncated,ties:totals.ties,
    seats:seats.map(s=>({...s,winShare:r4(s.winShare),
      winRate:totals.finished?r4(s.winShare/totals.finished):null})),
    averages:{
      turns:r4(totals.turns/rounds),occupancy:r4(totals.occupancy/rounds),
      leadChanges:r4(totals.leadChanges/rounds),
      finalMargin:totals.finished?r4(totals.finalMargin/totals.finished):null,
      lastThirdNonCaptureFraction:totals.quietSamples?r4(totals.quietLastThird/totals.quietSamples):null
    },
    highOccupancyFraction:totals.finished?r4(totals.nearlyFull/totals.finished):null,
    captures:totals.captures,capturedStones:totals.capturedStones,
    jointCaptures:totals.jointCaptures,passes:totals.passes,sampleRecords:records,
    caveat:'High occupancy and quiet final moves are PROXIES for repetitive play, not proof of boredom. Same-bot winning shares are not human player statistics.'
  };
}

/** Compare one challenger with two opponents and rotate it through all seats. */
export function comparePolicies({rounds=30,seed=20261031,radius=3,maxTurns=400,samples=3,
  challenger='balanced',opponent='guarded'}={}) {
  checkOptions({rounds,seed,radius,maxTurns,samples});
  if(!POLICIES.includes(challenger)||!POLICIES.includes(opponent)||challenger===opponent)
    throw Error('Two different known policies required');
  const seats=COLORS.map(color=>({color,games:0,finished:0,winShare:0,soleWins:0}));
  let finished=0,truncated=0,ties=0,turns=0,jointCaptures=0;
  const records=[];
  for(let round=0;round<rounds;round++){
    for(let seat=0;seat<3;seat++){
      const strategies=[opponent,opponent,opponent];
      strategies[seat]=challenger;
      const run=simulate({radius,seed:seed+round*3+seat,maxTurns,strategies});
      const m=metrics(run);
      const s=seats[seat];s.games++;turns+=m.turns;jointCaptures+=m.jointCaptures;
      if(records.length<samples)records.push(sample(run));
      if(run.truncated)truncated++;
      else {
        s.finished++;finished++;
        if(run.state.winners.length>1)ties++;
        s.winShare+=share(run.state.winners,COLORS[seat]);
        if(run.state.winners.length===1 && run.state.winners[0]===COLORS[seat])s.soleWins++;
      }
    }
  }
  const total=seats.reduce((sum,s)=>sum+s.winShare,0);
  return {
    kind:'rotated-policy-matchup',version:1,
    settings:{rounds,games:rounds*3,seed,radius,maxTurns,samples,challenger,opponent},
    finished,truncated,ties,averageTurns:r4(turns/(rounds*3)),jointCaptures,
    challengerWinShare:r4(total),challengerWinRate:finished?r4(total/finished):null,
    seats:seats.map(s=>({...s,winShare:r4(s.winShare),
      winRate:s.finished?r4(s.winShare/s.finished):null})),
    sampleRecords:records,caveat:'Seeded AI-versus-AI comparison, not an Elo rating or human win-rate.'
  };
}
