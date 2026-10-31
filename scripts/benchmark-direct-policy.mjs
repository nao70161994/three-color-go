#!/usr/bin/env node
/**
 * Held-out benchmark: ONE neural forward pass per turn, no game-tree search.
 * All 6 seat permutations vs original 'hard' and 'balanced' opponents.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pass,play,scores,winner,pointsOnBoard} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';
import {selectDirectPolicyMove} from '../src/direct-policy.js';
import {validatePV2Model} from '../src/pv2-ai.js';

const opts={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--model','--games','--seed','--radius','--out'].includes(process.argv[i])||
      process.argv[i+1]===undefined)throw Error('Invalid option '+process.argv[i]);
  opts[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!opts.model)throw Error('--model is required');
const model=validatePV2Model(JSON.parse(readFileSync(opts.model,'utf8')));
const games=Number(opts.games??12),seed=Number(opts.seed??20261121),
  radius=Number(opts.radius??3);
if(!Number.isInteger(games)||games<6||games>300||games%6||
   !Number.isInteger(radius)||radius<2||radius>5||
   !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid benchmark settings');
const rotations=[['direct','hard','balanced'],['direct','balanced','hard'],
  ['hard','direct','balanced'],['balanced','direct','hard'],
  ['hard','balanced','direct'],['balanced','hard','direct']];
const agents=['direct','hard','balanced'];
const winShare=Object.fromEntries(agents.map(a=>[a,0]));
const records=[];
for(let i=0;i<games;i++){
  const order=rotations[i%6],block=Math.floor(i/6);
  const gameSeed=(seed+block*100003)>>>0;
  const rng=COLORS.map((_,seat)=>seededRandom((gameSeed+seat*151)>>>0));
  let state=createGame(radius),turns=0;
  const cap=pointsOnBoard(radius).length*2;
  while(!state.ended&&turns<cap+3){
    const seat=state.turn;
    const agent=order[seat];
    const move=agent==='direct'
      ?selectDirectPolicyMove(state,model,{greedy:true}).move
      :agent==='hard'
      ?chooseStrongMove(state,rng[seat])
      :chooseMove(state,rng[seat],'balanced');
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Illegal evaluation move: '+result.reason);
    state=result.state;turns++;
  }
  if(!state.ended){records.push({order,gameSeed,ended:false,turns});continue;}
  const counts=scores(state),winners=winner(state);
  const points=Object.fromEntries(order.map((a,seat)=>[a,counts[COLORS[seat]]]));
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  for(const agent of agents)
    if(winners.includes(COLORS[order.indexOf(agent)]))
      winShare[agent]+=1/winners.length;
  records.push({order,gameSeed,ended:true,turns,points,winners,
    directStoneShare:total?points.direct/total:1/3});
}
const completed=records.filter(x=>x.ended),truncated=games-completed.length;
const directAhead=completed.filter(x=>x.points.direct>x.points.hard).length;
const hardAhead=completed.filter(x=>x.points.direct<x.points.hard).length;
const equal=completed.length-directAhead-hardAhead;
const average=(fn)=>completed.length?
  +(completed.reduce((a,b)=>a+fn(b),0)/completed.length).toFixed(4):null;
const report={
  model:model.version,algorithm:model.algorithm??'direct-policy',
  trainingGames:model.metadata?.games??null,
  radius,games,finished:completed.length,truncated,seed,
  directAhead,hardAhead,equal,
  meanDirectMinusHard:average(r=>r.points.direct-r.points.hard),
  meanDirectStoneShare:average(r=>r.directStoneShare),
  winShareRate:Object.fromEntries(agents.map(a=>[a,completed.length?
    +(winShare[a]/completed.length).toFixed(4):null])),
  promotionReady:completed.length>=60&&truncated===0&&
    directAhead/completed.length>.6&&
    average(r=>r.points.direct-r.points.hard)>0&&
    winShare.direct/completed.length>.45,
  samples:records.slice(0,6),
  caveat:'3-player seeded matches; one PV2 inference per move and no search, no deployed model.'
};
const json=JSON.stringify(report,null,2)+'\n';
if(opts.out){mkdirSync(dirname(opts.out),{recursive:true});writeFileSync(opts.out,json);}
process.stdout.write(json);
