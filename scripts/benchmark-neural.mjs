#!/usr/bin/env node
/**
 * Seat-balanced evaluation: neural candidate vs actual UI "hard" (3-ply)
 * and balanced one-ply CPU. Never auto-promotes a model.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {COLORS,createGame,play,pass,scores,winner} from '../src/game.js';
import {seededRandom,chooseMove} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';
import {chooseNeuralMove} from '../src/neural-ai.js';
import {NEURAL_MODEL} from '../src/neural-weights.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--out'].includes(key)||!value)
    throw Error('Unknown or missing argument '+key);
  args[key.slice(2)]=value;
}
const games=Number(args.games??60),seed=Number(args.seed??20261031);
const radius=Number(args.radius??3);
if(!Number.isSafeInteger(games)||games<6||games>300||games%6!==0||
   !Number.isSafeInteger(seed)||seed<0||seed>4294967295||
   !Number.isInteger(radius)||radius<2||radius>5)
  throw Error('Require --games multiple of 6 (6..300), radius 2..5 and valid seed');
const model=args.model?JSON.parse(await readFile(args.model,'utf8')):NEURAL_MODEL;
if(model.features!==12||model.layers?.length!==4)
  throw Error('Invalid candidate model');
const permutations=[
  ['neural','hard','balanced'],['neural','balanced','hard'],
  ['hard','neural','balanced'],['balanced','neural','hard'],
  ['hard','balanced','neural'],['balanced','hard','neural']
];
const stats={neural:{wins:0,winShare:0},hard:{wins:0,winShare:0},
  balanced:{wins:0,winShare:0}};
const perSeat=[0,1,2].map(seat=>({seat,games:0,neuralWins:0,neuralAhead:0}));
const samples=[],margins=[];
let finished=0,truncated=0,neuralAhead=0,hardAhead=0,tied=0;
for(let i=0;i<games;i++){
  const order=permutations[i%6],round=Math.floor(i/6);
  const rng=COLORS.map(seat=>seededRandom((seed+round*100003+COLORS.indexOf(seat)*151)>>>0));
  const neuralSeat=order.indexOf('neural');
  let state=createGame(radius),turns=0;
  while(!state.ended&&turns<2*(3*radius*(radius+1)+1)+3){
    const agent=order[state.turn],random=rng[state.turn];
    const move=agent==='neural'?chooseNeuralMove(state,random,null,model)
      :agent==='hard'?chooseStrongMove(state,random)
      :chooseMove(state,random,'balanced');
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Invalid policy move: '+result.reason);
    state=result.state;turns++;
  }
  if(!state.ended){truncated++;continue;}
  finished++;
  const score=scores(state),winners=winner(state);
  const own={};
  for(let seat=0;seat<3;seat++){
    const name=order[seat],color=COLORS[seat];
    own[name]=score[color];
    if(winners.includes(color)){
      stats[name].winShare+=1/winners.length;
      if(winners.length===1)stats[name].wins++;
    }
  }
  const gap=own.neural-own.hard;
  margins.push(gap);
  perSeat[neuralSeat].games++;
  if(winners.length===1&&winners[0]===COLORS[neuralSeat])
    perSeat[neuralSeat].neuralWins++;
  if(gap>0){neuralAhead++;perSeat[neuralSeat].neuralAhead++;}
  else if(gap<0)hardAhead++;
  else tied++;
  if(samples.length<6)samples.push({
    seed:(seed+round*100003)>>>0,order,finalScores:own,winners,turns
  });
}
const avgMargin=finished?margins.reduce((x,y)=>x+y,0)/finished:null;
const result={
  version:1,kind:'neural-vs-hard-vs-balanced',model:model.version,
  radius,seed,games,finished,truncated,neuralAhead,hardAhead,tied,
  averageNeuralMinusHard:avgMargin===null?null:+avgMargin.toFixed(3),
  stats:Object.fromEntries(Object.entries(stats).map(([name,item])=>[
    name,{...item,winShare:+item.winShare.toFixed(3),
      winShareRate:finished?+(item.winShare/finished).toFixed(4):null}
  ])),perSeat,samples,
  promotionReady:finished>=60&&truncated===0&&neuralAhead/games>=.6&&
    avgMargin>=0&&stats.neural.winShare/finished>=.45,
  caveat:'Seeded AI-only benchmark. More radii and held-out seeds required before promotion.'
};
if(args.out){await mkdir(dirname(args.out),{recursive:true});
  await writeFile(args.out,JSON.stringify(result,null,2)+'\n');}
process.stdout.write(JSON.stringify(result,null,2)+'\n');
