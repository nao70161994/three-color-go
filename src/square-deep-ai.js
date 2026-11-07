/** Frozen genuinely self-play-trained square-board GNN/Attention policies. */
import {SQUARE_DEEP_MODELS} from './square-deep-model-data.js';
import {selectComparisonMove,validateComparisonModel} from './architecture-comparison.js';

export const SQUARE_DEEP_LEVELS=Object.freeze([
  'square-gnn16-32','square-gnn64-32','square-attn64-32'
]);
const KINDS=Object.freeze({
  'square-gnn16-32':'gnn16','square-gnn64-32':'gnn64',
  'square-attn64-32':'attn64'
});
export function getSquareDeepModel(id){
  if(!SQUARE_DEEP_LEVELS.includes(id))throw Error('Unknown square deep CPU '+id);
  const model=SQUARE_DEEP_MODELS[id];
  if(!model)throw Error('Square deep model is not yet trained: '+id);
  validateComparisonModel(model);
  if(model.kind!==KINDS[id]||model.metadata.boardShape!=='square'||
     !model.metadata.radii.includes(-9)||!model.metadata.radii.includes(-13)||
     model.metadata.games!==32||!model.metadata.phaseFeature===false)
    throw Error('Incorrect square deep checkpoint '+id);
  return model;
}
export function squareDeepModelsInfo(){
  return SQUARE_DEEP_LEVELS.map(id=>{
    const m=SQUARE_DEEP_MODELS[id];
    return {id,ready:!!m,kind:KINDS[id],trainedGames:m?.metadata?.games??0,
      trainingBoards:m?.metadata?.radii?.filter(r=>r<0).map(r=>-r)??[]};
  });
}
export function chooseSquareDeepMove(state,id,inspection=null){
  if(state.ended)return null;
  if(state.radius>=0)throw Error('Square deep model requires a square board');
  const model=getSquareDeepModel(id);
  const selected=selectComparisonMove(state,model,{greedy:true});
  if(Array.isArray(inspection)){
    inspection.push(...selected.actions.map((a,i)=>({
      q:a.q??null,r:a.r??null,score:selected.probabilities[i]
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return selected.move;
}
