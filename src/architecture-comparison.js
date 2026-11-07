/**
 * Experimental 10-feature no-phase architecture sweep.
 * 16/64-wide three-hop hex GNN, optionally + 2 full-board 4-head attention blocks.
 * No heuristic move filters, hand-crafted action bonuses, or forced passes.
 * The legacy PV2/PV3 production inference remains completely untouched.
 */
import {COLORS,pointsOnBoard,adjacentKeys,pointKey} from './game.js';
import {legalMoves,seededRandom} from './agent.js';
import {encodePV2State,PV3_ARCH} from './pv2-ai.js';

export const COMPARISON_ARCHS=Object.freeze({
  gnn16:{width:16,attentionLayers:0},
  gnn64:{width:64,attentionLayers:0},
  attn64:{width:64,attentionLayers:2}
});
const HEADS=4;
const DISTANCES=11; // trained relative-distance biases cover only hex distances 0..10

export function comparisonShape(kind){
  const spec=COMPARISON_ARCHS[kind];
  if(!spec)throw Error('Unknown comparison architecture: '+kind);
  const d=spec.width,shapes={
    embed:[d,10],mix1:[d,2*d],mix2:[d,2*d],mix3:[d,2*d],
    policy:[1,d],pass:[1,d],valueHidden:[d,d],value:[3,d]
  };
  for(let a=1;a<=spec.attentionLayers;a++){
    for(const name of ['Q','K','V','Out'])shapes['attn'+a+name]=[d,d];
    shapes['attn'+a+'Ff1']=[d*2,d];
    shapes['attn'+a+'Ff2']=[d,d*2];
    shapes['attn'+a+'Bias']=[HEADS,DISTANCES];
  }
  return shapes;
}

const validatedComparisonModels=new WeakSet();
export function validateComparisonModel(model){
  if(model?.architecture!=='tgo-comparison-v1'||!model.layers)throw Error('Not a comparison model');
  // Self-play calls inference on every turn; scanning 100k+ parameters per
  // turn made attention rollouts impractical. Check each frozen model once.
  if(validatedComparisonModels.has(model))return model;
  const shapes=comparisonShape(model.kind);
  for(const [name,[rows,cols]] of Object.entries(shapes)){
    const l=model.layers[name];
    if(!l||l.rows!==rows||l.cols!==cols||l.weights?.length!==rows*cols||
      l.bias?.length!==rows||[...l.weights,...l.bias].some(x=>!Number.isFinite(x)))
      throw Error('Invalid comparison layer '+name);
  }
  if(model.metadata?.valueOutput!=='independent'||
      model.metadata?.phaseFeature!==false||
      model.metadata?.features!==10)throw Error('Incorrect comparison metadata');
  validatedComparisonModels.add(model);
  return model;
}
const relu=x=>x.map(v=>Math.max(v,0));
function linear(layer,x){
  const y=new Array(layer.rows);
  for(let o=0;o<layer.rows;o++){
    let a=layer.bias[o],offset=o*layer.cols;
    for(let i=0;i<layer.cols;i++)a+=layer.weights[offset+i]*x[i];
    y[o]=a;
  }
  return y;
}
function softmax(values){
  const peak=Math.max(...values);
  // Fail visibly rather than silently choosing the first legal move when a
  // broken numerical path produces NaN (as out-of-range distance bias did).
  if(!Number.isFinite(peak))throw Error('Non-finite comparison policy logits');
  const exps=values.map(x=>Math.exp(x-peak));
  const total=exps.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(total)||total<=0)
    throw Error('Invalid comparison attention probability normalization');
  return exps.map(x=>x/total);
}
function attention(h,points,layers,layerName,d,stateRadius){
  const n=h.length,headDim=d/HEADS;
  const q=h.map(x=>linear(layers[layerName+'Q'],x));
  const k=h.map(x=>linear(layers[layerName+'K'],x));
  const v=h.map(x=>linear(layers[layerName+'V'],x));
  const bias=layers[layerName+'Bias'].weights;
  const outputs=[];
  for(let i=0;i<n;i++){
    const concat=new Array(d).fill(0);
    for(let head=0;head<HEADS;head++){
      const logits=[];
      for(let j=0;j<n;j++){
        let dot=0,off=head*headDim;
        for(let dim=0;dim<headDim;dim++)dot+=q[i][off+dim]*k[j][off+dim];
        const dq=points[i].q-points[j].q,dr=points[i].r-points[j].r;
        const distance=stateRadius<0 ? Math.abs(dq)+Math.abs(dr)
          : Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr));
        // The learned table ends at distance 10 (boards through radius 5).
        // On larger boards, reading out of bounds yields undefined and poisons
        // every attention probability with NaN. Clamp only the *bias bucket*:
        // all positions still participate in full-board attention.
        const distanceBucket=Math.min(distance,DISTANCES-1);
        logits.push(dot/Math.sqrt(headDim)+bias[head*DISTANCES+distanceBucket]);
      }
      const probabilities=softmax(logits),off=head*headDim;
      for(let j=0;j<n;j++)for(let dim=0;dim<headDim;dim++)
        concat[off+dim]+=probabilities[j]*v[j][off+dim];
    }
    let z=relu(linear(layers[layerName+'Out'],concat).map((x,j)=>x+h[i][j]));
    const feed=linear(layers[layerName+'Ff2'],relu(linear(layers[layerName+'Ff1'],z)));
    z=relu(z.map((x,j)=>x+feed[j]));
    outputs.push(z);
  }
  return outputs;
}
export function evaluateComparison(state,model){
  validateComparisonModel(model);
  if(model.metadata?.boardShape==='square'&&state.radius>=0)
    throw Error('Square deep model requires an orthogonal square board');
  if(model.metadata?.boardShape==='hex'&&state.radius<0)
    throw Error('Hex deep model is not trained for square boards');
  const {features,neighbors}=encodePV2State(state,{architecture:PV3_ARCH});
  const points=pointsOnBoard(state.radius),d=COMPARISON_ARCHS[model.kind].width;
  let h=features.map(f=>relu(linear(model.layers.embed,f)));
  for(let a=1;a<=3;a++){
    const old=h;
    h=old.map((x,i)=>{
      const avg=new Array(d).fill(0);
      for(const j of neighbors[i])for(let t=0;t<d;t++)avg[t]+=old[j][t]/neighbors[i].length;
      return relu(linear(model.layers['mix'+a],[...x,...avg]));
    });
  }
  for(let a=1;a<=COMPARISON_ARCHS[model.kind].attentionLayers;a++)
    h=attention(h,points,model.layers,'attn'+a,d,state.radius);
  const pooled=new Array(d).fill(0);
  for(const vector of h)for(let t=0;t<d;t++)pooled[t]+=vector[t]/h.length;
  const logits=h.map(v=>linear(model.layers.policy,v)[0]);
  logits.push(linear(model.layers.pass,pooled)[0]);
  const relative=linear(model.layers.value,relu(linear(model.layers.valueHidden,pooled)));
  const value=new Array(3);
  for(let i=0;i<3;i++)value[(state.turn+i)%3]=relative[i];
  return {logits,value};
}
export function selectComparisonMove(state,model,{
  random=seededRandom(1),temperature=1.5,greedy=false
}={}){
  if(state.ended)return {move:null,action:null};
  if(!Number.isFinite(temperature)||temperature<=0||temperature>10)
    throw Error('Invalid comparison temperature');
  const points=pointsOnBoard(state.radius),lookup=new Map(points.map((p,i)=>[pointKey(p.q,p.r),i]));
  const options=legalMoves(state).map(p=>({...p,index:lookup.get(pointKey(p.q,p.r)),type:'play'}));
  options.push({type:'pass',index:points.length});
  const {logits,value}=evaluateComparison(state,model);
  const probabilities=softmax(options.map(a=>logits[a.index]/temperature));
  let selected=0;
  if(greedy){
    for(let i=1;i<probabilities.length;i++)
      if(probabilities[i]>probabilities[selected])selected=i;
  }else{
    let draw=random();
    if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('Invalid random draw');
    selected=options.length-1;
    for(let i=0;i<probabilities.length;i++){draw-=probabilities[i];if(draw<0){selected=i;break;}}
  }
  const action=options[selected];
  return {action,move:action.type==='pass'?null:{q:action.q,r:action.r},
    actions:options,probabilities,value};
}
