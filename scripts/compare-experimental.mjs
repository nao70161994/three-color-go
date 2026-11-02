import {createGame,play,pass,pointsOnBoard,winner,scores} from '../src/game.js';
import {seededRandom,chooseMove} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';
import {chooseNeuralMove} from '../src/neural-ai.js';
import {chooseExperimentalMove,EXPERIMENTAL_LEVELS} from '../src/experimental-ai.js';

const argv=process.argv;
const arg=(name,otherwise)=>{const i=argv.indexOf('--'+name);return i<0?otherwise:Number(argv[i+1]);};
const games=arg('games',3),radius=arg('radius',3),seed=arg('seed',20261102);
if(!Number.isInteger(games)||games<1||games>300||
  !Number.isInteger(radius)||radius<2||radius>12||!Number.isFinite(seed))
  throw Error('Invalid games/radius/seed');
const policies=['hard','neural',...EXPERIMENTAL_LEVELS];
const choose=(state,random,policy)=>policy==='hard'?chooseStrongMove(state,random):
  policy==='neural'?chooseNeuralMove(state,random):
    chooseExperimentalMove(state,random,policy);
const results=[];
for(const policy of policies){
  const bySeat=[];
  for(let seat=0;seat<3;seat++){
    let finished=0,truncated=0,winShare=0,turns=0;
    for(let index=0;index<games;index++){
      const random=seededRandom(seed+seat*1009+index*53);
      let state=createGame(radius),steps=0;
      const maxTurns=pointsOnBoard(radius).length*2+10;
      while(!state.ended&&steps<maxTurns){
        const move=state.turn===seat?choose(state,random,policy):
          chooseMove(state,random,'balanced');
        const applied=move?play(state,move.q,move.r):pass(state);
        if(!applied.ok)throw Error(policy+' seat '+seat+' game '+index+': '+applied.reason);
        state=applied.state;steps++;
      }
      if(state.ended){finished++;const wins=winner(state);if(wins.includes(['black','white','red'][seat]))winShare+=1/wins.length;}
      else truncated++;
      turns+=steps;
    }
    bySeat.push({seat,games,finished,truncated,
      winShare:Number(winShare.toFixed(3)),averageTurns:Number((turns/games).toFixed(1))});
  }
  results.push({policy,bySeat,finished:bySeat.reduce((n,x)=>n+x.finished,0),
    truncated:bySeat.reduce((n,x)=>n+x.truncated,0),
    winShare:Number(bySeat.reduce((n,x)=>n+x.winShare,0).toFixed(3)),
    scorePerGame:Number((bySeat.reduce((n,x)=>n+x.winShare,0)/(games*3)).toFixed(3))});
}
console.log(JSON.stringify({settings:{gamesPerSeat:games,radius,seed,opponents:'balanced x2',
  incompleteNotWins:true},results},null,2));
