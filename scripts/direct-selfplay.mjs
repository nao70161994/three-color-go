#!/usr/bin/env node
/**
 * Three agents, ONE shared policy snapshot, no search.
 * Every state from ALL 3 colors becomes a policy-gradient sample.
 */
import {readFileSync} from 'node:fs';
import {COLORS,createGame,pointsOnBoard,scores} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {PV2_ARCH} from '../src/pv2-ai.js';
import {
  applyDirectPolicy,encodePV2State,finalStoneShares,selectDirectPolicyMove
} from '../src/direct-policy.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--temperature'].includes(k)||v===undefined)
    throw Error('Unknown/missing parameter '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model is required');
const model=JSON.parse(readFileSync(args.model,'utf8'));
if(model.architecture!==PV2_ARCH)throw Error('Expected PV2 group-aware model');
const games=Number(args.games??4),seed=Number(args.seed??1),
  radius=Number(args.radius??3),temperature=Number(args.temperature??1);
if(!Number.isInteger(games)||games<1||games>100||
   !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
   !Number.isInteger(radius)||radius<2||radius>5||
   !Number.isFinite(temperature)||temperature<=0||temperature>10)
  throw Error('Invalid self-play configuration');

for(let game=0;game<games;game++){
  const gameSeed=(seed+game*7919)>>>0,random=seededRandom(gameSeed);
  const cap=pointsOnBoard(radius).length*2;
  let state=createGame(radius),turns=0;
  const samples=[];
  while(!state.ended&&turns<cap+3){
    const snapshot=encodePV2State(state);
    const choice=selectDirectPolicyMove(state,model,{random,temperature});
    if(!choice.action)throw Error('Missing legal action');
    samples.push({...snapshot,
      seat:state.turn,
      legal:choice.actions.map(a=>a.index),
      selected:choice.action.index});
    state=applyDirectPolicy(state,choice.move);
    turns++;
  }
  if(!state.ended)throw Error('Self-play did not terminate');
  const rewards=finalStoneShares(state);
  const seatCounts=[0,0,0];
  for(const s of samples){
    seatCounts[s.seat]++;
    s.value=[0,1,2].map(i=>rewards[(s.seat+i)%3]);
  }
  if(seatCounts.some(x=>x===0))throw Error('A player was omitted from self-play');
  process.stdout.write(JSON.stringify({
    kind:'three-player-direct-selfplay',architecture:model.architecture,
    seed:gameSeed,radius,ended:state.ended,
    rewards,scores:scores(state),seatCounts,samples
  })+'\n');
}
