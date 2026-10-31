#!/usr/bin/env node
/** Held-out seat-rotated full-board MCTS vs actual production hard CPU. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pass,play,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';
import {choosePVMove,PV_ARCH} from '../src/pv-ai.js';
import {PV2_ARCH} from '../src/pv2-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--simulations','--out'].includes(k)||!v)
    throw Error('Unknown argument '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model required');
const model=JSON.parse(readFileSync(args.model,'utf8'));
if(![PV_ARCH,PV2_ARCH].includes(model.architecture))throw Error('Wrong model architecture');
const games=Number(args.games??6),seed=Number(args.seed??20261101),
  radius=Number(args.radius??3),simulations=Number(args.simulations??16);
if(!Number.isInteger(games)||games<6||games>300||games%6!==0||
   !Number.isInteger(radius)||radius<2||radius>5||
   !Number.isInteger(simulations)||simulations<1||simulations>256||
   !Number.isSafeInteger(seed)||seed<0||seed>4294967295)
  throw Error('Invalid benchmark configuration');

const orders=[['pv','hard','balanced'],['pv','balanced','hard'],
  ['hard','pv','balanced'],['balanced','pv','hard'],
  ['hard','balanced','pv'],['balanced','hard','pv']];
const stats=Object.fromEntries(['pv','hard','balanced'].map(name=>
  [name,{winShare:0,soloWins:0}]));
const results=[];
for(let i=0;i<games;i++){
  const order=orders[i%6],round=Math.floor(i/6),gameSeed=(seed+round*100003)>>>0;
  const rng=COLORS.map((_,seat)=>seededRandom((gameSeed+seat*151)>>>0));
  let state=createGame(radius),turns=0;
  const cells=3*radius*(radius+1)+1;
  while(!state.ended&&turns<2*cells+3){
    const seat=state.turn,agent=order[seat];
    const move=agent==='pv'?choosePVMove(state,model,simulations,rng[seat])
      :agent==='hard'?chooseStrongMove(state,rng[seat])
      :chooseMove(state,rng[seat],'balanced');
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Illegal benchmark action: '+result.reason);
    state=result.state;turns++;
  }
  if(!state.ended){
    results.push({order,gameSeed,ended:false,turns});
    continue;
  }
  const count=scores(state),winners=winner(state);
  const points=Object.fromEntries(order.map((name,seat)=>[name,count[COLORS[seat]]]));
  for(const name of order)if(winners.includes(COLORS[order.indexOf(name)])){
    stats[name].winShare+=1/winners.length;
    if(winners.length===1)stats[name].soloWins++;
  }
  results.push({order,gameSeed,ended:true,turns,points,winners});
}
const finished=results.filter(r=>r.ended),truncated=results.length-finished.length;
const pvAhead=finished.filter(r=>r.points.pv>r.points.hard).length;
const hardAhead=finished.filter(r=>r.points.pv<r.points.hard).length;
const ties=finished.length-pvAhead-hardAhead;
const margin=finished.length?finished.reduce((a,r)=>a+r.points.pv-r.points.hard,0)/finished.length:null;
const report={version:1,model:model.version,games,radius,simulations,seed,
  finished:finished.length,truncated,pvAhead,hardAhead,ties,
  meanPVMinusHard:margin===null?null:+margin.toFixed(3),
  stats:Object.fromEntries(Object.entries(stats).map(([name,x])=>
    [name,{...x,winShare:+x.winShare.toFixed(3),
      rate:finished.length?+(x.winShare/finished.length).toFixed(4):null}])),
  promotionReady:finished.length>=60&&truncated===0&&pvAhead/finished.length>.6&&
    margin>0&&stats.pv.winShare/finished.length>.45,
  samples:results.slice(0,6),
  caveat:'Exploratory seeded three-player matches, not a human Elo rating.'};
const json=JSON.stringify(report,null,2)+'\n';
if(args.out){mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,json);}
process.stdout.write(json);
