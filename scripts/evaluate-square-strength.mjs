#!/usr/bin/env node
/** Independent square strength evaluation: same seeds, complete seat rotations.
 * No teacher data is loaded; this is an entirely held-out match tournament.
 * Unfinished games are never counted as wins.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pass,play,pointsOnBoard,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {selectComparisonMove,validateComparisonModel} from '../src/architecture-comparison.js';
import {chooseSquareTrainedMove} from '../src/square-policy.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
 const k=process.argv[i],v=process.argv[i+1];
 if(!['--manifest','--out','--games9','--games13','--seed','--policy-mode','--opponents','--horizon-multiplier'].includes(k)||v===undefined)
  throw Error('Bad square benchmark argument: '+k);
 args[k.slice(2)]=v;
}
if(!args.manifest||!args.out)throw Error('Missing --manifest or --out');
const definitions=JSON.parse(readFileSync(args.manifest,'utf8'));
if(!Array.isArray(definitions)||!definitions.length)throw Error('Expected an array of competitors');
const models=new Map();
for(const def of definitions){
 if(!/^[a-z0-9-]+$/.test(def.id)||models.has(def.id))
  throw Error('Duplicate/invalid model label');
 if(def.type==='linear')models.set(def.id,{type:'linear'});
 else if(def.type==='comparison'){
  const model=validateComparisonModel(JSON.parse(readFileSync(def.path,'utf8')));
  if(model.metadata?.boardShape!=='square')throw Error('Expected square policy');
  models.set(def.id,{type:'comparison',model});
 }else throw Error('Unknown policy type');
}
const games={[-9]:Number(args.games9??12),[-13]:Number(args.games13??6)};
const seed=Number(args.seed??20261127);
const policyMode=args['policy-mode']??'greedy';
const opponents=(args.opponents??'balanced,tactical').split(',');
const horizonMultiplier=Number(args['horizon-multiplier']??3);
if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
 Object.values(games).some(n=>!Number.isInteger(n)||n<3||n>90||n%3!==0)||
 !['greedy','sample'].includes(policyMode)||
 opponents.length!==2||opponents.some(s=>!['balanced','tactical','guarded','baseline'].includes(s))||
 !Number.isInteger(horizonMultiplier)||horizonMultiplier<3||horizonMultiplier>20)
 throw Error('Bad benchmark parameters');
const results=[];
for(const [id,entry] of models){
 for(const [stringRadius,count] of Object.entries(games)){
  const radius=Number(stringRadius),limit=pointsOnBoard(radius).length*horizonMultiplier+3;
  const records=[];
  for(let game=0;game<count;game++){
    const seat=game%3,gameSeed=(seed+(-radius)*100003+Math.floor(game/3)*7919)>>>0;
    const rng=COLORS.map((_,i)=>seededRandom((gameSeed+i*151)>>>0));
    let state=createGame(radius),turns=0,earlyPass=false,ourMoves=0,totalDecisionMs=0;
    const others=[0,1,2].filter(x=>x!==seat);
    while(!state.ended&&turns<limit){
      const t=state.turn;
      let move;
      if(t===seat){
        const tick=performance.now();
        move=entry.type==='linear'?chooseSquareTrainedMove(state):
          selectComparisonMove(state,entry.model,{greedy:policyMode==='greedy',temperature:1,
            random:rng[t]}).move;
        totalDecisionMs+=performance.now()-tick;ourMoves++;
        if(move===null&&turns<6)earlyPass=true;
      }else{
        move=chooseMove(state,rng[t],opponents[others.indexOf(t)]);
      }
      const outcome=move?play(state,move.q,move.r):pass(state);
      if(!outcome.ok)throw Error('Illegal evaluated move '+id+' radius '+radius+': '+outcome.reason);
      state=outcome.state;turns++;
    }
    const sc=scores(state),total=Object.values(sc).reduce((a,b)=>a+b,0);
    const win=state.ended?winner(state):[];
    records.push({
      seat,seed:gameSeed,ended:state.ended,truncated:!state.ended,turns,earlyPass,
      stoneShare:total?sc[COLORS[seat]]/total:1/3,
      winShare:state.ended&&win.includes(COLORS[seat])?1/win.length:0,
      decisionMs:totalDecisionMs,decisions:ourMoves
    });
  }
  const finished=records.filter(r=>r.ended),sum=(a,key)=>a.reduce((v,r)=>v+r[key],0);
  const result={
    id,kind:entry.type==='linear'?'linear':entry.model.kind,
    trainingGames:entry.type==='linear'?null:entry.model.metadata.games,
    teacherDistilled:entry.type==='comparison'&&entry.model.metadata.teacherDistillation===true,
    policyMode,radius,seed,opponents,games:count,
    finished:finished.length,truncated:count-finished.length,
    winShare:finished.length?sum(finished,'winShare')/finished.length:null,
    meanStoneShare:sum(records,'stoneShare')/count,
    earlyPasses:records.filter(r=>r.earlyPass).length,
    meanDecisionMs:records.reduce((a,r)=>a+r.decisionMs,0)/
      Math.max(1,records.reduce((a,r)=>a+r.decisions,0)),
    records
  };
  results.push(result);
  console.log(JSON.stringify({...result,records:undefined}));
 }
}
mkdirSync(dirname(args.out),{recursive:true});
writeFileSync(args.out,JSON.stringify({
  version:1,comparison:'square-heldout-rotated',seed,policyMode,opponents,
  games,results
},null,2)+'\n');
