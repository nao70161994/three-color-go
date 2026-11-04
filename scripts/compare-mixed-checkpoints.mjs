#!/usr/bin/env node
/**
 * Mixed-era three-color Go tournament: two distinct contestants + CPU bridge.
 * Compare FINAL stone counts only after natural triple-pass end.
 * Run ALL six seat permutations with seed blocks. Never force a pass.
 * Handles 10-feature comparison, legacy 11-feature PV2 and heuristic CPUs.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {COLORS,createGame,pass,play,pointsOnBoard,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {selectComparisonMove,validateComparisonModel} from '../src/architecture-comparison.js';
import {selectDirectPolicyMove} from '../src/direct-policy.js';
import {validatePV2Model} from '../src/pv2-ai.js';

const BASELINES=['balanced','tactical','baseline'];
const ORDERS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const args={};
for(let i=2;i<process.argv.length;i+=2){
 const key=process.argv[i],v=process.argv[i+1];
 if(!['--manifest','--models-dir','--out','--chunk','--chunks','--radii',
       '--rounds','--seed','--horizon-multiplier','--pairs-file','--mode'].includes(key)||v===undefined)
   throw Error('Unknown/missing argument '+key);
 args[key.slice(2)]=v;
}
if(!args.manifest||!args['models-dir']||!args.out)throw Error('Missing manifest/models-dir/out');
const manifest=JSON.parse(readFileSync(args.manifest,'utf8'));
if(manifest.version!==1||!Array.isArray(manifest.entries))throw Error('Wrong manifest');
const ids=manifest.entries.map(x=>x.id);
if(new Set(ids).size!==ids.length||ids.length<3)throw Error('Duplicate / too few candidate IDs');
for(const entry of manifest.entries){
 if(!/^[a-z0-9-]+$/.test(entry.id)||!['comparison','pv2','cpu'].includes(entry.type))
   throw Error('Invalid candidate entry');
}
const chunk=Number(args.chunk??0),chunks=Number(args.chunks??1),
 rounds=Number(args.rounds??1),seed=Number(args.seed??20661105),
 radii=(args.radii??'3,4').split(',').map(Number),
 horizonMultiplier=Number(args['horizon-multiplier']??20),
 mode=args.mode??'greedy';
if(!Number.isInteger(chunk)||!Number.isInteger(chunks)||chunks<1||chunks>60||chunk<0||chunk>=chunks||
 !Number.isInteger(rounds)||rounds<1||rounds>20||
 !Number.isInteger(seed)||seed<0||seed>0xffffffff||
 radii.length===0||radii.some(r=>!Number.isInteger(r)||r<2||r>5)||
 !Number.isInteger(horizonMultiplier)||horizonMultiplier<3||horizonMultiplier>100||
 !['greedy','stochastic'].includes(mode))throw Error('Invalid tournament settings');

const models=new Map();
for(const entry of manifest.entries){
 if(entry.type==='cpu'){
   if(!BASELINES.includes(entry.id))throw Error('Unknown CPU '+entry.id);
 }else{
   const raw=JSON.parse(readFileSync(join(args['models-dir'],entry.id+'.json'),'utf8'));
   if(entry.type==='comparison'){
     validateComparisonModel(raw);
     if(raw.kind!==entry.kind||raw.metadata.games!==entry.games)
       throw Error('Comparison model identity mismatch '+entry.id);
   }else{
     validatePV2Model(raw);
     if(raw.architecture!=='hex-group-pv-16-v2'||raw.version!==entry.version)
       throw Error('PV2 model identity mismatch '+entry.id);
   }
   models.set(entry.id,raw);
 }
}
const entries=new Map(manifest.entries.map(x=>[x.id,x]));
const candidatePairs=[];
for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)
  candidatePairs.push([ids[a],ids[b]]);
let pairs=candidatePairs;
if(args['pairs-file']){
 const selected=JSON.parse(readFileSync(args['pairs-file'],'utf8'));
 if(!Array.isArray(selected.pairs)||selected.pairs.length===0)throw Error('Empty finalist pairs');
 const key=(a,b)=>[a,b].sort().join('|');
 const set=new Set(selected.pairs.map(([a,b])=>key(a,b)));
 pairs=candidatePairs.filter(([a,b])=>set.has(key(a,b)));
 if(pairs.length!==set.size)throw Error('Unknown or duplicate finalist pair');
}
const chosen=pairs.filter((_,i)=>i%chunks===chunk);
function selectMove(state,id,random){
 const entry=entries.get(id);
 if(entry.type==='cpu')return chooseMove(state,random,id);
 const model=models.get(id);
 const options={random,temperature:1.0,greedy:mode==='greedy'};
 return entry.type==='comparison'?
   selectComparisonMove(state,model,options).move:
   selectDirectPolicyMove(state,model,options).move;
}
function playOne(a,b,bridge,order,radius,gameSeed){
 const seatTypes=order.map(i=>[a,b,bridge][i]);
 const random=COLORS.map((_,seat)=>
   seededRandom((gameSeed+1009*(seat+1)+0x9e3779b9)>>>0));
 const cap=pointsOnBoard(radius).length*horizonMultiplier+3;
 let state=createGame(radius),turns=0,passes=0;
 while(!state.ended&&turns<cap){
   const s=state.turn,move=selectMove(state,seatTypes[s],random[s]);
   if(!move)passes++;
   const outcome=move?play(state,move.q,move.r):pass(state);
   if(!outcome.ok)throw Error('Invalid '+seatTypes[s]+' move: '+outcome.reason);
   state=outcome.state;turns++;
 }
 const score=scores(state),stone=COLORS.map(color=>score[color]);
 const at=who=>stone[seatTypes.indexOf(who)];
 const countA=at(a),countB=at(b);
 const winning=state.ended?winner(state):[];
 const shareOf=who=>state.ended&&winning.includes(COLORS[seatTypes.indexOf(who)])?
   1/winning.length:0;
 const total=stone.reduce((x,y)=>x+y,0);
 return {ended:state.ended,turns,passes,
   rankScoreA:state.ended?(countA>countB?1:countA<countB?0:.5):null,
   winShareA:shareOf(a),winShareB:shareOf(b),
   observedStoneA:total?countA/total:1/3,
   observedStoneB:total?countB/total:1/3};
}
const reports=[];
for(const [a,b] of chosen){
  // Pairwise comparison always puts two different candidates in different
  // seats. Third player is an external known CPU, not another model that
  // accidentally inherits the winner's policy.
  const bridge=BASELINES.find(x=>x!==a&&x!==b);
  const result={a,b,bridge,games:0,finished:0,truncated:0,
    aOutranksB:0,ties:0,bOutranksA:0,winShareA:0,winShareB:0,
    observedStoneA:0,observedStoneB:0,passes:0,totalTurns:0,
    radii:Object.fromEntries(radii.map(r=>[r,{games:0,finished:0,outrankA:0,
     outrankB:0,ties:0,winShareA:0,winShareB:0}]))};
  const pairIndex=candidatePairs.findIndex(pair=>pair[0]===a&&pair[1]===b);
  for(const radius of radii)for(let rep=0;rep<rounds;rep++){
    const gameSeed=(seed+pairIndex*7919+radius*131071+rep*100003)>>>0;
    for(const order of ORDERS){
      const m=playOne(a,b,bridge,order,radius,gameSeed);
      const r=result.radii[radius];result.games++;r.games++;
      result.totalTurns+=m.turns;result.passes+=m.passes;
      result.observedStoneA+=m.observedStoneA;result.observedStoneB+=m.observedStoneB;
      if(m.ended){
        result.finished++;r.finished++;
        result.aOutranksB+=m.rankScoreA===1?1:0;
        result.bOutranksA+=m.rankScoreA===0?1:0;
        result.ties+=m.rankScoreA===.5?1:0;
        r.outrankA+=m.rankScoreA===1?1:0;
        r.outrankB+=m.rankScoreA===0?1:0;
        r.ties+=m.rankScoreA===.5?1:0;
        result.winShareA+=m.winShareA;result.winShareB+=m.winShareB;
        r.winShareA+=m.winShareA;r.winShareB+=m.winShareB;
      }else result.truncated++;
    }
  }
  result.meanObservedStoneA=result.observedStoneA/result.games;
  result.meanObservedStoneB=result.observedStoneB/result.games;
  result.meanTurns=result.totalTurns/result.games;
  for(const r of Object.values(result.radii)){
    r.aOutrankRate=r.finished?(r.outrankA+.5*r.ties)/r.finished:null;
    r.aWinShareRate=r.finished?r.winShareA/r.finished:null;
    r.bWinShareRate=r.finished?r.winShareB/r.finished:null;
  }
  reports.push(result);
  console.log(JSON.stringify({a,b,bridge,finished:result.finished,games:result.games,
    aRate:result.finished?(result.aOutranksB+.5*result.ties)/result.finished:null}),
    );
}
mkdirSync(dirname(args.out),{recursive:true});
writeFileSync(args.out,JSON.stringify({version:1,seed,chunk,chunks,rounds,radii,mode,
  horizonMultiplier,candidateCount:ids.length,pairCount:chosen.length,pairs:reports},null,2)+'\n');
console.log('Completed cross-era comparison chunk:',chunk,'/',chunks,'pairs:',reports.length);
