#!/usr/bin/env node
/**
 * Independent LARGE-BOARD strength and inference-cost test of frozen elite AIs.
 * All six seat permutations: Attention50k, GNN64 50k, PV2 122.4k.
 * Exactly the same greedy production policy / unchanged stone-scoring engine.
 * Unfinished games are CENSORED and excluded from any winning statistic.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {COLORS,createGame,play,pass,pointsOnBoard,scores,winner} from '../src/game.js';
import {chooseEliteMove,ELITE_LEVELS,getEliteModel} from '../src/elite-models.js';

const IDS=['elite-attn64-50000','elite-gnn64-50000','elite-pv2-122400'];
const ORDERS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const [radiusArg,out,maxSecondsArg]=process.argv.slice(2);
const radius=Number(radiusArg),maxSeconds=Number(maxSecondsArg??900);
if(!Number.isInteger(radius)||radius<2||radius>12||
   !out||!Number.isFinite(maxSeconds)||maxSeconds<10||maxSeconds>1800)
  throw Error('Usage: node scripts/benchmark-attention-large-board.mjs RADIUS OUT [MAX_SECONDS_PER_GAME]');
for(const id of IDS){if(!ELITE_LEVELS.includes(id))throw Error('Missing elite model '+id);getEliteModel(id);}
const cells=pointsOnBoard(radius).length;
const maxTurns=cells*4+3;
const games=[];
function summarize(){
  const finished=games.filter(g=>g.ended);
  const byModel={};
  for(const id of IDS){
    const exposures=games.flatMap(g=>g.seats.map((seat,i)=>({g,seat,index:i}))).filter(x=>x.seat===id);
    const completed=exposures.filter(x=>x.g.ended);
    const winShares=completed.map(x=>x.g.winnerColors.includes(COLORS[x.index])?
      1/x.g.winnerColors.length:0);
    const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
    byModel[id]={
      seatExposures:exposures.length,finishedSeatExposures:completed.length,
      finishedWinShare:mean(winShares),
      finishedStoneShare:mean(completed.map(x=>x.g.stoneShare[x.index])),
      observedStoneShare:mean(exposures.map(x=>x.g.stoneShare[x.index])),
      totalMoves:exposures.reduce((s,x)=>s+x.g.timedMoves[x.index],0),
      meanInferenceMs:exposures.reduce((s,x)=>s+x.g.timedMs[x.index],0)/
        Math.max(1,exposures.reduce((s,x)=>s+x.g.timedMoves[x.index],0)),
      earlyPasses:exposures.reduce((s,x)=>s+x.g.earlyPasses[x.index],0)
    };
  }
  return {version:1,method:'six seat-balanced greedy production elite policies; natural terminal only',
    radius,cells,maxTurns,maxSecondsPerGame:maxSeconds,models:IDS,
    gamesPlayed:games.length,finished:finished.length,censored:games.length-finished.length,
    byModel,games};
}
function persist(){
  mkdirSync(dirname(out),{recursive:true});
  writeFileSync(out,JSON.stringify(summarize(),null,2)+'\n');
}
for(const indices of ORDERS){
  const seats=indices.map(i=>IDS[i]);
  let state=createGame(radius),turns=0,reason='natural_end';
  const timedMs=[0,0,0],timedMoves=[0,0,0],earlyPasses=[0,0,0],passes=[0,0,0];
  const start=performance.now();
  while(!state.ended && turns<maxTurns){
    if((performance.now()-start)/1000>=maxSeconds){reason='time_cap';break;}
    const seat=state.turn,t0=performance.now();
    const move=chooseEliteMove(state,seats[seat]);
    timedMs[seat]+=performance.now()-t0;timedMoves[seat]++;
    if(move===null){passes[seat]++;if(turns<6)earlyPasses[seat]++;}
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Illegal production elite move: '+seats[seat]+' '+result.reason);
    state=result.state;turns++;
  }
  if(!state.ended&&reason==='natural_end')reason='turn_cap';
  const byColor=scores(state);
  const stones=COLORS.map(color=>byColor[color]),total=stones.reduce((a,b)=>a+b,0);
  const g={seats,ended:state.ended,censorReason:state.ended?null:reason,
    turns,seconds:(performance.now()-start)/1000,
    stones,stoneShare:stones.map(n=>total?n/total:1/3),
    winnerColors:state.ended?winner(state):[],timedMs,timedMoves,earlyPasses,passes};
  games.push(g);
  persist();
  console.log(JSON.stringify({radius,seats,ended:g.ended,reason:g.censorReason,
    turns:g.turns,seconds:Math.round(g.seconds),stones,winnerColors:g.winnerColors}));
}
const summary=summarize();
if(summary.gamesPlayed!==6)throw Error('Missing seat permutation');
for(const id of IDS)if(summary.byModel[id].seatExposures!==6)
  throw Error('Unbalanced seat exposures: '+id);
console.log(JSON.stringify({radius,cells,finished:summary.finished,censored:summary.censored,
  byModel:summary.byModel}));
