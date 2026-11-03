#!/usr/bin/env node
/** Same held-out seeded opponents, board sizes and seat rotation across models. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,pass,play,pointsOnBoard,scores,winner} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {selectComparisonMove,validateComparisonModel} from '../src/architecture-comparison.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--model','--radius','--games','--seed','--opponents','--out','--horizon-multiplier'].includes(k)||v===undefined)
    throw Error('Bad benchmark argument '+k);
  args[k.slice(2)]=v;
}
if(!args.model)throw Error('--model required');
const model=validateComparisonModel(JSON.parse(readFileSync(args.model,'utf8')));
const radius=Number(args.radius??3),games=Number(args.games??24),
  seed=Number(args.seed??20471103),horizonMultiplier=Number(args['horizon-multiplier']??20),
  opponents=(args.opponents??'balanced,tactical').split(',');
if(!Number.isInteger(radius)||radius<2||radius>5||
   !Number.isInteger(games)||games<3||games>300||games%3!==0||
   !Number.isInteger(seed)||seed<0||seed>0xffffffff||
   !Number.isInteger(horizonMultiplier)||horizonMultiplier<3||horizonMultiplier>100||
   opponents.length!==2||opponents.some(x=>!['balanced','guarded','tactical','baseline'].includes(x)))
  throw Error('Invalid benchmark setup');
const records=[],horizon=pointsOnBoard(radius).length*horizonMultiplier+3;
for(let game=0;game<games;game++){
  const ourSeat=game%3,gameSeed=(seed+Math.floor(game/3)*100003)>>>0,
    rng=COLORS.map((_,i)=>seededRandom((gameSeed+151*i)>>>0));
  const opponentSeats=[0,1,2].filter(i=>i!==ourSeat);
  let state=createGame(radius),turns=0,earlyPass=false;
  while(!state.ended&&turns<horizon){
    const player=state.turn;
    let move;
    if(player===ourSeat){
      move=selectComparisonMove(state,model,{greedy:true}).move;
      if(move===null&&turns<6)earlyPass=true;
    }else{
      move=chooseMove(state,rng[player],opponents[opponentSeats.indexOf(player)]);
    }
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error('Invalid benchmark move '+result.reason);
    state=result.state;turns++;
  }
  const count=scores(state),stones=COLORS.map(c=>count[c]),total=stones.reduce((a,b)=>a+b,0);
  const winners=state.ended?winner(state):[];
  records.push({ourSeat,gameSeed,ended:state.ended,truncated:!state.ended,turns,
    stoneShare:total?stones[ourSeat]/total:1/3,
    winShare:state.ended&&winners.includes(COLORS[ourSeat])?1/winners.length:0,
    earlyPass,stones,winners});
}
const finished=records.filter(x=>x.ended),sum=(arr,key)=>arr.reduce((s,x)=>s+x[key],0);
const report={
  kind:model.kind,model:model.version,trainingGames:model.metadata.games,
  radius,games,finished:finished.length,truncated:games-finished.length,
  horizon,seed,opponents,
  naturalEndRate:finished.length/games,
  meanObservedStoneShare:sum(records,'stoneShare')/games,
  finishedWinShare:finished.length?sum(finished,'winShare')/finished.length:null,
  meanFinishedTurns:finished.length?sum(finished,'turns')/finished.length:null,
  earlyPassCount:records.filter(x=>x.earlyPass).length,records,
};
if(args.out){mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({...report,records:undefined}));
