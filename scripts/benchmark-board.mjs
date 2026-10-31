#!/usr/bin/env node
/**
 * Held-out, all-six-seat-permutation benchmark for board Policy-Value MCTS.
 * Actual game-engine moves and actual UI "hard" 3-ply opponent.
 * Does not replace published model even if gate passes.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,play,pass,scores,winner} from '../src/game.js';
import {seededRandom,chooseMove} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';
import {chooseBoardMctsMove} from '../src/board-mcts.js';
import {validateBoardModel} from '../src/board-pv.js';
const args={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--model','--games','--radius','--simulations','--seed','--out'].includes(process.argv[i])||
    !process.argv[i+1])throw Error('Unknown or missing option '+process.argv[i]);
  args[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!args.model)throw Error('--model must point to trained candidate');
const games=Number(args.games??6),radius=Number(args.radius??3);
const simulations=Number(args.simulations??16),seed=Number(args.seed??20261101);
if(!Number.isInteger(games)||games<6||games>300||games%6!==0||
   !Number.isInteger(radius)||radius<2||radius>4||
   !Number.isInteger(simulations)||simulations<2||simulations>256||
   !Number.isSafeInteger(seed)||seed<0||seed>4294967295)
  throw Error('Invalid benchmark settings');
const model=validateBoardModel(JSON.parse(readFileSync(args.model,'utf8')));
const permutations=[
  ['board','hard','balanced'],['board','balanced','hard'],
  ['hard','board','balanced'],['balanced','board','hard'],
  ['hard','balanced','board'],['balanced','hard','board']
];
const scoresByAgent=Object.fromEntries(['board','hard','balanced'].map(n=>[n,{
  wins:0,winShare:0,points:0,played:0
}]));
let finished=0,boardAhead=0,hardAhead=0,equal=0,margin=0,truncated=0;
const perSeat=[0,1,2].map(seat=>({seat,played:0,boardAhead:0,winShare:0}));
const samples=[];
for(let game=0;game<games;game++){
  const order=permutations[game%6],round=Math.floor(game/6);
  const random=COLORS.map((_,seat)=>seededRandom((seed+round*7919+seat*191)>>>0));
  let state=createGame(radius),turns=0;
  while(!state.ended&&turns<2*(3*radius*(radius+1)+1)+3){
    const actor=order[state.turn],rng=random[state.turn];
    const move=actor==='board'?
      chooseBoardMctsMove(state,model,{simulations,temperature:0,noise:0,random:rng}).move
      :actor==='hard'?chooseStrongMove(state,rng)
      :chooseMove(state,rng,'balanced');
    const next=move?play(state,move.q,move.r):pass(state);
    if(!next.ok)throw Error('Illegal benchmark action: '+next.reason);
    state=next.state;turns++;
  }
  if(!state.ended){truncated++;continue;}
  finished++;
  const pointScores=scores(state),winning=winner(state);
  const byName={};
  for(let seat=0;seat<3;seat++){
    const name=order[seat],color=COLORS[seat];
    byName[name]=pointScores[color];
    scoresByAgent[name].points+=pointScores[color];
    scoresByAgent[name].played++;
    if(winning.includes(color)){
      scoresByAgent[name].winShare+=1/winning.length;
      if(winning.length===1)scoresByAgent[name].wins++;
      if(name==='board')perSeat[seat].winShare+=1/winning.length;
    }
  }
  const seat=order.indexOf('board');
  perSeat[seat].played++;
  const diff=byName.board-byName.hard;
  margin+=diff;
  if(diff>0){boardAhead++;perSeat[seat].boardAhead++;}
  else if(diff<0)hardAhead++;
  else equal++;
  if(samples.length<6)samples.push({
    order,seed:(seed+round*7919)>>>0,turns,finalPoints:byName,winners:winning
  });
}
const agents=Object.fromEntries(Object.entries(scoresByAgent).map(([name,data])=>
  [name,{...data,winShare:+data.winShare.toFixed(3),
    winShareRate:finished?+(data.winShare/finished).toFixed(4):null,
    meanPoints:data.played?+(data.points/data.played).toFixed(3):null}]));
const report={
  version:1,kind:'board-policy-value-mcts-vs-hard',
  model:model.version,radius,games,seed,simulations,
  finished,truncated,boardAhead,hardAhead,equal,
  meanBoardMinusHard:finished?+(margin/finished).toFixed(3):null,
  agents,perSeat,samples,
  promotionReady:finished>=60&&truncated===0&&boardAhead/games>=.6&&
    agents.board.winShareRate>=.45&&margin>=0,
  caveat:'Seeded CPU benchmark only; held-out seeds and multiple board sizes required.'
};
const output=JSON.stringify(report,null,2)+'\n';
if(args.out){mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,output);}
process.stdout.write(output);
