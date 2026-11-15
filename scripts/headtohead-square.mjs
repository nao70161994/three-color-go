#!/usr/bin/env node
/** Independent 3-color head-to-head: both AI contenders share one actual board.
 * Complete 6-seat permutations per replicate and a fixed third-party CPU.
 * A win counts only after genuine triple-pass terminal state.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createGame,play,pass,pointsOnBoard,scores,winner,COLORS} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {selectComparisonMove,validateComparisonModel} from '../src/architecture-comparison.js';
import {chooseSquareTrainedMove} from '../src/square-policy.js';
const ORDERS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const args={};
for(let i=2;i<process.argv.length;i+=2){
 const k=process.argv[i],v=process.argv[i+1];
 if(!['--manifest','--pair','--seed','--games9','--games13','--mode','--bridge','--out'].includes(k)||v===undefined)throw Error('Unknown option '+k);
 args[k.slice(2)]=v;
}
if(!args.manifest||!args.pair||!args.out)throw Error('Missing required tournament arguments');
const pairs=JSON.parse(readFileSync(args.manifest,'utf8')),players=new Map();
for(const p of pairs){
 if(players.has(p.id))throw Error('Duplicate model');
 players.set(p.id,p.type==='linear'?null:validateComparisonModel(JSON.parse(readFileSync(p.path,'utf8'))));
}
const [a,b]=args.pair.split(','),bridge=args.bridge??'balanced';
const seed=Number(args.seed??20270121),mode=args.mode??'greedy',
 games9=Number(args.games9??24),games13=Number(args.games13??12);
if(!players.has(a)||!players.has(b)||a===b||
 !['baseline','tactical','guarded','balanced'].includes(bridge)||
 !['greedy','sample'].includes(mode)||[games9,games13].some(n=>!Number.isSafeInteger(n)||n<6||n%6!==0||n>120)||
 !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid tournament configuration');
function choice(state,id,rng){
 if(id==='bridge')return chooseMove(state,rng,bridge);
 const model=players.get(id);
 if(model===null)return chooseSquareTrainedMove(state);
 return selectComparisonMove(state,model,{greedy:mode==='greedy',random:rng,temperature:1.0}).move;
}
const reports=[];
for(const [size,games] of [[9,games9],[13,games13]]){
 const radius=-size,limit=pointsOnBoard(radius).length*3+3;
 const records=[];
 for(let g=0;g<games/6;g++){
  const gameSeed=(seed+size*7919+g*100003)>>>0;
  for(const order of ORDERS){
   const identities=order.map(i=>[a,b,'bridge'][i]);
   const rng=COLORS.map((_,i)=>seededRandom((gameSeed+1009*(i+1))>>>0));
   let state=createGame(radius),turns=0;
   while(!state.ended&&turns<limit){
    const me=state.turn;
    const move=choice(state,identities[me],rng[me]);
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Illegal turn from '+identities[me]+': '+result.reason);
    state=result.state;turns++;
   }
   const count=scores(state),points=identities.map((id,i)=>count[COLORS[i]]);
   const aIndex=identities.indexOf(a),bIndex=identities.indexOf(b),
     total=points.reduce((x,y)=>x+y,0);
   const winners=state.ended?winner(state):[];
   records.push({order:identities,seed:gameSeed,ended:state.ended,turns,
     countA:points[aIndex],countB:points[bIndex],
     rankA:state.ended?(points[aIndex]>points[bIndex]?1:points[aIndex]<points[bIndex]?0:.5):null,
     winnerA:state.ended&&winners.includes(COLORS[aIndex])?1/winners.length:0,
     winnerB:state.ended&&winners.includes(COLORS[bIndex])?1/winners.length:0,
     shareA:total?points[aIndex]/total:1/3,
     shareB:total?points[bIndex]/total:1/3});
  }
 }
 const complete=records.filter(r=>r.ended),aggregate=(fn)=>records.reduce((n,r)=>n+fn(r),0);
 const sum=(fn)=>complete.reduce((n,r)=>n+fn(r),0);
 const metrics={
  board:size,games,finished:complete.length,truncated:games-complete.length,
  winShareA:complete.length?sum(r=>r.winnerA)/complete.length:null,
  winShareB:complete.length?sum(r=>r.winnerB)/complete.length:null,
  aOutranksB:complete.length?sum(r=>r.rankA)/complete.length:null,
  observedStoneA:aggregate(r=>r.shareA)/games,
  observedStoneB:aggregate(r=>r.shareB)/games,
  records
 };
 reports.push(metrics);
 console.log(JSON.stringify({...metrics,records:undefined}));
}
mkdirSync(dirname(args.out),{recursive:true});
writeFileSync(args.out,JSON.stringify({version:1,labels:{a,b,bridge},seed,mode,reports},null,2)+'\n');
