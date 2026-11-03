/**
 * Whole-board, three-player policy/value network v2.
 *
 * Compared with v1: per-color group size/liberty observations from the exact
 * rules engine and three shared hex-neighbour message-passing layers. These
 * are STATE features, never hand-assigned teacher move labels or rewards.
 * Experimental: neither pretrained nor shipped as a playable CPU.
 */
import {COLORS,adjacentKeys,pointsOnBoard,pointKey} from './game.js';
import {groupInfo,seededRandom} from './agent.js';

export const PV2_ARCH='hex-group-pv-16-v2';
export const PV2_FEATURES=11;
export const PV3_ARCH='hex-group-pv-16-v3-no-phase';
export const PV3_FEATURES=10;
export const PV2_SHAPE={
  embed:[16,11],mix1:[16,32],mix2:[16,32],mix3:[16,32],
  policy:[1,16],pass:[1,16],valueHidden:[16,16],value:[3,16]
};
export const PV3_SHAPE={...PV2_SHAPE,embed:[16,10]};

function createInitialModel(seed,architecture,shape){
  const random=seededRandom(seed),layers={};
  for(const [name,[rows,cols]] of Object.entries(shape)){
    layers[name]={rows,cols,
      weights:Array.from({length:rows*cols},()=>+((random()-.5)*2/Math.sqrt(cols)).toFixed(7)),
      bias:Array.from({length:rows},()=>0)};
  }
  return {architecture,version:(architecture===PV3_ARCH?'pv3':'pv2')+'-random-'+seed,
    training:'untrained',layers};
}
export function createInitialPV2Model(seed=20261031){
  return createInitialModel(seed,PV2_ARCH,PV2_SHAPE);
}
export function createInitialPV3Model(seed=20261103){
  return {...createInitialModel(seed,PV3_ARCH,PV3_SHAPE),
    metadata:{valueOutput:'independent',features:PV3_FEATURES,phaseFeature:false}};
}

const checked=new WeakSet();
export function validatePV2Model(model){
  if(checked.has(model))return model;
  const shape=model?.architecture===PV2_ARCH?PV2_SHAPE:
    model?.architecture===PV3_ARCH?PV3_SHAPE:null;
  if(!shape||!model.layers)throw Error('Unsupported PV2/PV3 model');
  for(const [name,[rows,cols]] of Object.entries(shape)){
    const layer=model.layers[name];
    if(!layer||layer.rows!==rows||layer.cols!==cols||
       layer.weights?.length!==rows*cols||layer.bias?.length!==rows||
       [...layer.weights,...layer.bias].some(n=>!Number.isFinite(n)))
      throw Error('Invalid PV2 layer '+name);
  }
  checked.add(model);return model;
}
/** Legacy PV2 uses 11 features. PV3 removes the move-count/phase feature.
 * Passing an actual model is required to select the new 10-feature format.
 */
export function encodePV2State(state,model=null){
  const includePhase=model?.architecture!==PV3_ARCH;
  const points=pointsOnBoard(state.radius);
  const index=new Map(points.map(({q,r},i)=>[pointKey(q,r),i]));
  const phase=Math.min(1,state.moveCount/(2*points.length));
  const groups=new Map(),visited=new Set();
  for(const key of Object.keys(state.board)){
    if(visited.has(key))continue;
    const g=groupInfo(state.board,key,state.radius);
    for(const stone of g.stones){
      visited.add(stone);
      groups.set(stone,{size:Math.min(1,g.stones.length/12),
        liberties:Math.min(1,g.liberties.length/6)});
    }
  }
  const features=points.map(({q,r})=>{
    const key=pointKey(q,r),color=state.board[key];
    const relative=color?((COLORS.indexOf(color)-state.turn+3)%3):-1;
    const x=[+(relative===0),+(relative===1),+(relative===2),
      +(relative===-1),phase,0,0,0,0,0,0];
    if(relative>=0){
      x[5+relative]=groups.get(key).liberties;
      x[8+relative]=groups.get(key).size;
    }
    return includePhase?x:[...x.slice(0,4),...x.slice(5)];
  });
  const neighbors=points.map(({q,r})=>adjacentKeys(pointKey(q,r),state.radius)
    .map(k=>index.get(k)));
  return {radius:state.radius,turn:state.turn,moveCount:state.moveCount,
    features,neighbors};
}
function linear(layer,x){
  const result=new Array(layer.rows);
  for(let i=0;i<layer.rows;i++){
    let total=layer.bias[i];
    for(let j=0;j<layer.cols;j++)total+=layer.weights[i*layer.cols+j]*x[j];
    result[i]=total;
  }
  return result;
}
const relu=x=>x.map(v=>Math.max(0,v));
const softmax=x=>{
  const max=Math.max(...x),exp=x.map(v=>Math.exp(v-max));
  const total=exp.reduce((a,b)=>a+b,0);
  return exp.map(v=>v/total);
};
export function evaluatePV2(state,model){
  validatePV2Model(model);
  const {features,neighbors}=encodePV2State(state,model);
  const count=features.length;
  let hidden=features.map(x=>relu(linear(model.layers.embed,x)));
  for(const name of ['mix1','mix2','mix3']){
    hidden=hidden.map((x,i)=>{
      const mean=new Array(16).fill(0);
      for(const neighbor of neighbors[i])
        for(let h=0;h<16;h++)mean[h]+=hidden[neighbor][h]/neighbors[i].length;
      return relu(linear(model.layers[name],[...x,...mean]));
    });
  }
  const pooled=new Array(16).fill(0);
  for(const x of hidden)for(let h=0;h<16;h++)pooled[h]+=x[h]/count;
  const logits=hidden.map(x=>linear(model.layers.policy,x)[0]);
  logits.push(linear(model.layers.pass,pooled)[0]);
  const rawValue=linear(model.layers.value,
    relu(linear(model.layers.valueHidden,pooled)));
  // Legacy checkpoints predict three stone shares (softmax). New timeout-
  // penalty checkpoints predict independent real-valued returns, including
  // negative outcomes, without constraining their sum to one.
  const relative=model.metadata?.valueOutput==='independent'
    ? rawValue : softmax(rawValue);
  const value=new Array(3);
  for(let k=0;k<3;k++)value[(state.turn+k)%3]=relative[k];
  return {logits,value};
}
