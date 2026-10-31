import {chooseDifficultyMove,seededRandom} from './agent.js';
import {chooseStrongMove} from './strong-ai.js';
import {chooseNeuralMove} from './neural-ai.js';
// Separate thread: large-board search must not block taps or scrolling.
self.addEventListener('message',({data})=>{
  const {state,level,generation}=data;
  try{
    let move,decision=null;
    if(level==='hard'||level==='neural'){
      const candidates=[];
      move=level==='neural'
        ? chooseNeuralMove(state,Math.random,candidates)
        : chooseStrongMove(state,Math.random,candidates);
      decision={turn:state.moveCount+1,chosen:move,
        candidates,notes:level==='neural'?'学習モデルの相対スコア':'3手探索の相対スコア'};
    }else move=chooseDifficultyMove(state,Math.random,level);
    self.postMessage({generation,move,decision});
  }catch(error){self.postMessage({generation,error:String(error.message||error)});}
});
