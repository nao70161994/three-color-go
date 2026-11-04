#!/usr/bin/env node
/**
 * Cross-architecture head-to-head evaluation on frozen 2k-step checkpoints.
 *
 * Full three-player evaluation: all six colour/seat permutations of A/B/C.
 * Pairwise evaluation: A,A,B plus A,B,B with the singleton rotated across
 * all three seats. Both compositions are essential: with only A,A,B, "A"
 * would get twice the chance to win simply because it controls two seats.
 *
 * Each kind is scored PER SEAT EXPOSURE, never pooling two controlled seats'
 * points into one player. Every fixture is sampled with independent per-seat
 * PRNGs; no game is forced to end. Unfinished outcomes remain censored.
 *
 * Attn/GNN models are frozen. Does not alter production CPU or checkpoints.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {COLORS,createGame,play,pass,pointsOnBoard,scores,winner} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {selectComparisonMove,validateComparisonModel,COMPARISON_ARCHS} from '../src/architecture-comparison.js';

const KINDS=Object.keys(COMPARISON_ARCHS);
const PAIRS=[['gnn16','gnn64'],['gnn16','attn64'],['gnn64','attn64']];
const PERMUTATIONS=[
  ['gnn16','gnn64','attn64'],
  ['gnn16','attn64','gnn64'],
  ['gnn64','gnn16','attn64'],
  ['gnn64','attn64','gnn16'],
  ['attn64','gnn16','gnn64'],
  ['attn64','gnn64','gnn16']
];

function singletonRotations(a,b){
  return [0,1,2].map(i=>Array.from({length:3},(_,seat)=>seat===i?b:a));
}
function match(models,order,radius,seed,{mode,temperature,horizonMultiplier}){
  const rng=COLORS.map((_,seat)=>seededRandom((seed+0x9e3779b9+(seat+1)*1009)>>>0));
  const horizon=pointsOnBoard(radius).length*horizonMultiplier+3;
  let state=createGame(radius),turns=0;
  const passCounts=[0,0,0],earlyPassCounts=[0,0,0];
  while(!state.ended&&turns<horizon){
    const seat=state.turn;
    const decision=selectComparisonMove(state,models[order[seat]],{
      greedy:mode==='greedy',random:rng[seat],temperature
    });
    if(!decision.action)throw Error('No legal policy action');
    if(decision.move===null){
      passCounts[seat]++;
      if(turns<6)earlyPassCounts[seat]++;
    }
    const transition=decision.move?
      play(state,decision.move.q,decision.move.r):pass(state);
    if(!transition.ok)throw Error('Illegal policy move '+transition.reason);
    state=transition.state;turns++;
  }
  const stone=scores(state),counts=COLORS.map(c=>stone[c]);
  const total=counts.reduce((a,b)=>a+b,0);
  const winners=state.ended?winner(state):[];
  const seatWinShare=state.ended?
    COLORS.map(c=>winners.includes(c)?1/winners.length:0):null;
  return {
    mode,radius,order,seed,ended:state.ended,truncated:!state.ended,
    turns,horizon,counts,passCounts,earlyPassCounts,
    seatWinShare,seatStoneShare:counts.map(c=>total?c/total:1/3)
  };
}
function score(records,kinds){
  const byKind=Object.fromEntries(kinds.map(k=>[k,{
    seats:0,finishedSeats:0,winShare:0,stoneShare:0,passes:0,earlyPasses:0
  }]));
  const finished=records.filter(r=>r.ended);
  for(const record of records)for(let seat=0;seat<3;seat++){
    const stats=byKind[record.order[seat]];
    stats.seats++;
    stats.stoneShare+=record.seatStoneShare[seat];
    stats.passes+=record.passCounts[seat];
    stats.earlyPasses+=record.earlyPassCounts[seat];
    if(record.ended){
      stats.finishedSeats++;
      stats.winShare+=record.seatWinShare[seat];
    }
  }
  return {
    games:records.length,finished:finished.length,truncated:records.length-finished.length,
    meanTurns:records.reduce((sum,r)=>sum+r.turns,0)/records.length,
    byKind:Object.fromEntries(kinds.map(k=>{
      const s=byKind[k];
      return [k,{
        seatExposures:s.seats,finishedSeatExposures:s.finishedSeats,
        winSharePerFinishedSeat:s.finishedSeats?s.winShare/s.finishedSeats:null,
        observedStoneSharePerSeat:s.stoneShare/s.seats,
        passesPerSeat:s.passes/s.seats,
        earlyPasses:s.earlyPasses
      }];
    }))
  };
}
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],v=argv[i+1];
    if(!['--models-dir','--games-trained','--radii','--rounds',
      '--seed','--temperature','--horizon-multiplier','--out'].includes(key)||v===undefined)
      throw Error('Unknown or missing argument '+key);
    args[key.slice(2)]=v;
  }
  if(!args['models-dir']||!args.out)throw Error('--models-dir and --out required');
  const games=Number(args['games-trained']);
  const radii=(args.radii??'3,4').split(',').map(Number);
  const rounds=Number(args.rounds??2),seed=Number(args.seed??20471103);
  const temperature=Number(args.temperature??1.0);
  const horizonMultiplier=Number(args['horizon-multiplier']??100);
  if(!Number.isInteger(games)||games<2000||games>60000||games%2000!==0||
    !radii.length||radii.some(r=>!Number.isInteger(r)||r<2||r>5)||
    !Number.isInteger(rounds)||rounds<1||rounds>100||
    !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
    !Number.isFinite(temperature)||temperature<=0||temperature>10||
    !Number.isInteger(horizonMultiplier)||horizonMultiplier<1||horizonMultiplier>100)
    throw Error('Invalid matchup configuration');
  return {games,radii,rounds,seed,temperature,horizonMultiplier,
    dir:args['models-dir'],out:args.out};
}
const args=parseArgs(process.argv.slice(2));
const models={};
for(const kind of KINDS){
  const file=join(args.dir,'architecture-milestone-'+args.games/8+'-'+kind,'model.json');
  const model=validateComparisonModel(JSON.parse(readFileSync(file,'utf8')));
  if(model.kind!==kind||model.metadata.games!==args.games)
    throw Error('Wrong checkpoint kind/games: '+file);
  models[kind]=model;
}
const results=[];
for(const radius of args.radii){
  const settings={temperature:args.temperature,horizonMultiplier:args.horizonMultiplier};
  const tripleStochastic=[],tripleGreedy=[];
  const pairs=Object.fromEntries(PAIRS.map(p=>[p.join('_vs_'),[]]));
  for(let rep=0;rep<args.rounds;rep++){
    // Each replicate uses fresh RNG state, but identical seed per radius
    // and seat across candidate architecture comparisons.
    const seed=(args.seed+rep*100003+radius*131071)>>>0;
    for(const order of PERMUTATIONS)
      tripleStochastic.push(match(models,order,radius,seed,{
        ...settings,mode:'stochastic'
      }));
    for(const [a,b] of PAIRS){
      const key=a+'_vs_'+b;
      // Both two-vs-one compositions. Each unique singleton occupies
      // each of three seat positions under the same replicate seed.
      for(const order of [
        ...singletonRotations(a,b),...singletonRotations(b,a)
      ])pairs[key].push(match(models,order,radius,seed,{
        ...settings,mode:'stochastic'
      }));
    }
  }
  // Greedy is deterministic: a repeated seed would reproduce the exact same
  // trajectory. Run precisely one six-permutation block rather than fake N.
  for(const order of PERMUTATIONS)
    tripleGreedy.push(match(models,order,radius,args.seed,{
      ...settings,mode:'greedy'
    }));
  const triple=score(tripleStochastic,KINDS);
  const greedy=score(tripleGreedy,KINDS);
  const pairwise=Object.fromEntries(PAIRS.map(p=>{
    const key=p.join('_vs_');
    const summary=score(pairs[key],p);
    return [key,{
      ...summary,
      perSeatWinShareDifference:
        summary.byKind[p[0]].winSharePerFinishedSeat===null||
        summary.byKind[p[1]].winSharePerFinishedSeat===null?
        null:summary.byKind[p[0]].winSharePerFinishedSeat-
             summary.byKind[p[1]].winSharePerFinishedSeat
    }];
  }));
  results.push({radius,triple,greedyTriple:greedy,pairwise});
  const print={radius,gamesTrained:args.games,stochasticTriple:{
    games:triple.games,finished:triple.finished,
    win:Object.fromEntries(KINDS.map(k=>[k,triple.byKind[k].winSharePerFinishedSeat]))
  },greedyTriple:{
    games:greedy.games,finished:greedy.finished,
    win:Object.fromEntries(KINDS.map(k=>[k,greedy.byKind[k].winSharePerFinishedSeat]))
  },pairwise:Object.fromEntries(PAIRS.map(p=>{
    const key=p.join('_vs_');
    return [key,{games:pairwise[key].games,finished:pairwise[key].finished,
      win:Object.fromEntries(p.map(k=>[k,pairwise[key].byKind[k].winSharePerFinishedSeat]))}];
  }))};
  console.log(JSON.stringify(print));
}
const report={
  version:1,kind:'independent-architecture-head-to-head',
  gamesTrained:args.games,checkpointIterations:args.games/8,
  models:Object.fromEntries(KINDS.map(k=>[k,models[k].version])),
  seed:args.seed,rounds:args.rounds,temperature:args.temperature,
  stochastic:true,greedy:true,passIsLegal:true,forcedPasses:false,
  horizonMultiplier:args.horizonMultiplier,
  scoringNotes:'Each kind measured per seat exposure. Pairwise AAB and ABB in equal numbers, rotate singleton seat 0,1,2. Truncated games excluded from win share, retained in observed stone share.',
  results
};
mkdirSync(dirname(args.out),{recursive:true});
writeFileSync(args.out,JSON.stringify(report,null,2)+'\n');
console.log('Independent matchup report:',args.out);
