#!/usr/bin/env node
/** Produce teacher-free policy/value MCTS self-play examples from real rules. */
import {readFileSync} from 'node:fs';
import {COLORS,createGame,pass,play,pointsOnBoard,winner} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {encodePVState,searchPV,PV_ARCH} from '../src/pv-ai.js';
import {encodePV2State,PV2_ARCH} from '../src/pv2-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--simulations'].includes(k)||!v)
    throw Error('Invalid option '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model required');
const model=JSON.parse(readFileSync(args.model,'utf8'));
if(![PV_ARCH,PV2_ARCH].includes(model.architecture))throw Error('Unsupported model architecture');
const games=Number(args.games??2),seed=Number(args.seed??1);
const radius=Number(args.radius??3),simulations=Number(args.simulations??16);
if(!Number.isInteger(games)||games<1||games>100||
   !Number.isSafeInteger(seed)||seed<0||seed>4294967295||
   !Number.isInteger(radius)||radius<2||radius>5||
   !Number.isInteger(simulations)||simulations<1||simulations>256)
  throw Error('Invalid self-play parameters');

for(let game=0;game<games;game++){
  const gameSeed=(seed+game*7919)>>>0;
  const random=seededRandom(gameSeed),cells=pointsOnBoard(radius).length;
  let state=createGame(radius);
  const examples=[];
  while(!state.ended&&state.moveCount<2*cells+3){
    const start=model.architecture===PV2_ARCH?encodePV2State(state):encodePVState(state);
    const search=searchPV(state,model,{simulations,random});
    if(!search.options.length)throw Error('No legal MCTS actions');
    const count=search.options.reduce((a,o)=>a+o.visits,0);
    if(count!==simulations)throw Error('Visit accounting mismatch');
    // Sample visits during exploration, deterministic under the provided seed.
    let draw=random()*count,choice=search.options.at(-1);
    for(const option of search.options){draw-=option.visits;
      if(draw<0){choice=option;break;}}
    const result=choice.type==='pass'
      ?pass(state):play(state,choice.q,choice.r);
    if(!result.ok)throw Error('Invalid self-play choice: '+result.reason);
    examples.push({...start,
      legal:search.options.map(o=>o.index),
      policy:search.options.map(o=>o.visits/simulations),
      selected:choice.index});
    state=result.state;
  }
  if(!state.ended)throw Error('Self-play exceeded forced-pass boundary');
  const winners=winner(state);
  const target=COLORS.map(c=>winners.includes(c)?1/winners.length:0);
  for(const example of examples)
    example.value=[0,1,2].map(i=>target[(example.turn+i)%3]);
  process.stdout.write(JSON.stringify({
    kind:'full-board-policy-value-selfplay',radius,seed:gameSeed,
    winners,ended:state.ended,examples
  })+'\n');
}
