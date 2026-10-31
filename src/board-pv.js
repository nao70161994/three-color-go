/**
 * Experimental full-board Policy-Value Network for three-player hex Go.
 *
 * Inputs are 8 complete 25x25 planes: black/white/red stones, valid cells,
 * three turn planes, and progress. There are NO per-move tactical features.
 * Network weights are loaded explicitly: no untrained model is deployed.
 *
 * CNN: 8->8 (3x3), 8->8 (3x3), spatial policy 8->1, pooled
 * pass logit and pooled 3-color value logits. Torch and JS use the same layout.
 */
import {COLORS,pointsOnBoard} from './game.js';

export const BOARD_WIDTH=25;
export const BOARD_AREA=BOARD_WIDTH*BOARD_WIDTH;
export const BOARD_PASS=BOARD_AREA;
export const BOARD_INPUT_CHANNELS=8;

export function boardIndex(q,r){
  if(!Number.isInteger(q)||!Number.isInteger(r)||Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))>12)
    throw Error('Invalid hex point');
  return (r+12)*BOARD_WIDTH+(q+12);
}
export function boardPlanes(state){
  const planes=new Float32Array(BOARD_INPUT_CHANNELS*BOARD_AREA);
  const turn=COLORS[state.turn];
  const phase=Math.min(1,state.moveCount/(2*pointsOnBoard(state.radius).length));
  for(const {q,r} of pointsOnBoard(state.radius)){
    const i=boardIndex(q,r),occupant=state.board[q+','+r];
    if(occupant){
      const color=COLORS.indexOf(occupant);
      if(color<0)throw Error('Unknown stone color');
      planes[color*BOARD_AREA+i]=1;
    }
    planes[3*BOARD_AREA+i]=1;
    planes[(4+state.turn)*BOARD_AREA+i]=1;
    planes[7*BOARD_AREA+i]=phase;
  }
  if(!COLORS.includes(turn))throw Error('Unknown player');
  return planes;
}
function checkLayer(layer,shape,name){
  if(!layer||!Array.isArray(layer.weights)||!Array.isArray(layer.bias)||
    layer.weights.length!==shape.reduce((a,b)=>a*b,1)||
    layer.bias.length!==shape[0]||
    !layer.weights.every(Number.isFinite)||!layer.bias.every(Number.isFinite))
    throw Error('Invalid board network layer '+name);
}
export function validateBoardModel(model){
  if(!model||model.architecture!=='hex-board-pv-v1')throw Error('Unknown board model');
  checkLayer(model.conv1,[8,8,3,3],'conv1');
  checkLayer(model.conv2,[8,8,3,3],'conv2');
  checkLayer(model.policy,[1,8,1,1],'policy');
  checkLayer(model.passHead,[1,8],'passHead');
  checkLayer(model.valueHead,[3,8],'valueHead');
  return model;
}
function convSame(input,layer,inChannels,outChannels,kernel,activate){
  const result=new Float32Array(outChannels*BOARD_AREA);
  const pad=(kernel-1)/2;
  for(let o=0;o<outChannels;o++){
    for(let y=0;y<BOARD_WIDTH;y++)for(let x=0;x<BOARD_WIDTH;x++){
      let v=layer.bias[o];
      for(let c=0;c<inChannels;c++){
        const base=((o*inChannels+c)*kernel)*kernel;
        for(let ky=0;ky<kernel;ky++){
          const sy=y+ky-pad;
          if(sy<0||sy>=BOARD_WIDTH)continue;
          for(let kx=0;kx<kernel;kx++){
            const sx=x+kx-pad;
            if(sx<0||sx>=BOARD_WIDTH)continue;
            v+=input[c*BOARD_AREA+sy*BOARD_WIDTH+sx]*
              layer.weights[base+ky*kernel+kx];
          }
        }
      }
      result[o*BOARD_AREA+y*BOARD_WIDTH+x]=activate?Math.max(0,v):v;
    }
  }
  return result;
}
function pooled(features,valid){
  const result=new Float32Array(8);
  let count=0;
  for(let i=0;i<BOARD_AREA;i++){
    if(!valid[i])continue;
    count++;
    for(let c=0;c<8;c++)result[c]+=features[c*BOARD_AREA+i];
  }
  if(count===0)throw Error('Empty board mask');
  for(let c=0;c<8;c++)result[c]/=count;
  return result;
}
function linear(input,layer,outputs){
  const result=new Float32Array(outputs);
  for(let o=0;o<outputs;o++){
    let sum=layer.bias[o];
    for(let i=0;i<input.length;i++)sum+=layer.weights[o*input.length+i]*input[i];
    result[o]=sum;
  }
  return result;
}
function softmax(logits){
  const m=Math.max(...logits);
  const exp=Array.from(logits,x=>Math.exp(x-m));
  const total=exp.reduce((s,x)=>s+x,0);
  return exp.map(x=>x/total);
}
const checked=new WeakSet();
export function boardPredict(state,model){
  if(!checked.has(model)){validateBoardModel(model);checked.add(model);}
  const input=boardPlanes(state),valid=input.subarray(3*BOARD_AREA,4*BOARD_AREA);
  const layer1=convSame(input,model.conv1,8,8,3,true);
  const layer2=convSame(layer1,model.conv2,8,8,3,true);
  const spatial=convSame(layer2,model.policy,8,1,1,false);
  const aggregate=pooled(layer2,valid);
  const logits=new Float32Array(BOARD_AREA+1);
  logits.set(spatial);
  logits[BOARD_PASS]=linear(aggregate,model.passHead,1)[0];
  const value=softmax(linear(aggregate,model.valueHead,3));
  return {policyLogits:logits,value};
}
