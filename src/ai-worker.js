import {chooseDifficultyMove,seededRandom} from './agent.js';
import {chooseStrongMove} from './strong-ai.js';
// Separate thread: large-board search must not block taps or scrolling.
self.addEventListener('message',({data})=>{
  const {state,level,generation}=data;
  try{
    let move,decision=null;
    if(level==='hard'){
      const candidates=[];
      move=chooseStrongMove(state,Math.random,candidates);
      decision={turn:state.moveCount+1,chosen:move,
        candidates,notes:'候補評価は相対値'};
    }else move=chooseDifficultyMove(state,Math.random,level);
    self.postMessage({generation,move,decision});
  }catch(error){self.postMessage({generation,error:String(error.message||error)});}
});
