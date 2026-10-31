#!/usr/bin/env node
/**
 * Teacher-free on-policy three-player self-play. Emits one JSON line per game.
 * Actions are sampled from the current network, not selected by a hand-coded teacher.
 * The same rules engine and legal/safe-move filter as browser inference is used.
 */
import {readFileSync} from 'node:fs';
import {createGame,COLORS,play,pass,pointsOnBoard,scores,winner} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {neuralCandidates,neuralScore} from '../src/neural-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--model','--games','--seed','--radius','--temperature'].includes(key)||!value)
    throw Error('Unknown or missing argument '+key);
  args[key.slice(2)]=value;
}
if(!args.model)throw Error('--model JSON path required');
const games=Number(args.games??6),seed=Number(args.seed??20261031);
const radius=Number(args.radius??3),temperature=Number(args.temperature??1);
if(!Number.isSafeInteger(games)||games<1||games>200||
   !Number.isSafeInteger(seed)||seed<0||seed>4294967295||
   !Number.isInteger(radius)||radius<2||radius>6||
   !Number.isFinite(temperature)||temperature<=0||temperature>10)
  throw Error('Invalid games/seed/radius/temperature');
const model=JSON.parse(readFileSync(args.model,'utf8'));
if(model.features!==12||model.layers?.length!==4)
  throw Error('Invalid neural policy model');
const cells=pointsOnBoard(radius).length;
for(let game=0;game<games;game++){
  const random=seededRandom((seed+game*7919)>>>0);
  let state=createGame(radius);
  const samples=[],maxTurns=cells*2+3;
  while(!state.ended&&state.moveCount<maxTurns){
    const seat=state.turn;
    const options=neuralCandidates(state,random);
    if(!options.length){
      state=pass(state).state;
      continue;
    }
    const logits=options.map(item=>neuralScore(item.features,model)/temperature);
    const max=Math.max(...logits);
    const weights=logits.map(value=>Math.exp(value-max));
    let draw=random()*weights.reduce((sum,n)=>sum+n,0),choice=weights.length-1;
    for(let i=0;i<weights.length;i++){
      draw-=weights[i];
      if(draw<0){choice=i;break;}
    }
    const move=options[choice];
    const result=play(state,move.q,move.r);
    if(!result.ok)throw Error('Self-play invalid move: '+result.reason);
    samples.push({seat,choice,candidates:options.map(option=>option.features)});
    state=result.state;
  }
  // Do not assign rewards to incomplete games.
  if(!state.ended)throw Error('Incomplete self-play game; check pass cutoff');
  const score=scores(state),winning=winner(state);
  const reward=COLORS.map(color=>{
    const others=COLORS.filter(c=>c!==color);
    const lead=(score[color]-(score[others[0]]+score[others[1]])/2)/cells;
    return (winning.includes(color)?1/winning.length:0)-1/3+lead*.5;
  });
  for(const sample of samples)sample.reward=reward[sample.seat];
  process.stdout.write(JSON.stringify({
    version:1,kind:'policy-gradient-selfplay',seed:(seed+game*7919)>>>0,
    radius,ended:state.ended,scores:score,winners:winning,reward,samples
  })+'\n');
}
