#!/usr/bin/env node
/**
 * 3-seat no-teacher comparison selfplay, common reward and seed protocol.
 * No forced terminal actions. Timeout is an observed nonterminal board
 * with stone-share minus penalty targets, exactly as in PV3 trainer.
 */
import {readFileSync} from 'node:fs';
import {COLORS,createGame,pointsOnBoard,pass,play,scores} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {stoneShareTimeoutReward} from '../src/direct-policy.js';
import {PV3_ARCH,encodePV2State} from '../src/pv2-ai.js';
import {validateComparisonModel,selectComparisonMove} from '../src/architecture-comparison.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--temperature',
       '--horizon-multiplier','--timeout-penalty','--sample-stride'].includes(k)||v===undefined)
    throw Error('Unknown argument '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model required');
const model=validateComparisonModel(JSON.parse(readFileSync(args.model,'utf8')));
const games=Number(args.games??8),seed=Number(args.seed??20261103),
  radius=Number(args.radius??3),temperature=Number(args.temperature??1.5),
  horizonMultiplier=Number(args['horizon-multiplier']??100),
  timeoutPenalty=Number(args['timeout-penalty']??0.3),
  sampleStride=Number(args['sample-stride']??1);
if(!Number.isInteger(games)||games<1||games>100||
   !Number.isInteger(seed)||seed<0||seed>0xffffffff||
   !Number.isInteger(radius)||radius<2||radius>5||
   !Number.isFinite(temperature)||temperature<=0||temperature>10||
   !Number.isInteger(horizonMultiplier)||horizonMultiplier<1||horizonMultiplier>100||
   !Number.isFinite(timeoutPenalty)||timeoutPenalty<0||timeoutPenalty>2||
   !Number.isInteger(sampleStride)||sampleStride<1||sampleStride>16)
  throw Error('Invalid comparison selfplay setup');
const horizon=pointsOnBoard(radius).length*horizonMultiplier+3;
for(let game=0;game<games;game++){
  const gameSeed=(seed+game*7919)>>>0;
  const rng=seededRandom(gameSeed);
  let state=createGame(radius),turns=0,passes=0;
  const samples=[];
  // Sampling phase is tied to seed so seats are covered without a fixed-seat bias.
  const offset=gameSeed%sampleStride;
  while(!state.ended && turns<horizon){
    const selected=selectComparisonMove(state,model,{random:rng,temperature});
    if(!selected.action)throw Error('Missing legal comparison action');
    if(selected.action.type==='pass')passes++;
    if((turns+offset)%sampleStride===0){
      const encoded=encodePV2State(state,{architecture:PV3_ARCH});
      samples.push({...encoded,seat:state.turn,
        legal:selected.actions.map(x=>x.index),
        selected:selected.action.index});
    }
    const outcome=selected.move?play(state,selected.move.q,selected.move.r):pass(state);
    if(!outcome.ok)throw Error('Illegal sampled action: '+outcome.reason);
    state=outcome.state;turns++;
  }
  const result=stoneShareTimeoutReward(state,timeoutPenalty);
  for(const sample of samples)
    sample.value=[0,1,2].map(i=>result.rewards[(sample.seat+i)%3]);
  process.stdout.write(JSON.stringify({
    architecture:model.kind,seed:gameSeed,radius,
    ended:state.ended,truncated:!state.ended,turns,horizon,passes,
    scores:scores(state),stoneShares:result.stoneShares,
    rewards:result.rewards,samples
  })+'\n');
}
