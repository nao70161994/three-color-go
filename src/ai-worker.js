import {chooseDifficultyMove,seededRandom} from './agent.js';
import {chooseStrongMove} from './strong-ai.js';
import {chooseNeuralMove} from './neural-ai.js';
import {chooseTrainedMove,TRAINED_LEVELS} from './trained-direct-ai.js';
import {chooseEliteMove,ELITE_LEVELS} from './elite-models.js';
import {chooseSquareTrainedMove,SQUARE_TRAINED_LEVEL} from './square-policy.js';
// Separate thread: large-board search must not block taps or scrolling.
self.addEventListener('message',({data})=>{
  const {state,level,generation}=data;
  try{
    let move,decision=null;
    if(level==='hard'||level==='neural'||TRAINED_LEVELS.includes(level)||ELITE_LEVELS.includes(level)||level===SQUARE_TRAINED_LEVEL){
      const candidates=[];
      move=level===SQUARE_TRAINED_LEVEL
        ? chooseSquareTrainedMove(state,candidates)
        : ELITE_LEVELS.includes(level)
        ? chooseEliteMove(state,level,candidates)
        : TRAINED_LEVELS.includes(level)
        ? chooseTrainedMove(state,level,candidates)
        : level==='neural' ? chooseNeuralMove(state,Math.random,candidates)
          : chooseStrongMove(state,Math.random,candidates);
      decision={turn:state.moveCount+1,chosen:move,
        candidates,notes:level===SQUARE_TRAINED_LEVEL
          ? '四角盤専用の学習方策（教師模倣・探索なし）'
          : ELITE_LEVELS.includes(level)
          ? '新旧上位学習AIの方策確率（探索・戦略ルールなし）'
          : TRAINED_LEVELS.includes(level)
          ? '合法手＋パスを直接比較した方策確率（眼の戦略的フィルターなし）'
          : level==='neural'?'学習モデルの相対スコア':'3手探索の相対スコア'};
    }else move=chooseDifficultyMove(state,Math.random,level);
    self.postMessage({generation,move,decision});
  }catch(error){self.postMessage({generation,error:String(error.message||error)});}
});
