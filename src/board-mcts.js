/**
 * Three-player MaxN/PUCT Monte Carlo Tree Search.
 * At EVERY node the color whose turn it is maximizes its OWN expected
 * terminal win share; do not apply two-player negamax sign flips.
 * Terminal values split tied victories, one unit total across three players.
 */
import {COLORS,pointsOnBoard,play,pass,winner} from './game.js';
import {isUnsafeCpuMove} from './agent.js';
import {BOARD_PASS,boardIndex,boardPredict} from './board-pv.js';

export function terminalShares(state){
  if(!state.ended)throw Error('Terminal shares require a finished game');
  const winners=winner(state);
  return COLORS.map(color=>winners.includes(color)?1/winners.length:0);
}
function policyOptions(state,prediction){
  const cells=pointsOnBoard(state.radius);
  const options=[];
  if(state.moveCount<cells.length*2){
    for(const {q,r} of cells){
      const result=play(state,q,r);
      if(result.ok&&!isUnsafeCpuMove(state,q,r,result))options.push({index:boardIndex(q,r),move:{q,r},
        next:result.state,logit:prediction.policyLogits[boardIndex(q,r)]});
    }
  }
  // Passing remains a rule-legal human action. This *bot policy* reserves
  // it for positions without safe candidates or after the two-board-length
  // move budget, exactly as the existing CPUs do.
  const passed=pass(state);
  if(passed.ok&&options.length===0)options.push({index:BOARD_PASS,move:null,
    next:passed.state,logit:prediction.policyLogits[BOARD_PASS]});
  const largest=Math.max(...options.map(x=>x.logit));
  const weights=options.map(x=>Math.exp(x.logit-largest));
  const total=weights.reduce((a,b)=>a+b,0);
  return options.map((option,i)=>({...option,prior:weights[i]/total,
    visits:0,valueSum:[0,0,0],child:null}));
}
function createNode(state){
  return {turn:state.turn,visits:0,edges:null,value:null};
}
function initialize(node,state,model,random,noise){
  const result=boardPredict(state,model);
  node.value=result.value;
  node.edges=policyOptions(state,result);
  if(noise>0&&node.edges.length>1){
    const samples=node.edges.map(()=>Math.max(1e-7,-Math.log(Math.max(1e-9,random()))));
    const total=samples.reduce((sum,n)=>sum+n,0);
    for(let i=0;i<node.edges.length;i++){
      node.edges[i].prior=(1-noise)*node.edges[i].prior+noise*samples[i]/total;
    }
  }
  return result.value;
}
function simulate(node,state,model,exploration){
  if(state.ended){
    node.visits++;
    return terminalShares(state);
  }
  if(node.edges===null){
    const value=initialize(node,state,model,Math.random,0);
    node.visits++;
    return value;
  }
  const sum=Math.sqrt(node.visits+1);
  let best=null,highest=-Infinity;
  for(const edge of node.edges){
    const q=edge.visits?edge.valueSum[node.turn]/edge.visits:0;
    const u=exploration*edge.prior*sum/(1+edge.visits);
    const rating=q+u;
    if(rating>highest){highest=rating;best=edge;}
  }
  if(!best)throw Error('Search node has no actions');
  if(!best.child)best.child=createNode(best.next);
  const value=simulate(best.child,best.next,model,exploration);
  node.visits++;
  best.visits++;
  for(let color=0;color<3;color++)best.valueSum[color]+=value[color];
  return value;
}
function probabilities(edges,temperature){
  if(temperature===0){
    const best=edges.reduce((a,b)=>b.visits>a.visits?b:a);
    return edges.map(e=>e===best?1:0);
  }
  const weights=edges.map(e=>e.visits>0?Math.pow(e.visits,1/temperature):0);
  let sum=weights.reduce((a,b)=>a+b,0);
  if(sum===0){sum=1;return edges.map(e=>e.prior);}
  return weights.map(n=>n/sum);
}
function sampleIndex(weights,random){
  let x=random()*weights.reduce((a,b)=>a+b,0);
  for(let i=0;i<weights.length;i++){
    x-=weights[i];
    if(x<0)return i;
  }
  return weights.length-1;
}
export function chooseBoardMctsMove(state,model,{
  simulations=32,exploration=1.4,temperature=0,noise=0,random=Math.random
}={}){
  if(state.ended)return null;
  if(!Number.isInteger(simulations)||simulations<1||simulations>2048||
     !Number.isFinite(exploration)||exploration<=0||exploration>10||
     !Number.isFinite(temperature)||temperature<0||temperature>10||
     !Number.isFinite(noise)||noise<0||noise>1)
    throw Error('Invalid MCTS configuration');
  const root=createNode(state);
  initialize(root,state,model,random,noise);
  for(let i=0;i<simulations;i++)simulate(root,state,model,exploration);
  const trainingPolicy=probabilities(root.edges,1);
  const selectionPolicy=probabilities(root.edges,temperature);
  const selected=root.edges[sampleIndex(selectionPolicy,random)];
  return {
    move:selected.move,index:selected.index,player:state.turn,
    policy:root.edges.map((edge,i)=>({index:edge.index,
      probability:trainingPolicy[i],visits:edge.visits})),
    value:root.value,simulations,rootVisits:root.visits
  };
}
