/** Improved square GNN64, board-specific and explicitly teacher-distilled.
 * Retains the original unassisted self-play models as separate CPU choices.
 */
import {SQUARE_BOOST_MODELS} from './square-boost-model-data.js';
import {selectComparisonMove,validateComparisonModel} from './architecture-comparison.js';

export const SQUARE_BOOST_LEVEL='square-gnn64-boost-v1';
export const SQUARE_19_BETA_LEVEL='square-gnn64-19-beta';
const SOURCES=Object.freeze({'-9':'gnn64-staged','-13':'gnn64-direct'});
const boostValidated=new WeakSet();
export function getSquareBoostModel(radius){
  if(!Object.hasOwn(SOURCES,String(radius)))
    throw Error('強化GNN64は四角9×9と13×13専用です');
  const model=SQUARE_BOOST_MODELS[String(radius)];
  if(!model)throw Error('強化GNN64の学習済み重みがありません');
  if(!boostValidated.has(model)){
    validateComparisonModel(model);
    if(model.kind!=='gnn64'||model.metadata?.boardShape!=='square'||
       model.metadata?.games!==512||model.metadata?.teacherDistillation!==true||
       model.metadata?.teacherTrainingSamples<3000||
       !model.metadata.radii.includes(radius))
      throw Error('強化GNN64の学習元が不正です');
    boostValidated.add(model);
  }
  return model;
}
export function squareBoostModelInfo(){
  return [-9,-13].map(radius=>{
    const model=getSquareBoostModel(radius);
    return {id:SQUARE_BOOST_LEVEL,board:-radius,source:SOURCES[radius],
      architecture:model.kind,selfPlayGames:model.metadata.games,
      teacherGames:model.metadata.teacherGames,
      teacherSamples:model.metadata.teacherTrainingSamples,
      teacherValidationTop1:model.metadata.teacherValidationTop1,
      decisionMode:'greedy',teacherAssisted:true};
  });
}
export function chooseSquareBoostMove(state,inspection=null){
  if(state.ended)return null;
  const model=getSquareBoostModel(state.radius);
  // Greedy selection matches the heldout contest, unlike the older 32-game
  // models which require stochastic sampling. Pass is still fully legal.
  const picked=selectComparisonMove(state,model,{greedy:true,temperature:1});
  if(Array.isArray(inspection)){
    inspection.push(...picked.actions.map((a,i)=>({
      q:a.q??null,r:a.r??null,score:picked.probabilities[i]
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return picked.move;
}

/** Experimental opt-in 19x19 reuse of the UNCHANGED trained 13x13 GNN64.
 * Exactly the source that outranked the 19x19-finetuned model and the older
 * linear policy in independent seat-rotated tests. Not trained on 19x19.
 */
export function square19BetaModelInfo(){
  const base=getSquareBoostModel(-13);
  return {id:SQUARE_19_BETA_LEVEL,board:19,sourceBoard:13,
    source:'gnn64-direct',architecture:base.kind,
    selfPlayGames:base.metadata.games,teacherTrainedOn19:false,
    teacherDistillation:true,decisionMode:'greedy',experimental:true};
}
export function chooseSquare19BetaMove(state,inspection=null){
  if(state.ended)return null;
  if(state.radius!==-19)throw Error('19路専用GNN64の実験CPUです');
  const model=getSquareBoostModel(-13);
  const picked=selectComparisonMove(state,model,{greedy:true,temperature:1});
  if(Array.isArray(inspection)){
    inspection.push(...picked.actions.map((a,i)=>({
      q:a.q??null,r:a.r??null,score:picked.probabilities[i]
    })).sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return picked.move;
}
