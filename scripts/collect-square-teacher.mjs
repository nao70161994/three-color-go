#!/usr/bin/env node
/** Generate reproducible teacher trajectories using the exact square-board rules.
 * Games, not individual moves, are split into training and held-out validation.
 * No model is evaluated on its own teacher-data validation games.
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createGame,play,pass,pointsOnBoard,pointKey} from '../src/game.js';
import {chooseMove,seededRandom,legalMoves} from '../src/agent.js';
import {PV3_ARCH,encodePV2State} from '../src/pv2-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
 const k=process.argv[i],v=process.argv[i+1];
 if(!['--train9','--valid9','--train13','--valid13','--seed','--stride','--out'].includes(k)||v===undefined)
   throw Error('Unknown or incomplete argument: '+k);
 args[k.slice(2)]=v;
}
const config={
 train9:Number(args.train9??12),valid9:Number(args.valid9??3),
 train13:Number(args.train13??3),valid13:Number(args.valid13??1),
 seed:Number(args.seed??20261115),stride:Number(args.stride??2),
 out:args.out??'reports/square-strength/teacher-games.jsonl'
};
if(Object.entries(config).some(([key,v])=>key!=='out'&&(!Number.isSafeInteger(v)||v<0))||
  config.stride<1||config.stride>12||
  config.train9<1||config.valid9<1||config.train13<1||config.valid13<1||
  config.train9+config.valid9>60||config.train13+config.valid13>20)
 throw Error('Invalid teacher curriculum');
const rows=[];
const stats={...config,games:{},samples:{train:0,valid:0},strategyBySeat:{}};
const sets=[['train',9,config.train9],['valid',9,config.valid9],
 ['train',13,config.train13],['valid',13,config.valid13]];
for(const [split,n,games] of sets){
 const radius=-n,points=pointsOnBoard(radius);
 const lookup=new Map(points.map(({q,r},i)=>[pointKey(q,r),i]));
 const key=split+n;
 stats.games[key]=0;
 for(let g=0;g<games;g++){
   const gameId=split+'-'+n+'-'+g;
   // Separated seed domains avoid accidental seed reuse across train/validation.
   const gameSeed=(config.seed+(split==='train'?0:100000001)+n*100003+g*7919)>>>0;
   const rng=seededRandom(gameSeed);
   const strategies=['balanced','tactical','guarded'];
   const strategyBySeat=[0,1,2].map(i=>strategies[(i+g)%3]);
   let state=createGame(radius),turns=0,passes=0;
   const maxTurns=2*points.length+3;
   let examples=0;
   while(!state.ended&&turns<maxTurns){
     const teacher=chooseMove(state,rng,strategyBySeat[state.turn]);
     const actionIndex=teacher?lookup.get(pointKey(teacher.q,teacher.r)):points.length;
     if(actionIndex===undefined)throw Error('Teacher pointed outside board');
     if(turns%config.stride===g%config.stride||state.passes>0){
       const legal=legalMoves(state).map(x=>lookup.get(pointKey(x.q,x.r)));
       legal.push(points.length);
       if(!legal.includes(actionIndex))throw Error('Teacher emitted illegal action');
       const encoded=encodePV2State(state,{architecture:PV3_ARCH});
       rows.push(JSON.stringify({
         split,gameId,radius,gameSeed,turn:state.turn,turns,
         strategy:strategyBySeat[state.turn],features:encoded.features,
         legal,selected:actionIndex
       }));
       examples++;
       stats.samples[split]++;
     }
     const outcome=teacher?play(state,teacher.q,teacher.r):pass(state);
     if(!outcome.ok)throw Error('Bad teacher action '+outcome.reason);
     if(teacher===null)passes++;
     state=outcome.state;turns++;
   }
   if(!state.ended)throw Error('Teacher game exceeded genuine ending horizon: '+gameId);
   stats.games[key]++;
   stats.strategyBySeat[gameId]=strategyBySeat;
   console.error(JSON.stringify({gameId,turns,examples,passes,ended:state.ended}));
 }
}
mkdirSync(dirname(config.out),{recursive:true});
writeFileSync(config.out,rows.join('\n')+'\n');
writeFileSync(config.out+'.meta.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify({...stats,records:rows.length},null,2));
