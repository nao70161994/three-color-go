/** Frozen head-to-head finalists. The generated weights are checked into Git as
 * src/elite-model-data.js from verified original Actions artifacts.
 * No rollout / look-ahead / eye-veto is added to these neural policies.
 */
import {ELITE_MODELS} from './elite-model-data.js';
import {selectComparisonMove,validateComparisonModel} from './architecture-comparison.js';
import {selectDirectPolicyMove} from './direct-policy.js';
import {validatePV2Model} from './pv2-ai.js';

export const ELITE_LEVELS=Object.freeze([
  'elite-attn64-50000',
  'elite-gnn64-50000',
  'elite-pv2-122400'
]);
export const ELITE_LABELS=Object.freeze({
  'elite-attn64-50000':'新AI：Attention／50,000局',
  'elite-gnn64-50000':'新AI：64次元GNN／50,000局',
  'elite-pv2-122400':'旧世代上位：PV2／122,400局'
});
export function eliteModelsInfo(){
  return ELITE_LEVELS.map(id=>{
    const m=getEliteModel(id);
    return {id,label:ELITE_LABELS[id],architecture:m.architecture,
      games:id==='elite-pv2-122400'?122400:m.metadata.games,
      trainedRadii:m.metadata.radii??[2,3,4],
      version:m.version,headToHeadCandidate:true};
  });
}
export function getEliteModel(id){
  if(!ELITE_LEVELS.includes(id))throw Error('Unknown elite AI model');
  const model=ELITE_MODELS[id];
  if(!model)throw Error('Missing elite model '+id);
  if(id==='elite-pv2-122400'){
    validatePV2Model(model);
    if(model.architecture!=='hex-group-pv-16-v2'||model.metadata.games!==20000||
       model.metadata.learningRate!==0.001||model.metadata.passInLegalActions!==true)
      throw Error('Wrong legacy 122400 source checkpoint');
  }else{
    validateComparisonModel(model);
    if(model.kind!==(id==='elite-attn64-50000'?'attn64':'gnn64')||
       model.metadata.games!==50000||model.metadata.features!==10)
      throw Error('Wrong comparison 50k source checkpoint');
  }
  return model;
}
export function chooseEliteMove(state,id='elite-attn64-50000',inspection=null){
  if(state.ended)return null;
  const model=getEliteModel(id);
  const result=id==='elite-pv2-122400'
    ?selectDirectPolicyMove(state,model,{greedy:true})
    :selectComparisonMove(state,model,{greedy:true});
  if(Array.isArray(inspection)){
    inspection.push(...result.actions.map((action,i)=>({
      q:action.q??null,r:action.r??null,score:result.probabilities[i]
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return result.move;
}
