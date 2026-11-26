/** Experimental neural/linear policy fusion with bounded tactical 1-ply review.
 *
 * No weights are changed. Both pretrained policies are evaluated from the
 * SAME true game state, and the game's play() API is the only legality source.
 * Tactical checks are applied to a short list of candidate moves to bound CPU
 * overhead on phones. These are policy helpers, not alterations to game rules.
 */
import {COLORS,pointKey,play,pointsOnBoard} from './game.js';
import {captureExposure,groupInfo,isOwnEye} from './agent.js';
import {selectComparisonMove} from './architecture-comparison.js';
import {squarePolicyDistribution} from './square-policy.js';
import {getSquareBoostModel} from './square-boost-ai.js';

export const SQUARE_HYBRID_VARIANTS=Object.freeze({
  'neural-guard':Object.freeze({blend:0,tactical:true}),
  'teacher-blend':Object.freeze({blend:0.35,tactical:false}),
  'teacher-guard':Object.freeze({blend:0.3,tactical:true})
});
export const SQUARE_HYBRID_LEVEL='square-gnn64-hybrid-v1';
export function getHybridSourceModel(radius){
  if(![-9,-13,-19].includes(radius))throw Error('四角盤9・13・19路専用のCPUです');
  // The 19-board GNN is the unchanged 13-board trained source.
  return getSquareBoostModel(radius===-19?-13:radius);
}
function atariLiberties(state,own){
  const visited=new Set(),result=new Set();
  for(const [key,color] of Object.entries(state.board)){
    if(visited.has(key))continue;
    const g=groupInfo(state.board,key,state.radius);
    for(const stone of g.stones)visited.add(stone);
    if(color!==own && g.liberties.length===1 && g.stones.length>=2)
      result.add(g.liberties[0]);
  }
  return result;
}
export function evaluateHybridCandidates(state,{
  variant='teacher-guard',topK=0
}={}){
  if(state.ended)return {move:null,candidates:[],variant};
  if(state.radius>=0)throw Error('四角盤専用のAIです');
  const config=SQUARE_HYBRID_VARIANTS[variant];
  if(!config)throw Error('不明な強化方式です');
  if(!Number.isInteger(topK)||topK<0||topK>32)throw Error('不正な候補数です');
  const model=getHybridSourceModel(state.radius);
  const neural=selectComparisonMove(state,model,{greedy:true,temperature:1});
  // The learned square linear policy is a distinct, independent teacher prior.
  const linear=config.blend>0?squarePolicyDistribution(state):null;
  const teacherScores=new Map();
  if(linear){
    linear.actions.forEach((action,i)=>{
      const key=action.type==='pass'?'pass':pointKey(action.move.q,action.move.r);
      teacherScores.set(key,linear.probabilities[i]);
    });
  }
  const own=COLORS[state.turn];
  const maxNeural=Math.max(...neural.probabilities);
  const maxTeacher=linear?Math.max(...linear.probabilities):1;
  const count=pointsOnBoard(state.radius).length;
  const rows=neural.actions.map((action,i)=>{
    const key=action.type==='pass'?'pass':pointKey(action.q,action.r);
    const n=Math.log(Math.max(neural.probabilities[i],1e-14)/maxNeural);
    const t=linear?Math.log(Math.max(teacherScores.get(key)??1e-14,1e-14)/maxTeacher):0;
    return {action,policyScore:(1-config.blend)*n+config.blend*t,score:(1-config.blend)*n+config.blend*t,
      neuralProbability:neural.probabilities[i],teacherProbability:linear?(teacherScores.get(key)??0):null};
  });
  rows.sort((a,b)=>b.score-a.score||a.action.index-b.action.index);
  if(!config.tactical){
    return {move:toMove(rows[0].action),variant,candidates:rows.slice(0,5)};
  }
  const limit=topK|| (count>=300?7:count>=160?10:12);
  const selected=new Map();
  for(const row of rows.slice(0,limit))
    selected.set(row.action.index,row);
  // Do not miss capturing a distant enemy group whose last liberty has low
  // neural probability. In three-color Go both other colors are opponents.
  const urgent=atariLiberties(state,own);
  for(const key of urgent){
    const row=rows.find(item=>item.action.type==='play'&&pointKey(item.action.q,item.action.r)===key);
    if(row)selected.set(row.action.index,row);
    if(selected.size>=limit+8)break;
  }
  const checked=[];
  for(const row of selected.values()){
    const {action}=row;
    let tactical=0;
    if(action.type==='pass'){
      // Passing remains legal and selectable late in the game; this only
      // discourages early pathological passes when many legal moves exist.
      if(state.moveCount<count*1.25 && rows.length>1)tactical-=3.0;
    }else{
      const outcome=play(state,action.q,action.r);
      if(!outcome.ok)throw Error('Candidate legal state mismatch');
      const ownGroup=groupInfo(outcome.state.board,pointKey(action.q,action.r),state.radius);
      const captured=outcome.captured.length;
      const exposed=captureExposure(outcome.state,own);
      // Log-scale bonuses prevent enormous group sizes dominating learned
      // policy priors; immediate opponent capture exposure is more serious.
      tactical+=Math.log1p(captured)*1.3-Math.log1p(exposed)*1.1;
      if(ownGroup.liberties.length===1 && ownGroup.stones.length>captured)
        tactical-=1.6+Math.log1p(ownGroup.stones.length)*0.9;
      if(isOwnEye(state,action.q,action.r))tactical-=5.0;
    }
    row.score+=tactical;
    row.tacticalScore=tactical;
    checked.push(row);
  }
  checked.sort((a,b)=>b.score-a.score||a.action.index-b.action.index);
  return {move:toMove(checked[0].action),variant,candidates:checked.slice(0,5),
    neuralMove:neural.move};
}
function toMove(action){
  return action?.type==='pass'?null:{q:action.q,r:action.r};
}
export function chooseSquareHybridMove(state,inspection=null,variant='teacher-guard'){
  if(state.ended)return null;
  const chosen=evaluateHybridCandidates(state,{variant});
  if(Array.isArray(inspection))inspection.push(...chosen.candidates.map(({action,score,policyScore,tacticalScore})=>({
    q:action.q??null,r:action.r??null,score,policyScore,tacticalScore:tacticalScore??0
  })));
  return chosen.move;
}
