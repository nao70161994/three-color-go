import {COLORS,adjacentKeys,play,pointKey,pointsOnBoard} from './game.js';
import {groupInfo,isUnsafeCpuMove} from './agent.js';
import {NEURAL_MODEL} from './neural-weights.js';

// Compact offline policy evaluator. Self-play candidates can be benchmarked before promotion.
// Features are local to one candidate and color-relative, so one network
// works on every supported board radius and for all three player colors.
const decodedModels=new WeakMap();
export function neuralModelInfo(){
  return {version:NEURAL_MODEL.version,shape:[12,24,16,8,1],source:NEURAL_MODEL.training??NEURAL_MODEL.teacher};
}
function layers(model=NEURAL_MODEL){
  if(decodedModels.has(model))return decodedModels.get(model);
  const decoded=model.layers.map(layer=>{
    const bytes=atob(layer.weights);
    if(bytes.length!==layer.rows*layer.cols||layer.bias.length!==layer.rows)
      throw Error('Neural model dimensions invalid');
    const weights=new Int8Array(bytes.length);
    for(let i=0;i<bytes.length;i++)weights[i]=bytes.charCodeAt(i)>127
      ? bytes.charCodeAt(i)-256 : bytes.charCodeAt(i);
    return {...layer,weights};
  });
  decodedModels.set(model,decoded);
  return decoded;
}
export function neuralScore(features,model=NEURAL_MODEL){
  if(features.length!==12||features.some(n=>!Number.isFinite(n)))
    throw Error('Expected 12 finite policy features');
  let values=features;
  for(const [index,layer] of layers(model).entries()){
    const out=new Array(layer.rows);
    for(let row=0;row<layer.rows;row++){
      let value=layer.bias[row],start=row*layer.cols;
      for(let col=0;col<layer.cols;col++)
        value+=layer.weights[start+col]*layer.scale*values[col];
      out[row]=index===3?value:Math.max(0,value);
    }
    values=out;
  }
  return values[0];
}
export function neuralMoveFeatures(state,q,r,played){
  const {board,radius,turn}=state,own=COLORS[turn],key=pointKey(q,r);
  const neighbors=adjacentKeys(key,radius);
  const before=board,after=played.state.board;
  const friends=neighbors.filter(n=>before[n]===own).length;
  const enemies=neighbors.filter(n=>before[n]&&before[n]!==own).length;
  const empty=neighbors.filter(n=>!before[n]).length;
  const g=groupInfo(after,key,radius);
  let rescued=0,pressure=0;
  const ownSet=new Set(g.stones),checkedOwn=new Set(),checkedEnemy=new Set();
  for(const n of neighbors){
    if(before[n]===own&&!checkedOwn.has(n)){
      const group=groupInfo(before,n,radius);
      group.stones.forEach(k=>checkedOwn.add(k));
      if(group.liberties.length===1&&g.liberties.length>=2&&ownSet.has(n))
        rescued+=group.stones.length;
    }
    if(after[n]&&after[n]!==own&&!checkedEnemy.has(n)){
      const group=groupInfo(after,n,radius);
      group.stones.forEach(k=>checkedEnemy.add(k));
      if(group.liberties.length===1)pressure+=group.stones.length;
    }
  }
  const cells=3*radius*(radius+1)+1;
  const ownCount=Object.values(before).filter(c=>c===own).length;
  const otherCount=Math.max(...COLORS.filter(c=>c!==own)
    .map(c=>Object.values(before).filter(v=>v===c).length));
  const captureCount=played.captured.length;
  return [
    Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))/radius,
    Math.min(1,state.moveCount/(2*cells)),
    friends/6,enemies/6,empty/6,
    Math.min(1,captureCount/6),
    Math.min(1,g.liberties.length/6),
    Math.min(1,g.stones.length/12),
    Math.min(1,rescued/8),
    Math.min(1,pressure/8),
    +(g.liberties.length===1&&g.stones.length>captureCount),
    Math.max(-1,Math.min(1,(ownCount-otherCount)/(cells*.5)))
  ];
}
function shortlist(state,random){
  const pts=pointsOnBoard(state.radius);
  if(state.radius<8)return pts;
  const own=COLORS[state.turn],urgent=new Map(),visited=new Set();
  for(const [key,color] of Object.entries(state.board)){
    if(visited.has(key))continue;
    const g=groupInfo(state.board,key,state.radius);
    g.stones.forEach(k=>visited.add(k));
    if(g.liberties.length<=(color===own?2:1))
      for(const liberty of g.liberties){
        const [q,r]=liberty.split(',').map(Number);
        urgent.set(liberty,{q,r});
      }
  }
  const ranked=pts.filter(({q,r})=>!state.board[pointKey(q,r)])
    .map(({q,r})=>{
      const near=adjacentKeys(pointKey(q,r),state.radius);
      const friends=near.filter(n=>state.board[n]===own).length;
      const enemies=near.filter(n=>state.board[n]&&state.board[n]!==own).length;
      const edge=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))/state.radius;
      return {q,r,priority:friends*1.7+enemies*1.8-edge*.18+random()*.02};
    }).sort((a,b)=>b.priority-a.priority);
  for(const p of ranked){if(urgent.size>=48)break;urgent.set(pointKey(p.q,p.r),p);}
  return [...urgent.values()];
}
/**
 * The same legal/safety filters and candidate features are used by inference
 * and offline self-play. Stochastic training selects among these candidates.
 */
export function neuralCandidates(state,random=Math.random){
  if(state.ended||state.moveCount>=pointsOnBoard(state.radius).length*2)return [];
  const collect=points=>{
    const options=[];
    for(const {q,r} of points){
      if(state.board[pointKey(q,r)])continue;
      const played=play(state,q,r);
      if(!played.ok||isUnsafeCpuMove(state,q,r,played))continue;
      options.push({q,r,features:neuralMoveFeatures(state,q,r,played)});
    }
    return options;
  };
  const options=collect(shortlist(state,random));
  return options.length||state.radius<8?options:collect(pointsOnBoard(state.radius));
}
export function chooseNeuralMove(state,random=Math.random,inspection=null,model=NEURAL_MODEL){
  let best=null,bestValue=-Infinity;
  const ranked=[];
  for(const {q,r,features} of neuralCandidates(state,random)){
    const value=neuralScore(features,model);
    if(value>bestValue){bestValue=value;best={q,r};}
    if(Array.isArray(inspection))ranked.push({q,r,score:Math.round(value*1000)/1000});
  }
  if(Array.isArray(inspection))
    inspection.push(...ranked.sort((a,b)=>b.score-a.score).slice(0,5));
  return best;
}
