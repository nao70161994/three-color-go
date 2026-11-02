import {selectDirectPolicyMove} from './direct-policy.js';
import {isOwnEye} from './agent.js';
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
/** Highest-probability action from pass-aware fine-tuned weights.
 * Previous checkpoints remain in trained-model-data.js for reproducibility.
 * Pass shares the same softmax with placements. A minimal safety check
 * excludes filling an enclosed eye of the current connected friendly group.
 * This is an inference safety guard, NOT an outcome learned by the network.
 */
export function chooseTrainedMove(state,id='trained-lr001-final',inspection=null){
  const model=getTrainedModel(id);
  if(state.ended)return null;
  const result=selectDirectPolicyMove(state,model,{greedy:true});
  let selected=-1;
  for(let i=0;i<result.actions.length;i++){
    const action=result.actions[i];
    if(action.type==='play'&&isOwnEye(state,action.q,action.r))continue;
    if(selected<0||result.probabilities[i]>result.probabilities[selected])selected=i;
  }
  // Pass is always legal in an active game; selected cannot be -1.
  const action=result.actions[selected];
  if(Array.isArray(inspection)){
    inspection.push(...result.actions.map((a,index)=>({
      q:a.q??null,r:a.r??null,score:result.probabilities[index],
      ownEye:a.type==='play'&&isOwnEye(state,a.q,a.r)
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return action.type==='pass'?null:{q:action.q,r:action.r};
}
