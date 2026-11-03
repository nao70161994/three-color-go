#!/usr/bin/env node
/**
 * Unbiased three-player self-play: policy choices are always real legal
 * placements or voluntary pass. A safety timeout NEVER injects terminal passes.
 * Reward = observed stone share - penalty ONLY when actually truncated.
 */
import {readFileSync} from 'node:fs';
import {COLORS,createGame,pointsOnBoard,scores} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {PV2_ARCH} from '../src/pv2-ai.js';
import {applyDirectPolicy,encodePV2State,selectDirectPolicyMove} from '../src/direct-policy.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--temperature','--horizon-multiplier','--timeout-penalty'].includes(k)
     ||v===undefined)throw Error('Unknown/missing parameter '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model is required');
const model=JSON.parse(readFileSync(args.model,'utf8'));
if(model.architecture!==PV2_ARCH || model.metadata?.valueOutput!=='independent')
  throw Error('Expected an independent-return PV2 model');
const games=Number(args.games??4),seed=Number(args.seed??1),
  radius=Number(args.radius??3),temperature=Number(args.temperature??1.5),
  horizonMultiplier=Number(args['horizon-multiplier']??100),
  timeoutPenalty=Number(args['timeout-penalty']??0.3);
if(!Number.isInteger(games)||games<1||games>100||
   !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
   !Number.isInteger(radius)||radius<2||radius>5||
   !Number.isFinite(temperature)||temperature<=0||temperature>10||
   !Number.isInteger(horizonMultiplier)||horizonMultiplier<1||horizonMultiplier>100||
   !Number.isFinite(timeoutPenalty)||timeoutPenalty<0||timeoutPenalty>2)
  throw Error('Invalid reward self-play configuration');

const horizon=pointsOnBoard(radius).length*horizonMultiplier+3;
for(let game=0;game<games;game++){
  const gameSeed=(seed+game*7919)>>>0,random=seededRandom(gameSeed);
  let state=createGame(radius),turns=0,passes=0,optionalPasses=0;
  const samples=[];
  while(!state.ended&&turns<horizon){
    const snapshot=encodePV2State(state);
    const choice=selectDirectPolicyMove(state,model,{random,temperature});
    if(!choice.action)throw Error('Missing legal action');
    if(choice.action.type==='pass'){
      passes++;
      if(choice.actions.some(a=>a.type==='play'))optionalPasses++;
    }
    samples.push({...snapshot,seat:state.turn,
      legal:choice.actions.map(a=>a.index),selected:choice.action.index});
    state=applyDirectPolicy(state,choice.move);
    turns++;
  }
  const ended=state.ended,truncated=!ended;
  // The board is only a snapshot on timeout, NEVER a pretend final position.
  const count=scores(state),total=Object.values(count).reduce((a,b)=>a+b,0);
  const stoneShares=COLORS.map(c=>total?count[c]/total:1/3);
  const rewards=stoneShares.map(s=>s-(truncated?timeoutPenalty:0));
  const seatCounts=[0,0,0];
  for(const s of samples){
    seatCounts[s.seat]++;
    s.value=[0,1,2].map(i=>rewards[(s.seat+i)%3]);
  }
  if(seatCounts.some(x=>x===0))throw Error('A player was omitted from self-play');
  process.stdout.write(JSON.stringify({
    kind:'three-player-direct-reward-selfplay',
    architecture:model.architecture,seed:gameSeed,radius,
    ended,truncated,turns,horizon,timeoutPenalty,
    passes,optionalPasses,stoneShares,rewards,scores:count,seatCounts,samples
  })+'\n');
}
