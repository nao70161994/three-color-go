#!/usr/bin/env node
/** No-search PV2 versus two independently seeded conventional CPUs.
 * Rotates all six seats; reports both opponents (including repeated types).
 * No model weights or production behavior are modified.
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
  if(!['--model','--radius','--games','--seed','--opponents','--out'].includes(k)||
      v===undefined)throw Error('Invalid evaluation argument '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model required');
const model=validatePV2Model(JSON.parse(readFileSync(args.model,'utf8')));
const radius=Number(args.radius??3),games=Number(args.games??12),
  seed=Number(args.seed??20261121);
const opponents=(args.opponents??'hard,balanced').split(',');
const available=new Set(['hard','balanced','guarded','tactical','baseline']);
if(!Number.isInteger(radius)||radius<2||radius>5||
   !Number.isInteger(games)||games<6||games>300||games%6!==0||
   !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
   opponents.length!==2||opponents.some(x=>!available.has(x)))
  throw Error('Invalid evaluation setup');
const rotations=[
  ['direct','op1','op2'],['direct','op2','op1'],
  ['op1','direct','op2'],['op2','direct','op1'],
  ['op1','op2','direct'],['op2','op1','direct']
];
const records=[],winShare={direct:0,op1:0,op2:0};
for(let i=0;i<games;i++){
  const order=rotations[i%6],round=Math.floor(i/6),
    gameSeed=(seed+round*100003)>>>0;
  const rand=COLORS.map((_,seat)=>seededRandom((gameSeed+151*seat)>>>0));
  let state=createGame(radius),turns=0;
  const cap=pointsOnBoard(radius).length*2;
  while(!state.ended&&turns<cap+3){
    const seat=state.turn,key=order[seat];
    const type=key==='direct'?'direct':opponents[key==='op1'?0:1];
    const move=type==='direct'
      ?selectDirectPolicyMove(state,model,{greedy:true}).move
      :type==='hard'
        ?chooseStrongMove(state,rand[seat])
        :chooseMove(state,rand[seat],type);
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Invalid match action: '+result.reason);
    state=result.state;turns++;
  }
  if(!state.ended){
    records.push({order,gameSeed,ended:false,turns});continue;
  }
  const count=scores(state),winners=winner(state);
  const points=Object.fromEntries(order.map((key,seat)=>[key,count[COLORS[seat]]]));
  for(const key of order)
    if(winners.includes(COLORS[order.indexOf(key)]))
      winShare[key]+=1/winners.length;
  const total=Object.values(points).reduce((a,b)=>a+b,0);
  records.push({order,gameSeed,ended:true,turns,points,winners,
    directStoneShare:total?points.direct/total:1/3});
}
const finished=records.filter(r=>r.ended);
const mean=fn=>finished.length?
  +(finished.reduce((s,r)=>s+fn(r),0)/finished.length).toFixed(5):null;
const vs=key=>({
  ahead:finished.filter(r=>r.points.direct>r.points[key]).length,
  behind:finished.filter(r=>r.points.direct<r.points[key]).length,
  tied:finished.filter(r=>r.points.direct===r.points[key]).length,
  meanStoneMargin:mean(r=>r.points.direct-r.points[key])
});
const report={
  version:1,algorithm:'direct-policy-no-search',model:model.version,
  trainingGames:model.metadata?.games??null,
  learningRate:model.metadata?.learningRate??null,
  radius,games,finished:finished.length,truncated:games-finished.length,
  seed,opponents,vsOp1:vs('op1'),vsOp2:vs('op2'),
  directWinShareRate:finished.length?+(winShare.direct/finished.length).toFixed(5):null,
  directMeanStoneShare:mean(r=>r.directStoneShare),
  directMeanStones:mean(r=>r.points.direct),
  promotionReady:false,
  samples:records.slice(0,6),
  caveat:'Exploratory seat-rotated seeded 3-player matchups, not proof of general strength.'
};
const output=JSON.stringify(report,null,2)+'\n';
if(args.out){mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,output);}
process.stdout.write(output);
