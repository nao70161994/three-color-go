#!/usr/bin/env node
/** On-policy three-color league play: one learning seat, one frozen reference
 * and one seeded heuristic / frozen opponent. All rules, including legal pass
 * and positional superko, remain entirely in src/game.js.
 * This is genuine model-controlled gameplay, not scripted teacher labels.
 */
import {readFileSync} from 'node:fs';
import {COLORS,createGame,pass,play,pointsOnBoard,pointKey,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom,legalMoves} from '../src/agent.js';
import {PV3_ARCH,encodePV2State} from '../src/pv2-ai.js';
import {selectComparisonMove,validateComparisonModel} from '../src/architecture-comparison.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
 const k=process.argv[i],v=process.argv[i+1];
 if(!['--model','--anchor','--radius','--games','--seed','--temperature','--horizon-multiplier','--sample-stride'].includes(k)||v===undefined)
  throw Error('Invalid league argument '+k);
 args[k.slice(2)]=v;
}
if(!args.model||!args.anchor)throw Error('--model and --anchor required');
const active=validateComparisonModel(JSON.parse(readFileSync(args.model,'utf8')));
const anchor=validateComparisonModel(JSON.parse(readFileSync(args.anchor,'utf8')));
const radius=Number(args.radius??-9),games=Number(args.games??3),seed=Number(args.seed??20261116),
 temperature=Number(args.temperature??1),horizonMultiplier=Number(args['horizon-multiplier']??3),
 sampleStride=Number(args['sample-stride']??2);
if(![-9,-13,-19].includes(radius)||active.kind!==anchor.kind||
 active.metadata?.boardShape!=='square'||anchor.metadata?.boardShape!=='square'||
 !Number.isInteger(games)||games<1||games>24||
 !Number.isInteger(seed)||seed<0||seed>0xffffffff||
 !Number.isFinite(temperature)||temperature<=0||temperature>5||
 !Number.isInteger(horizonMultiplier)||horizonMultiplier<2||horizonMultiplier>10||
 !Number.isInteger(sampleStride)||sampleStride<1||sampleStride>8)
 throw Error('Invalid league configuration');
const points=pointsOnBoard(radius),lookup=new Map(points.map((p,i)=>[pointKey(p.q,p.r),i]));
const horizon=points.length*horizonMultiplier+3;
for(let game=0;game<games;game++){
 const gameSeed=(seed+game*100003)>>>0;
 const seat=game%3,rng=COLORS.map((_,i)=>seededRandom((gameSeed+71+1013*i)>>>0));
 const others=[0,1,2].filter(x=>x!==seat),frozenSeat=others[0],
   teacherSeat=others[1],teacherStyle=['balanced','tactical','guarded'][game%3];
 let state=createGame(radius),turns=0,candidateMoves=0,earlyPasses=0,positions=[];
 while(!state.ended&&turns<horizon){
   const turn=state.turn;
   let move,selected,actionIndex;
   if(turn===seat){
     selected=selectComparisonMove(state,active,{random:rng[turn],temperature});
     move=selected.move;
     actionIndex=selected.action.index;
     if(move===null&&turns<9)earlyPasses++;
     if(candidateMoves%sampleStride===0){
       const encoded=encodePV2State(state,{architecture:PV3_ARCH});
       positions.push({features:encoded.features,legal:selected.actions.map(a=>a.index),
         selected:actionIndex,seat:turn});
     }
     candidateMoves++;
   }else if(turn===frozenSeat||(game%4===3)){
     move=selectComparisonMove(state,anchor,{random:rng[turn],greedy:true,temperature:1}).move;
   }else if(turn===teacherSeat){
     move=chooseMove(state,rng[turn],teacherStyle);
   }else throw Error('Unexpected league seat');
   const outcome=move?play(state,move.q,move.r):pass(state);
   if(!outcome.ok)throw Error('Illegal league move: '+outcome.reason);
   state=outcome.state;turns++;
 }
 const sc=scores(state),stone=COLORS.map(c=>sc[c]),
   total=stone.reduce((a,b)=>a+b,0),shares=stone.map(x=>total?x/total:1/3);
 const winners=state.ended?winner(state):[];
 const winning=COLORS.map(color=>state.ended&&winners.includes(color)?1/winners.length:0);
 // Optimize terminal victory and residual stones; a truncated game is never a win.
 const reward=shares.map((share,i)=>0.5*share+0.5*winning[i]-(state.ended?0:0.3));
 for(const p of positions)p.value=[0,1,2].map(i=>reward[(p.seat+i)%3]);
 process.stdout.write(JSON.stringify({gameSeed,radius,candidateSeat:seat,
  frozenSeat,teacherSeat,teacherStyle,
  finished:state.ended,truncated:!state.ended,turns,horizon,
  wins:winning,shares,rewards:reward,earlyPasses,candidateMoves,samples:positions})+'\n');
}
