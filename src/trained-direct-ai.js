import {selectDirectPolicyMove} from './direct-policy.js';
import {validatePV2Model} from './pv2-ai.js';
import {CHECKPOINTS} from './trained-model-data.js';
import {PASS_CHECKPOINTS} from './pass-trained-model-data.js';

export const TRAINED_LEVELS=Object.freeze([
  'trained-lr001-final','trained-lr001-peak','trained-lr0003-peak'
]);
const loaded=new Map();
export function trainedModelsInfo(){
  return TRAINED_LEVELS.map(id=>{
    const m=PASS_CHECKPOINTS[id],original=CHECKPOINTS[id];
    const previousPassGames=320,continuedPassGames=m.metadata.games;
    return {id,version:m.version,architecture:m.architecture,
      games:original.metadata.games+previousPassGames+continuedPassGames,
      originalGames:original.metadata.games,passTrainingGames:previousPassGames+continuedPassGames,
      passLearned:m.metadata.passInLegalActions===true,
      learningRate:original.metadata.learningRate,
      passLearningRate:m.metadata.learningRate,
      trainedRadii:[...m.metadata.radii],seed:m.metadata.seed};
  });
}
export function getTrainedModel(id){
  if(!TRAINED_LEVELS.includes(id))throw Error('Unknown trained AI model');
  if(!loaded.has(id))loaded.set(id,validatePV2Model(PASS_CHECKPOINTS[id]));
  return loaded.get(id);
}
/** Greedy PV2 policy without strategic rule-based masks or search.
 * Every legal placement and pass compete using the trained network's output.
 * Rule legality is checked in direct-policy.js, not strategic 'eye' filters.
 */
export function chooseTrainedMove(state,id='trained-lr001-final',inspection=null){
  if(state.radius<0)throw Error('旧PV2学習CPUは六角盤専用です');
  const model=getTrainedModel(id);
  if(state.ended)return null;
  const result=selectDirectPolicyMove(state,model,{greedy:true});
  if(Array.isArray(inspection)){
    inspection.push(...result.actions.map((action,index)=>({
      q:action.q??null,r:action.r??null,score:result.probabilities[index]
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return result.move;
}
