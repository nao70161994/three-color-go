/**
 * Square-board learned policy: shared weights across all three colors, no search.
 * Features are geometry/topology facts; policy weights are fitted from real
 * three-player teacher games (see scripts/train-square-policy.mjs).
 * The pass action is always compared with every legal placement.
 */
import {COLORS,adjacentKeys,pointKey,pointsOnBoard} from './game.js';
import {groupInfo,legalMoves} from './agent.js';
import {SQUARE_POLICY_WEIGHTS} from './square-policy-weights.js';
export const SQUARE_TRAINED_LEVEL='square-trained-v1';
export const SQUARE_FEATURES=16;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function squarePolicyActions(state){
  if(state.radius>=0)throw Error('四角盤専用の学習CPUです');
  const board=state.board,n=-state.radius,own=COLORS[state.turn];
  const opponent1=COLORS[(state.turn+1)%3],opponent2=COLORS[(state.turn+2)%3];
  const occupied=Object.keys(board).length/(n*n);
  const ownCount=Object.values(board).filter(c=>c===own).length;
  const enemyCount=Object.values(board).filter(c=>c!==own).length;
  const scoreGap=(enemyCount/2-ownCount)/(n*n);
  const groupCache=new Map();
  const getGroup=k=>{
    if(!groupCache.has(k)){
      const g=groupInfo(board,k,state.radius);
      for(const x of g.stones)groupCache.set(x,g);
    }
    return groupCache.get(k);
  };
  const actions=legalMoves(state).map(({q,r})=>{
    const neighbors=adjacentKeys(pointKey(q,r),state.radius);
    let friends=0,opp1=0,opp2=0,empty=0;
    let capturePotential=0,weakEnemy=0,strongOwn=0,ownLiberties=0;
    const scanned=new Set();
    for(const key of neighbors){
      const color=board[key];
      if(!color){empty++;continue;}
      if(color===own)friends++;
      else if(color===opponent1)opp1++;
      else if(color===opponent2)opp2++;
      if(scanned.has(key))continue;
      const g=getGroup(key);
      for(const stone of g.stones)scanned.add(stone);
      if(color===own){
        ownLiberties+=Math.min(g.liberties.length,6);
        strongOwn+=Math.min(g.stones.length,12);
      }else{
        if(g.liberties.length===1)capturePotential+=g.stones.length;
        if(g.liberties.length===2)weakEnemy+=g.stones.length;
      }
    }
    let nearOwn=0,nearEnemy=0;
    for(let y=Math.max(0,r-2);y<=Math.min(n-1,r+2);y++)
      for(let x=Math.max(0,q-2);x<=Math.min(n-1,q+2);x++){
        if(Math.abs(x-q)+Math.abs(y-r)>2)continue;
        const c=board[pointKey(x,y)];
        if(c===own)nearOwn++;else if(c)nearEnemy++;
      }
    const dist=Math.min(q,r,n-1-q,n-1-r);
    const central=1-(Math.abs(q-(n-1)/2)+Math.abs(r-(n-1)/2))/(n-1);
    const features=[
      1,friends/4,opp1/4,opp2/4,empty/4,
      nearOwn/12,nearEnemy/12,Math.min(1,ownLiberties/12),
      Math.min(1,strongOwn/24),Math.min(1,capturePotential/5),
      Math.min(1,weakEnemy/5),Math.min(1,(friends>0&&empty===0)?1:0),
      central,dist/(n/2),occupied,scoreGap
    ];
    return {move:{q,r},features,type:'play'};
  });
  actions.push({move:null,type:'pass',passFeatures:[1,occupied,state.passes/2]});
  return actions;
}
export function squarePolicyDistribution(state,model=SQUARE_POLICY_WEIGHTS){
  if(!model||model.architecture!=='square-linear-policy-v1'||model.weights?.length!==SQUARE_FEATURES||
     model.passWeights?.length!==3||[...model.weights,...model.passWeights].some(w=>!Number.isFinite(w)))
    throw Error('Invalid square learned model');
  const actions=squarePolicyActions(state);
  const logits=actions.map(a=>a.type==='pass'?dot(a.passFeatures,model.passWeights):dot(a.features,model.weights));
  const high=Math.max(...logits),exps=logits.map(x=>Math.exp(x-high)),total=exps.reduce((a,b)=>a+b,0);
  const probabilities=exps.map(x=>x/total);
  return {actions,logits,probabilities};
}
export function chooseSquareTrainedMove(state,inspection=null,model=SQUARE_POLICY_WEIGHTS){
  if(state.ended)return null;
  // The square-specific policy does not claim to be trained for hex grids.
  if(state.radius>=0)throw Error('四角盤専用の学習CPUは六角盤で利用できません');
  const {actions,probabilities}=squarePolicyDistribution(state,model);
  let best=0;
  for(let i=1;i<actions.length;i++)if(probabilities[i]>probabilities[best])best=i;
  if(Array.isArray(inspection)){
    inspection.push(...actions.map((a,i)=>({...a.move,score:probabilities[i]}))
      .sort((a,b)=>b.score-a.score).slice(0,5));
  }
  return actions[best].move;
}
export function squareTrainedModelInfo(){
  const m=SQUARE_POLICY_WEIGHTS;
  return {architecture:m.architecture,training:m.training,games:m.training?.games??0,
    trainedOn:m.training?.boardSizes??[],featureCount:SQUARE_FEATURES,policy:'greedy'};
}
