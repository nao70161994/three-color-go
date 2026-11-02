import {chooseDifficultyMove,seededRandom} from './agent.js';
import {chooseStrongMove} from './strong-ai.js';
import {chooseNeuralMove} from './neural-ai.js';
import {chooseExperimentalMove,EXPERIMENTAL_LEVELS} from './experimental-ai.js';
// Separate thread: large-board search must not block taps or scrolling.
self.addEventListener('message',({data})=>{
  const {state,level,generation}=data;
  try{
    let move,decision=null;
    if(level==='hard'||level==='neural'||EXPERIMENTAL_LEVELS.includes(level)){
      const candidates=[];
      move=level==='neural'
        ? chooseNeuralMove(state,Math.random,candidates)
        : level==='hard' ? chooseStrongMove(state,Math.random,candidates)
          : chooseExperimentalMove(state,Math.random,level,candidates);
      const notes={hard:'3手探索',neural:'学習モデル',maxn:'MaxN探索',
        mcts:'MCTS試行平均',hybrid:'ニューラル＋探索'};
      decision={turn:state.moveCount+1,chosen:move,
        candidates,notes:notes[level]+'の相対スコア（勝率ではありません）'};
    }else move=chooseDifficultyMove(state,Math.random,level);
    self.postMessage({generation,move,decision});
  }catch(error){self.postMessage({generation,error:String(error.message||error)});}
});
