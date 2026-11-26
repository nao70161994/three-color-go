#!/usr/bin/env node
/** Fair, fully reproducible 3-player hybrid strength A/B on actual game rules.
 * Both compared players share EACH game, seat rotated through all 6 orders.
 * Rankings are head-to-head stone counts; game wins count only if ended.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pass,play,pointsOnBoard,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {chooseSquareTrainedMove} from '../src/square-policy.js';
import {chooseSquareHybridMove,SQUARE_HYBRID_VARIANTS,getHybridSourceModel} from '../src/square-hybrid-ai.js';
import {selectComparisonMove} from '../src/architecture-comparison.js';
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const argv={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--a','--b','--third','--games9','--games13','--games19','--seed','--out','--max-turn-multiplier'].includes(k)||v===undefined)throw Error('Invalid argument '+k);
  argv[k.slice(2)]=v;
}
const a=argv.a??'teacher-guard',b=argv.b??'neural',third=argv.third??'balanced';
const games=[Number(argv.games9??12),Number(argv.games13??6),Number(argv.games19??0)];
const seed=Number(argv.seed??20261127),multiplier=Number(argv['max-turn-multiplier']??3);
const options=['neural','linear','balanced','guarded','tactical','baseline',...Object.keys(SQUARE_HYBRID_VARIANTS)];
if(a===b||!options.includes(a)||!options.includes(b)||!options.includes(third)||
 games.every(n=>n===0)||games.some(n=>!Number.isInteger(n)||n<0||n>120||(n>0&&(n<6||n%6!==0)))||
 !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
 !Number.isInteger(multiplier)||multiplier<2||multiplier>12||!argv.out)throw Error('Invalid tournament configuration');

function choose(state,id,random){
  if(id==='neural')return selectComparisonMove(state,getHybridSourceModel(state.radius),{greedy:true}).move;
  if(id==='linear')return chooseSquareTrainedMove(state);
  if(Object.hasOwn(SQUARE_HYBRID_VARIANTS,id))return chooseSquareHybridMove(state,null,id);
  return chooseMove(state,random,id);
}
const results=[];
for(const [size,gamesCount] of [[9,games[0]],[13,games[1]],[19,games[2]]]){
  if(!gamesCount)continue;
  const radius=-size,limit=pointsOnBoard(radius).length*multiplier+3;
  const records=[];
  for(let group=0;group<gamesCount/6;group++){
    const gameSeed=(seed+size*100003+group*7919)>>>0;
    for(const perm of orders){
      const players=perm.map(index=>[a,b,third][index]);
      const rng=COLORS.map((_,index)=>seededRandom((gameSeed+index*107)>>>0));
      let state=createGame(radius),turns=0;
      const moves=[0,0,0],duration=[0,0,0],earlyPasses=[0,0,0];
      while(!state.ended&&turns<limit){
        const player=state.turn,tick=performance.now();
        const move=choose(state,players[player],rng[player]);
        duration[player]+=performance.now()-tick;moves[player]++;
        if(move===null&&turns<6)earlyPasses[player]++;
        const result=move?play(state,move.q,move.r):pass(state);
        if(!result.ok)throw Error(players[player]+' made an illegal move: '+result.reason);
        state=result.state;turns++;
      }
      const score=scores(state);
      const stones=COLORS.map(c=>score[c]);
      const total=stones.reduce((v,x)=>v+x,0);
      const winners=state.ended?winner(state):[];
      const aIndex=players.indexOf(a),bIndex=players.indexOf(b),thirdIndex=players.indexOf(third);
      records.push({gameSeed,players,finished:state.ended,turns,
        winA:state.ended&&winners.includes(COLORS[aIndex])?1/winners.length:0,
        winB:state.ended&&winners.includes(COLORS[bIndex])?1/winners.length:0,
        winThird:state.ended&&winners.includes(COLORS[thirdIndex])?1/winners.length:0,
        stoneA:total?stones[aIndex]/total:1/3,stoneB:total?stones[bIndex]/total:1/3,
        aboveB:state.ended?(stones[aIndex]>stones[bIndex]?1:stones[aIndex]<stones[bIndex]?0:0.5):null,
        earlyPassA:earlyPasses[aIndex],earlyPassB:earlyPasses[bIndex],
        meanMsA:duration[aIndex]/Math.max(1,moves[aIndex]),
        meanMsB:duration[bIndex]/Math.max(1,moves[bIndex])});
    }
  }
  const complete=records.filter(r=>r.finished);
  const avg=(r,field)=>r.length?r.reduce((v,x)=>v+x[field],0)/r.length:null;
  const result={size,seed,a,b,third,totalGames:gamesCount,finished:complete.length,truncated:gamesCount-complete.length,
    winShareA:avg(complete,'winA'),winShareB:avg(complete,'winB'),
    winShareThird:avg(complete,'winThird'),rankAboveB:avg(complete,'aboveB'),
    observedStoneA:avg(records,'stoneA'),observedStoneB:avg(records,'stoneB'),
    earlyPassA:records.reduce((v,x)=>v+x.earlyPassA,0),
    earlyPassB:records.reduce((v,x)=>v+x.earlyPassB,0),
    meanDecisionMsA:avg(records,'meanMsA'),meanDecisionMsB:avg(records,'meanMsB'),
    records};
  results.push(result);
  console.log(JSON.stringify({...result,records:undefined}));
}
mkdirSync(dirname(argv.out),{recursive:true});
writeFileSync(argv.out,JSON.stringify({schema:1,method:'3p-six-seat-direct',seed,results},null,2)+'\n');
