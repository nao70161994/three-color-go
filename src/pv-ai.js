/**
 * Experimental full-board hex policy/value network + three-player MaxN PUCT.
 *
 * No handcrafted tactical teacher. Inputs are every intersection's relative
 * stone colors, emptiness and move progress. The same model produces a policy
 * for every point (and pass) and an outcome distribution for all three seats.
 *
 * Kept separate from the production CPU pending held-out strength benchmarks.
 */
import {COLORS,createGame,pointsOnBoard,pointKey,adjacentKeys,play,pass,winner} from './game.js';
import {safeCpuMoves,seededRandom} from './agent.js';
import {PV2_ARCH,evaluatePV2} from './pv2-ai.js';

export const PV_ARCH='hex-neighbor-pv-16-v1';
const H=16;
const SPECS={embed:[16,5],mix:[16,32],policy:[1,16],
  pass:[1,16],valueHidden:[16,16],value:[3,16]};

export function createInitialPVModel(seed=1){
  const random=seededRandom(seed);
  const layers={};
  for(const [name,[rows,cols]] of Object.entries(SPECS)){
    layers[name]={
      rows,cols,
      weights:Array.from({length:rows*cols},()=>+( (random()-.5)*2/Math.sqrt(cols) ).toFixed(7)),
      bias:Array.from({length:rows},()=>0)
    };
  }
  return {version:'pv-random-'+seed,architecture:PV_ARCH,training:'untrained',
    layers};
}

const validated=new WeakSet();
function checkModel(model){
  if(validated.has(model))return;
  if(!model||model.architecture!==PV_ARCH||!model.layers)
    throw Error('Unsupported policy-value model');
  for(const [name,[rows,cols]] of Object.entries(SPECS)){
    const l=model.layers[name];
    if(!l||l.rows!==rows||l.cols!==cols||l.weights.length!==rows*cols||
       l.bias.length!==rows||[...l.weights,...l.bias].some(n=>!Number.isFinite(n)))
      throw Error('Invalid policy-value layer '+name);
  }
  validated.add(model);
}
function linear(layer,inputs){
  const out=new Array(layer.rows);
  for(let i=0;i<layer.rows;i++){
    let sum=layer.bias[i];
    for(let j=0;j<layer.cols;j++)sum+=layer.weights[i*layer.cols+j]*inputs[j];
    out[i]=sum;
  }
  return out;
}
const relu=v=>v.map(x=>Math.max(0,x));
function stableSoftmax(values){
  const max=Math.max(...values);
  const exps=values.map(x=>Math.exp(x-max));
  const sum=exps.reduce((a,b)=>a+b,0);
  return exps.map(x=>x/sum);
}
export function encodePVState(state){
  const points=pointsOnBoard(state.radius);
  return {radius:state.radius,turn:state.turn,moveCount:state.moveCount,
    board:points.map(({q,r})=>{
      const found=state.board[pointKey(q,r)];
      return found?COLORS.indexOf(found):-1;
    })};
}
export function evaluatePV(state,model){
  if(model?.architecture===PV2_ARCH)return evaluatePV2(state,model);
  checkModel(model);
  const points=pointsOnBoard(state.radius);
  const indexes=new Map(points.map(({q,r},i)=>[pointKey(q,r),i]));
  const progress=Math.min(1,state.moveCount/(points.length*2));
  const embeddings=points.map(({q,r})=>{
    const stone=state.board[pointKey(q,r)];
    const x=[+(stone===COLORS[state.turn]),
      +(stone===COLORS[(state.turn+1)%3]),
      +(stone===COLORS[(state.turn+2)%3]),+(!stone),progress];
    return relu(linear(model.layers.embed,x));
  });
  const mixed=points.map(({q,r},i)=>{
    const ns=adjacentKeys(pointKey(q,r),state.radius).map(key=>indexes.get(key));
    const mean=Array(H).fill(0);
    for(const j of ns)for(let h=0;h<H;h++)mean[h]+=embeddings[j][h]/ns.length;
    return relu(linear(model.layers.mix,[...embeddings[i],...mean]));
  });
  const pooled=Array(H).fill(0);
  for(const cell of mixed)for(let h=0;h<H;h++)pooled[h]+=cell[h]/mixed.length;
  const logits=mixed.map(cell=>linear(model.layers.policy,cell)[0]);
  logits.push(linear(model.layers.pass,pooled)[0]);
  const relativeValue=stableSoftmax(linear(model.layers.value,
    relu(linear(model.layers.valueHidden,pooled))));
  const value=Array(3);
  for(let k=0;k<3;k++)value[(state.turn+k)%3]=relativeValue[k];
  return {logits,value};
}

export function legalPVActions(state){
  if(state.ended)return [];
  const cells=pointsOnBoard(state.radius).length;
  if(state.moveCount>=cells*2)return [{type:'pass',index:cells}];
  const points=pointsOnBoard(state.radius);
  const index=new Map(points.map(({q,r},i)=>[pointKey(q,r),i]));
  const moves=safeCpuMoves(state).map(({q,r})=>({
    type:'play',q,r,index:index.get(pointKey(q,r))
  }));
  // Stone-count scoring rewards surviving stones, not territory.
  // Unlike territory Go, passing while safe placements remain loses turns.
  // Preserve passing when there is no safe move (or at the bot move cap).
  if(!moves.length)moves.push({type:'pass',index:cells});
  return moves;
}
function apply(state,action){
  const next=action.type==='pass'?pass(state):play(state,action.q,action.r);
  if(!next.ok)throw Error('MCTS generated illegal move: '+next.reason);
  return next.state;
}
function terminalValue(state){
  const winners=winner(state),result=[0,0,0];
  for(const color of winners)result[COLORS.indexOf(color)]=1/winners.length;
  return result;
}
function expand(node,model){
  if(node.state.ended)return terminalValue(node.state);
  const output=evaluatePV(node.state,model);
  const options=legalPVActions(node.state);
  const probs=stableSoftmax(options.map(a=>output.logits[a.index]));
  node.children=options.map((action,i)=>({
    action,prior:probs[i],state:null,children:null,visits:0,total:[0,0,0]
  }));
  return output.value;
}
function perturbRootPriors(children,strength,random){
  if(!strength||children.length<2)return;
  // Normalized exponential draws give reproducible Dirichlet(1) noise.
  // This changes exploration only; the learning target still comes from
  // MCTS visits and the actual terminal game result.
  const draws=children.map(()=>-Math.log(Math.max(1e-12,1-random())));
  const total=draws.reduce((a,b)=>a+b,0);
  for(let i=0;i<children.length;i++)
    children[i].prior=(1-strength)*children[i].prior+
      strength*draws[i]/total;
}
function selectChild(node,exploration,random){
  let best=null,highest=-Infinity;
  const seat=node.state.turn;
  for(const child of node.children){
    const q=child.visits?child.total[seat]/child.visits:1/3;
    const u=exploration*child.prior*Math.sqrt(node.visits+1)/(1+child.visits);
    const score=q+u;
    if(score>highest+1e-12||(Math.abs(score-highest)<=1e-12&&random()<.5)){
      highest=score;best=child;
    }
  }
  return best;
}

/**
 * MaxN: nodes select the move maximizing the CURRENT player's expected
 * outcome, while backups retain all three absolute-color value components.
 * This is not a 2-player negamax sign flip.
 */
export function searchPV(state,model,{simulations=24,exploration=1.4,
  random=seededRandom(1),rootNoise=0}={}){
  if(!Number.isInteger(simulations)||simulations<1||simulations>512||
     !Number.isFinite(exploration)||exploration<=0||
     !Number.isFinite(rootNoise)||rootNoise<0||rootNoise>1)
    throw Error('Invalid search budget');
  if(state.ended)return {move:null,options:[],policy:[],value:terminalValue(state)};
  const root={state,children:null,visits:0,total:[0,0,0]};
  expand(root,model);
  perturbRootPriors(root.children,rootNoise,random);
  for(let simulation=0;simulation<simulations;simulation++){
    let node=root;
    const path=[node];
    while(node.children&&node.children.length){
      const child=selectChild(node,exploration,random);
      if(child.state===null)child.state=apply(node.state,child.action);
      node=child;path.push(node);
      if(node.children===null)break;
    }
    const value=node.state.ended?terminalValue(node.state):expand(node,model);
    for(const step of path){
      step.visits++;
      for(let k=0;k<3;k++)step.total[k]+=value[k];
    }
  }
  const policy=Array(pointsOnBoard(state.radius).length+1).fill(0);
  const options=root.children.map(child=>{
    policy[child.action.index]=child.visits/simulations;
    return {...child.action,visits:child.visits,prior:child.prior};
  });
  let best=options[0];
  for(const option of options)if(option.visits>best.visits)best=option;
  return {move:best.type==='pass'?null:{q:best.q,r:best.r},
    options,policy,value:root.total.map(x=>x/root.visits)};
}
export function choosePVMove(state,model,simulations=24,random=seededRandom(1)){
  return searchPV(state,model,{simulations,random}).move;
}
