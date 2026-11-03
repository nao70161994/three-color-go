#!/usr/bin/env node
/** Compare TWO different frozen PV2 policies with the same third CPU.
 * Six seat permutations per block remove fixed color/turn-order advantages.
 * No weights are updated and all network moves are greedy and search-free.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pass,play,pointsOnBoard,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';
import {selectDirectPolicyMove} from '../src/direct-policy.js';
import {validatePV2Model} from '../src/pv2-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model-a','--model-b','--radius','--games','--seed','--opponent','--out'].includes(k)||v===undefined)
    throw Error('Invalid matchup argument '+k);
  args[k.slice(2)]=v;
}
if(!args['model-a']||!args['model-b'])throw Error('Require both --model-a and --model-b');
const modelA=validatePV2Model(JSON.parse(readFileSync(args['model-a'],'utf8')));
const modelB=validatePV2Model(JSON.parse(readFileSync(args['model-b'],'utf8')));
const radius=Number(args.radius??3),games=Number(args.games??48),seed=Number(args.seed??20321101);
const opponent=args.opponent??'hard';
if(!Number.isInteger(radius)||radius<2||radius>5||
  !Number.isInteger(games)||games<6||games>600||games%6!==0||
  !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
  !new Set(['hard','balanced','guarded','tactical','baseline']).has(opponent))
  throw Error('Invalid matchup config');
const rotations=[
  ['a','b','cpu'],['a','cpu','b'],
  ['b','a','cpu'],['b','cpu','a'],
  ['cpu','a','b'],['cpu','b','a']
];
const winShares={a:0,b:0,cpu:0},results=[];
for(let i=0;i<games;i++){
  const order=rotations[i%6],block=Math.floor(i/6),
    gameSeed=(seed+block*100003)>>>0;
  const random=COLORS.map((_,seat)=>seededRandom((gameSeed+151*seat)>>>0));
  let state=createGame(radius),turns=0;
  const cap=pointsOnBoard(radius).length*3;
  while(!state.ended&&turns<cap+3){
    const seat=state.turn,key=order[seat];
    const move=key==='a'||key==='b'
      ?selectDirectPolicyMove(state,key==='a'?modelA:modelB,{greedy:true}).move
      :opponent==='hard'
        ?chooseStrongMove(state,random[seat])
        :chooseMove(state,random[seat],opponent);
    const r=move?play(state,move.q,move.r):pass(state);
    if(!r.ok)throw Error('Invalid game action: '+r.reason);
    state=r.state;turns++;
  }
  // If three players fail to pass consecutively, retain the capped position.
  // This is not a terminal win; never force strategic passes in evaluation.
  const count=scores(state),winnerColors=state.ended?winner(state):[];
  const stoneCounts=Object.fromEntries(order.map((key,seat)=>[key,count[COLORS[seat]]]));
  const total=Object.values(stoneCounts).reduce((a,b)=>a+b,0);
  for(const key of order)if(winnerColors.includes(COLORS[order.indexOf(key)]))
    winShares[key]+=1/winnerColors.length;
  results.push({gameSeed,block,order,turns,ended:state.ended,stoneCounts,
    stoneShares:Object.fromEntries(order.map(key=>[key,total?stoneCounts[key]/total:1/3])),
    winnerKeys:order.filter(key=>winnerColors.includes(COLORS[order.indexOf(key)]))});
}
const avg=(fn)=>+(results.reduce((a,r)=>a+fn(r),0)/games).toFixed(6);
const finished=results.filter(r=>r.ended),truncated=games-finished.length;
const report={
  version:2,algorithm:'pv2-greedy-head-to-head',radius,opponent,games,seed,
  finished:finished.length,truncated,horizon:cap+3,
  labels:{a:args['model-a'],b:args['model-b']},
  metadata:{a:modelA.metadata??null,b:modelB.metadata??null},
  // Observed stone counts, including censored games; not win counts.
  wins:{a:results.filter(r=>r.stoneCounts.a>r.stoneCounts.b).length,
    b:results.filter(r=>r.stoneCounts.a<r.stoneCounts.b).length,
    tied:results.filter(r=>r.stoneCounts.a===r.stoneCounts.b).length},
  finishedWins:{a:finished.filter(r=>r.stoneCounts.a>r.stoneCounts.b).length,
    b:finished.filter(r=>r.stoneCounts.a<r.stoneCounts.b).length,
    tied:finished.filter(r=>r.stoneCounts.a===r.stoneCounts.b).length},
  meanStoneShare:{a:avg(r=>r.stoneShares.a),b:avg(r=>r.stoneShares.b),cpu:avg(r=>r.stoneShares.cpu)},
  meanStones:{a:avg(r=>r.stoneCounts.a),b:avg(r=>r.stoneCounts.b)},
  meanMarginAminusB:avg(r=>r.stoneCounts.a-r.stoneCounts.b),
  winShareRate:Object.fromEntries(Object.entries(winShares).map(([k,v])=>[
    k,finished.length?+(v/finished.length).toFixed(6):null])),
  rotationsPerBlock:6,results,
  note:'All six seat rotations, no training/search/strategic veto. Games unfinished at 3x cells +3 moves are censored; observed stone shares are NOT terminal wins. H2H is conditional on third CPU.'
};
const output=JSON.stringify(report,null,2)+'\n';
if(args.out){mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,output)}
process.stdout.write(output);
