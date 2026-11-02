import {selectDirectPolicyMove} from './direct-policy.js';
import {validatePV2Model} from './pv2-ai.js';
import {CHECKPOINTS} from './trained-model-data.js';

export const TRAINED_LEVELS=Object.freeze([
  'trained-lr001-final','trained-lr001-peak','trained-lr0003-peak'
]);
const loaded=new Map();
export function trainedModelsInfo(){
  return TRAINED_LEVELS.map(id=>{
    const m=CHECKPOINTS[id];
    return {id,version:m.version,architecture:m.architecture,
      games:m.metadata.games,learningRate:m.metadata.learningRate,
      trainedRadii:[...m.metadata.radii],seed:m.metadata.seed};
  });
}
export function getTrainedModel(id){
  if(!TRAINED_LEVELS.includes(id))throw Error('Unknown trained AI model');
  if(!loaded.has(id))loaded.set(id,validatePV2Model(CHECKPOINTS[id]));
  return loaded.get(id);
}
/** Greedy direct action from a real saved self-play checkpoint, without search. */
export function chooseTrainedMove(state,id='trained-lr001-final',inspection=null){
  const model=getTrainedModel(id);
  if(state.ended)return null;
  const result=selectDirectPolicyMove(state,model,{greedy:true});
  if(Array.isArray(inspection)){
    inspection.push(...result.actions.map((a,index)=>({
      q:a.q??null,r:a.r??null,score:result.probabilities[index]
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return result.move;
}
