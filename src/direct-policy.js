/**
 * Experimental NO-SEARCH shared policy for all three colors.
 *
 * Each move uses ONE PV2 forward pass and a legal-move mask. No MCTS,
 * rollouts, heuristic scores, hand-authored "good-move" filters, or tree
 * lookahead. Legal validation uses the actual game rules only.
 */
import {COLORS,pointsOnBoard,scores,play,pass} from './game.js';
import {legalMoves,seededRandom} from './agent.js';
import {encodePV2State,evaluatePV2,validatePV2Model} from './pv2-ai.js';

export function finalStoneShares(state){
  if(!state.ended)throw Error('Stone-share reward requires a finished game');
  const counts=scores(state),total=COLORS.reduce((n,c)=>n+counts[c],0);
  return COLORS.map(c=>total?counts[c]/total:1/3);
}
export function policyLegalActions(state){
  if(state.ended)return [];
  const points=pointsOnBoard(state.radius),cap=points.length*2;
  if(state.moveCount>=cap)return [{type:'pass',index:points.length}];
  const options=legalMoves(state);
  if(!options.length)return [{type:'pass',index:points.length}];
  const indexes=new Map(points.map(({q,r},i)=>[q+','+r,i]));
  return options.map(({q,r})=>({type:'play',q,r,index:indexes.get(q+','+r)}));
}
export function directPolicy(state,model,{temperature=1}={}){
  if(!Number.isFinite(temperature)||temperature<=0||temperature>10)
    throw Error('Invalid policy sampling temperature');
  validatePV2Model(model);
  if(state.ended)return {actions:[],probabilities:[],value:finalStoneShares(state)};
  const output=evaluatePV2(state,model),actions=policyLegalActions(state);
  if(!actions.length)throw Error('No legal policy action');
  const logits=actions.map(a=>output.logits[a.index]/temperature);
  const peak=Math.max(...logits),exps=logits.map(x=>Math.exp(x-peak));
  const denominator=exps.reduce((a,b)=>a+b,0);
  const probabilities=exps.map(x=>x/denominator);
  return {actions,probabilities,value:output.value};
}
export function selectDirectPolicyMove(state,model,{
  random=seededRandom(1),temperature=1,greedy=false
}={}){
  if(state.ended)return {move:null,action:null,probabilities:[]};
  const prediction=directPolicy(state,model,{temperature});
  const {actions,probabilities}=prediction;
  let selected=0;
  if(greedy){
    for(let i=1;i<actions.length;i++)
      if(probabilities[i]>probabilities[selected])selected=i;
  }else{
    let draw=random();
    if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('Invalid random sample');
    selected=actions.length-1;
    for(let i=0;i<actions.length;i++){
      draw-=probabilities[i];
      if(draw<0){selected=i;break;}
    }
  }
  const action=actions[selected];
  return {action,move:action.type==='pass'?null:{q:action.q,r:action.r},
    probabilities,actions,value:prediction.value};
}
export function applyDirectPolicy(state,move){
  const result=move?play(state,move.q,move.r):pass(state);
  if(!result.ok)throw Error('Illegal direct-policy action: '+result.reason);
  return result.state;
}
// Kept separate from inference to avoid recomputing feature tensors per move.
export {encodePV2State};
