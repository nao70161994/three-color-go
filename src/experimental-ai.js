import {COLORS,adjacentKeys,pass,play,pointKey,pointsOnBoard,scores} from './game.js';
import {groupInfo,isOwnEye,isUnsafeCpuMove} from './agent.js';
import {chooseNeuralMove} from './neural-ai.js';

/**
 * Three independent experimental agents:
 * - MaxN: each of the three players optimizes their own utility.
 * - MCTS: bounded, multi-player UCT with real-rule short rollouts.
 * - Hybrid: learned policy proposals plus tactical 3-player verification.
 *
 * All simulations use game.play()/pass() (including superko); no rule shortcuts.
 * Width, depth and rollouts are deliberately bounded for mobile browsers.
 */
export const EXPERIMENTAL_LEVELS=['maxn','mcts','hybrid'];
const boardSize=state=>3*state.radius*(state.radius+1)+1;
const cap=(x,a,b)=>Math.max(a,Math.min(b,x));
const ownIndex=state=>state.turn;
const vector=(state)=>{
  const count=scores(state),value=COLORS.map(c=>count[c]*6);
  const visited=new Set(),frontiers=COLORS.map(()=>new Set());
  for(const [key,color] of Object.entries(state.board)){
    if(visited.has(key))continue;
    const group=groupInfo(state.board,key,state.radius);
    group.stones.forEach(s=>visited.add(s));
    const seat=COLORS.indexOf(color),size=group.stones.length;
    if(group.liberties.length===1)value[seat]-=Math.min(24,size)*9;
    else if(group.liberties.length===2)value[seat]-=Math.min(24,size)*2;
    else value[seat]+=Math.min(15,size)*.2;
    group.liberties.forEach(k=>frontiers[seat].add(k));
  }
  for(let i=0;i<3;i++)value[i]+=frontiers[i].size*.35;
  return value;
};
const advantage=(values,seat)=>{
  const rivals=values.filter((_,i)=>i!==seat);
  return values[seat]-Math.max(...rivals)*.55-Math.min(...rivals)*.2;
};

function options(state,width,random=Math.random){
  if(state.ended||state.moveCount>=boardSize(state)*2)return [];
  const seat=ownIndex(state),color=COLORS[seat],board=state.board;
  const points=pointsOnBoard(state.radius);
  const urgency=new Map(),seen=new Set();
  for(const [key,occupant] of Object.entries(board)){
    if(seen.has(key))continue;
    const g=groupInfo(board,key,state.radius);
    g.stones.forEach(s=>seen.add(s));
    if(g.liberties.length>2)continue;
    const bonus=(g.liberties.length===1?10:2)*Math.min(g.stones.length,8)
      *(occupant===color?1.25:1);
    for(const liberty of g.liberties)
      urgency.set(liberty,(urgency.get(liberty)||0)+bonus);
  }
  const preliminary=points.filter(({q,r})=>!board[pointKey(q,r)]).map(({q,r})=>{
    const key=pointKey(q,r),near=adjacentKeys(key,state.radius);
    const friendly=near.filter(k=>board[k]===color).length;
    const hostile=near.filter(k=>board[k]&&board[k]!==color).length;
    const distance=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));
    return {q,r,priority:(urgency.get(key)||0)+friendly*1.8+
      hostile*2.6+near.filter(k=>!board[k]).length*.1-distance*.08};
  }).sort((a,b)=>b.priority-a.priority);
  // Keep all tactical liberties, then nearby moves. A full scan acts as a
  // fallback if a locality shortlist contains no playable candidates.
  const limit=state.radius<=4?preliminary.length:state.radius<=7?28:18;
  const pool=preliminary.slice(0,limit);
  const used=new Set(pool.map(p=>pointKey(p.q,p.r)));
  for(const candidate of preliminary)
    if(urgency.has(pointKey(candidate.q,candidate.r))&&!used.has(pointKey(candidate.q,candidate.r))){
      pool.push(candidate);used.add(pointKey(candidate.q,candidate.r));
    }
  const rankMoves=selected=>{
    const ranked=[];
    for(const {q,r} of selected){
      if(isOwnEye(state,q,r,color))continue;
      const result=play(state,q,r);
      if(!result.ok||isUnsafeCpuMove(state,q,r,result))continue;
      const utilities=vector(result.state);
      ranked.push({q,r,state:result.state,utilities,
        rank:advantage(utilities,seat)+result.captured.length*2.5+
          (urgency.get(pointKey(q,r))||0)*.2+random()*.01});
    }
    ranked.sort((a,b)=>b.rank-a.rank);
    return ranked;
  };
  let ranked=rankMoves(pool);
  if(!ranked.length&&pool.length!==preliminary.length)ranked=rankMoves(preliminary);
  return ranked.slice(0,width);
}
function successor(state,move){
  if(move)return move.state;
  const result=pass(state);
  return result.ok?result.state:state;
}
function searchMaxN(state,depth,width,random){
  if(depth===0||state.ended)return vector(state);
  const moves=options(state,width,random);
  if(!moves.length)return searchMaxN(successor(state,null),depth-1,width,random);
  const seat=ownIndex(state);
  let best=null,bestValue=-Infinity;
  for(const move of moves){
    const evaluated=searchMaxN(move.state,depth-1,width,random);
    if(evaluated[seat]>bestValue){best=evaluated;bestValue=evaluated[seat];}
  }
  return best;
}
function chooseMaxN(state,random,inspection){
  const seat=ownIndex(state);
  const width=state.radius<=4?6:state.radius<=7?4:3;
  const replyWidth=state.radius<=4?3:2;
  const roots=options(state,width,random);
  let chosen=null,best=-Infinity;
  for(const move of roots){
    const evaluation=searchMaxN(move.state,2,replyWidth,random);
    const score=advantage(evaluation,seat)+advantage(move.utilities,seat)*.12;
    if(score>best){best=score;chosen={q:move.q,r:move.r};}
    inspection?.push({q:move.q,r:move.r,score});
  }
  return chosen;
}
function normalized(state){
  const v=vector(state),denom=boardSize(state)*.45+8;
  return v.map((x,i)=>{
    const rivals=(v[(i+1)%3]+v[(i+2)%3])/2;
    return Math.tanh((x-rivals)/denom);
  });
}
function createNode(state,move=null){
  return {state,move,visits:0,total:[0,0,0],children:[],untried:null};
}
function candidateEntries(state,width,random){
  const available=options(state,width,random);
  return available.length?available:[{q:null,r:null,state:successor(state,null)}];
}
function chooseMCTS(state,random,inspection){
  const seat=ownIndex(state);
  const large=state.radius>=8;
  const simulations=large?18:state.radius>=5?36:72;
  const maxDepth=large?4:6;
  const nodeWidth=large?4:7;
  const root=createNode(state);
  for(let trial=0;trial<simulations;trial++){
    let current=root,depth=0;
    const path=[root];
    while(depth<maxDepth&&!current.state.ended){
      if(!current.untried)current.untried=candidateEntries(current.state,nodeWidth,random);
      if(current.children.length<current.untried.length){
        const item=current.untried[current.children.length];
        const child=createNode(item.state,{q:item.q,r:item.r});
        current.children.push(child);
        current=child;path.push(child);depth++;break;
      }
      if(!current.children.length)break;
      const chooser=current.state.turn;
      let bestChild=null,bestValue=-Infinity;
      for(const child of current.children){
        const uct=child.total[chooser]/Math.max(1,child.visits)+
          .75*Math.sqrt(Math.log(current.visits+1)/Math.max(1,child.visits));
        if(uct>bestValue){bestValue=uct;bestChild=child;}
      }
      current=bestChild;path.push(current);depth++;
    }
    let rollout=current.state;
    while(depth<maxDepth&&!rollout.ended){
      const possible=candidateEntries(rollout,2,random);
      const selected=possible.length>1&&random()<.25?possible[1]:possible[0];
      rollout=selected.state;depth++;
    }
    const result=normalized(rollout);
    for(const node of path){
      node.visits++;
      for(let i=0;i<3;i++)node.total[i]+=result[i];
    }
  }
  const ranked=root.children.filter(n=>n.move.q!==null)
    .sort((a,b)=>b.visits-a.visits||
      b.total[seat]/b.visits-a.total[seat]/a.visits);
  for(const node of ranked)
    inspection?.push({q:node.move.q,r:node.move.r,
      score:node.total[seat]/node.visits,visits:node.visits});
  return ranked.length?ranked[0].move:null;
}
function chooseHybrid(state,random,inspection){
  const neural=[];
  chooseNeuralMove(state,random,neural);
  const tactical=options(state,state.radius>=8?4:6,random);
  const combined=new Map();
  for(const move of tactical)combined.set(pointKey(move.q,move.r),move);
  // The old network supplies *proposals*, not an uncalibrated win probability.
  for(const move of neural){
    const key=pointKey(move.q,move.r);
    if(combined.has(key)||isOwnEye(state,move.q,move.r))continue;
    const result=play(state,move.q,move.r);
    if(!result.ok||isUnsafeCpuMove(state,move.q,move.r,result))continue;
    const utilities=vector(result.state);
    combined.set(key,{...move,state:result.state,utilities});
  }
  const seat=ownIndex(state);
  const topNeural=neural[0]?.score??0;
  let chosen=null,best=-Infinity;
  for(const move of combined.values()){
    const replyWidth=state.radius>=8?1:2;
    const after=searchMaxN(move.state,2,replyWidth,random);
    const neuralScore=neural.find(n=>n.q===move.q&&n.r===move.r)?.score;
    const prior=neuralScore===undefined?0:cap(neuralScore-topNeural,-5,0)*.5+1;
    const score=advantage(after,seat)+advantage(move.utilities,seat)*.2+prior;
    if(score>best){best=score;chosen={q:move.q,r:move.r};}
    inspection?.push({q:move.q,r:move.r,score,neural:neuralScore??null});
  }
  return chosen;
}

/** Return a legal move or null (pass), with deterministic behavior under a seed. */
export function chooseExperimentalMove(state,random=Math.random,level='maxn',inspection=null){
  if(!EXPERIMENTAL_LEVELS.includes(level))throw Error('Unknown experimental AI level');
  if(state.ended||state.moveCount>=boardSize(state)*2)return null;
  const results=Array.isArray(inspection)?inspection:null;
  const move=level==='maxn'?chooseMaxN(state,random,results):
    level==='mcts'?chooseMCTS(state,random,results):
      chooseHybrid(state,random,results);
  if(results)results.sort((a,b)=>b.score-a.score).splice(5);
  return move;
}
