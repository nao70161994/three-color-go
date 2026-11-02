#!/usr/bin/env node
/** Experimental cross-size CPU benchmark with fixed frozen PV2 weights.
 * No model adaptation, MCTS, move hinting, or production CPU change.
 * Writes incremental progress after every finished game for long-size runs.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pointsOnBoard,play,pass,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {selectDirectPolicyMove} from '../src/direct-policy.js';
import {validatePV2Model} from '../src/pv2-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],val=process.argv[i+1];
  if(!['--model','--radius','--games','--seed','--opponents','--max-seconds','--out'].includes(key)||val===undefined)
    throw Error('Invalid argument '+key);
  args[key.slice(2)]=val;
}
if(!args.model||!args.out)throw Error('Require --model and --out');
const model=validatePV2Model(JSON.parse(readFileSync(args.model,'utf8')));
const radius=Number(args.radius),games=Number(args.games),seed=Number(args.seed??20441101),
  maxSeconds=Number(args['max-seconds']??6600);
const opponents=(args.opponents??'baseline,baseline').split(',');
if(!Number.isInteger(radius)||radius<2||radius>12||
 !Number.isInteger(games)||games<1||games>96||
 !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
 !Number.isFinite(maxSeconds)||maxSeconds<5||maxSeconds>18000||
 opponents.length!==2||opponents.some(x=>!['baseline','balanced','tactical','guarded'].includes(x)))
 throw Error('Invalid evaluation parameters');
const start=performance.now(),limit=maxSeconds*1000;
const turnsCap=pointsOnBoard(radius).length*2+3;
const countPoints=pointsOnBoard(radius).length;
const rotations=[
 ['direct','op1','op2'],['direct','op2','op1'],
 ['op1','direct','op2'],['op2','direct','op1'],
 ['op1','op2','direct'],['op2','op1','direct']
];
const results=[];
const output=()=>{
 const complete=results.filter(r=>r.finished);
 const mean=key=>complete.length?complete.reduce((s,r)=>s+r[key],0)/complete.length:null;
 const report={experiment:'cross-size-frozen-pv2',radius,points:countPoints,
  trainingRadii:[2,3,4],gamesRequested:games,gamesFinished:complete.length,
  gamesRecorded:results.length,seed,opponents,maxSeconds,
  modelVersion:model.version,trainingGames:model.metadata?.games??null,
  learningRate:model.metadata?.learningRate??null,
  meanStoneShare:mean('stoneShare'),winShareRate:mean('winShare'),
  averageGameMs:mean('gameMs'),averageMoves:mean('turns'),
  maxGameMs:complete.length?Math.max(...complete.map(r=>r.gameMs)):null,
  elapsedMs:Math.round(performance.now()-start),
  status:results.length===games&&complete.length===games?'complete':'partial',
  notes:'All seat permutations of the 3 players; consistent frozen weights and third-party CPU strategies. Across sizes, games/sample sizes differ and outcomes are not direct Elo.',
  results};
 mkdirSync(dirname(args.out),{recursive:true});
 writeFileSync(args.out,JSON.stringify(report,null,2)+'\n');
 return report;
};
const initial=createGame(radius),t0=performance.now();
const first=selectDirectPolicyMove(initial,model,{greedy:true}).move;
if(!first||!play(initial,first.q,first.r).ok)
 throw Error('Initial frozen policy inference failed for radius '+radius);
const openingMs=Math.round(performance.now()-t0);
console.log(JSON.stringify({event:'first-legal-move',radius,points:countPoints,openingMs,first}));
output();
for(let i=0;i<games;i++){
 if(performance.now()-start>limit){
   console.log(JSON.stringify({event:'time-budget-exceeded',radius,complete:results.length}));
   break;
 }
 const order=rotations[i%6],block=Math.floor(i/6),
   gameSeed=(seed+block*100003)>>>0;
 const random=COLORS.map((_,seat)=>seededRandom((gameSeed+151*seat)>>>0));
 let state=createGame(radius),turns=0;
 const gameStart=performance.now();
 while(!state.ended&&turns<turnsCap){
   if(turns%6===0 && performance.now()-start>limit)break;
   const seat=state.turn,key=order[seat],type=key==='op1'?opponents[0]:opponents[1];
   const move=key==='direct'
     ?selectDirectPolicyMove(state,model,{greedy:true}).move
     :chooseMove(state,random[seat],type);
   const r=move?play(state,move.q,move.r):pass(state);
   if(!r.ok)throw Error('Illegal move in size test: '+r.reason);
   state=r.state;turns++;
 }
 const gameMs=Math.round(performance.now()-gameStart);
 if(!state.ended){
   results.push({finished:false,order,gameSeed,turns,gameMs,reason:'time-budget-or-turn-cap'});
   console.log(JSON.stringify({event:'incomplete',radius,game:i+1,turns,gameMs}));
   output();break;
 }
 const count=scores(state),winners=winner(state),
   directSeat=order.indexOf('direct'),directColor=COLORS[directSeat],
   total=Object.values(count).reduce((s,n)=>s+n,0),
   share=total?count[directColor]/total:1/3;
 const winShare=winners.includes(directColor)?1/winners.length:0;
 results.push({finished:true,order,gameSeed,turns,gameMs,
   stoneShare:share,winShare,directStones:count[directColor],
   scores:count,winners});
 console.log(JSON.stringify({event:'finished',radius,game:i+1,turns,gameMs,share,winShare}));
 output();
}
const final=output();
console.log(JSON.stringify({event:'summary',radius,points:countPoints,
 status:final.status,gamesFinished:final.gamesFinished,meanStoneShare:final.meanStoneShare,
 winShareRate:final.winShareRate,averageGameMs:final.averageGameMs,elapsedMs:final.elapsedMs}));
