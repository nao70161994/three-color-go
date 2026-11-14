/** Shared CPU dispatch used by both the browser and Web Worker.
 * Unavailable geometries fail explicitly; there are no silent model swaps.
 */
import {COLORS} from './game.js';
import {chooseDifficultyMove} from './agent.js';
import {chooseStrongMove} from './strong-ai.js';
import {chooseNeuralMove} from './neural-ai.js';
import {chooseTrainedMove,TRAINED_LEVELS} from './trained-direct-ai.js';
import {chooseEliteMove,ELITE_LEVELS} from './elite-models.js';
import {chooseSquareTrainedMove,SQUARE_TRAINED_LEVEL} from './square-policy.js';
import {chooseSquareDeepMove,SQUARE_DEEP_LEVELS} from './square-deep-ai.js';
import {isCpuLevelSupported,cpuCompatibilityReason} from './cpu-catalog.js';

export function selectCpuMove(state,level,random=Math.random){
  if(!isCpuLevelSupported(level,state.radius))
    throw Error(cpuCompatibilityReason(level,state.radius));
  if(state.ended)return {move:null,decision:null};
  if(level==='easy'||level==='normal')
    return {move:chooseDifficultyMove(state,random,level),decision:null};
  const candidates=[];
  const move=SQUARE_DEEP_LEVELS.includes(level)
    ? chooseSquareDeepMove(state,level,candidates,random)
    : level===SQUARE_TRAINED_LEVEL
    ? chooseSquareTrainedMove(state,candidates)
    : ELITE_LEVELS.includes(level)
    ? chooseEliteMove(state,level,candidates)
    : TRAINED_LEVELS.includes(level)
    ? chooseTrainedMove(state,level,candidates)
    : level==='neural'
    ? chooseNeuralMove(state,random,candidates)
    : chooseStrongMove(state,random,candidates);
  const descriptions={
    deep:'四角盤用の自己対戦学習GNN/Attention方策（探索なし、実験版）',
    square:'四角盤専用の教師模倣学習方策（探索なし）',
    elite:'六角盤の自己対戦学習済み方策（探索なし）',
    trained:'六角盤の合法手＋パス学習済み方策（探索なし）',
    neural:'六角盤の教師模倣ニューラルCPU',
    hard:'3手読みの相対評価値（勝率ではありません）'
  };
  const type=SQUARE_DEEP_LEVELS.includes(level)?'deep':
    level===SQUARE_TRAINED_LEVEL?'square':
    ELITE_LEVELS.includes(level)?'elite':
    TRAINED_LEVELS.includes(level)?'trained':level==='neural'?'neural':'hard';
  return {move,decision:{turn:state.moveCount+1,color:COLORS[state.turn],
    level,chosen:move,candidates,notes:descriptions[type]}};
}
