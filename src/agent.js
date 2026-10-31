import { COLORS, adjacentKeys, createGame, pass, play, pointKey, pointsOnBoard, scores, winner } from './game.js';

/** Stable JSON view shared by browser automation and CLI agents. */
export function snapshot(state) {
  return {
    version: 1, radius: state.radius, board: { ...state.board },
    currentPlayer: state.ended ? null : COLORS[state.turn],
    moveCount: state.moveCount, consecutivePasses: state.passes,
    ended: state.ended, scores: scores(state), winners: winner(state),
    lastAction: state.lastAction
  };
}

export function legalMoves(state) {
  if (state.ended) return [];
  return pointsOnBoard(state.radius).filter(({q,r}) =>
    !state.board[pointKey(q,r)] && play(state,q,r).ok
  );
}

export function seededRandom(seed = 1) {
  let n = (Number(seed) >>> 0) || 1;
  return () => {
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    return (n >>> 0) / 4294967296;
  };
}

/** Reachable stones and liberties in one same-color group. */
export function groupInfo(board, start, radius) {
  if (!board[start]) return { stones: [], liberties: [] };
  const color=board[start], seen=new Set([start]), liberties=new Set(), queue=[start];
  for(let i=0;i<queue.length;i++) {
    for(const key of adjacentKeys(queue[i],radius)) {
      if (!board[key]) liberties.add(key);
      else if(board[key]===color && !seen.has(key)) { seen.add(key); queue.push(key); }
    }
  }
  return {stones:queue,liberties:[...liberties]};
}

function baselineValue(state,result,q,r,random) {
  const own=COLORS[state.turn], neighbors=adjacentKeys(pointKey(q,r),state.radius);
  const friends=neighbors.filter(k=>state.board[k]===own).length;
  const enemies=neighbors.filter(k=>state.board[k]&&state.board[k]!==own).length;
  const empties=neighbors.filter(k=>!result.state.board[k]).length;
  return result.captured.length*22 + friends*1.4 + enemies*.2 + empties*.5
    - (Math.abs(q)+Math.abs(r)+Math.abs(q+r))*.08 + random()*1.4;
}

function tacticalValue(state,result,q,r,random,atRisk) {
  const key=pointKey(q,r), own=COLORS[state.turn], next=result.state;
  const neighbors=adjacentKeys(key,state.radius);
  const group=groupInfo(next.board,key,state.radius);
  const ownNew=new Set(group.stones);
  // Rescue a friendly group with one liberty, but not if the resulting group
  // still has only one liberty. This avoids atari-suicide-style sacrifices.
  let rescued=0;
  if (group.liberties.length>=2) {
    for(const threat of atRisk) if(ownNew.has(threat.representative))
      rescued+=threat.size;
  }
  const selfAtari=group.liberties.length===1 ? Math.min(group.stones.length,10) : 0;
  const checked=new Set();let pressured=0;
  for(const neighbor of neighbors) {
    if(!next.board[neighbor]||next.board[neighbor]===own||checked.has(neighbor))continue;
    const enemy=groupInfo(next.board,neighbor,state.radius);
    for(const stone of enemy.stones)checked.add(stone);
    if(enemy.liberties.length===1) pressured+=Math.min(enemy.stones.length,6);
  }
  const open=neighbors.filter(k=>!next.board[k]).length;
  const friends=neighbors.filter(k=>state.board[k]===own).length;
  const edge=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))/state.radius;
  return 1 + result.captured.length*25 + rescued*14 + pressured*3.5
    + friends*.55 + open*.6 - selfAtari*22 - edge*.22 + random()*.4;
}

/**
 * A deterministic-under-seed one-ply tactical opponent.
 * strategy='baseline' keeps the previous v0.2 heuristic for A/B comparisons.
 * Returns a legal {q,r}, or null to pass. No rule changes are imposed.
 */
export function chooseMove(state, random=Math.random, strategy='tactical') {
  if(state.ended) return null;
  if(!['baseline','tactical'].includes(strategy)) throw new Error('Unknown AI strategy');
  // Stop bots from cycling forever; this is a bot policy, NOT a forced game rule.
  if(state.moveCount>=pointsOnBoard(state.radius).length*2)return null;
  const options=legalMoves(state);
  if(!options.length)return null;
  const own=COLORS[state.turn];
  const atRisk=[], visited=new Set();
  if(strategy==='tactical') {
    for(const key of Object.keys(state.board)) {
      if(state.board[key]!==own||visited.has(key))continue;
      const g=groupInfo(state.board,key,state.radius);
      for(const stone of g.stones)visited.add(stone);
      if(g.liberties.length===1)atRisk.push({representative:key,size:g.stones.length});
    }
  }
  let best=null,bestValue=-Infinity;
  for(const {q,r} of options) {
    const result=play(state,q,r);
    if(!result.ok)continue;
    const value=strategy==='baseline'
      ? baselineValue(state,result,q,r,random)
      : tacticalValue(state,result,q,r,random,atRisk);
    if(value>bestValue){bestValue=value;best={q,r};}
  }
  return best;
}

function jointCapture(before,after,captured,radius) {
  if(!captured.length)return false;
  const byVictim=new Map();
  for(const key of captured) {
    const victim=before[key];
    if(!byVictim.has(victim))byVictim.set(victim,[]);
    byVictim.get(victim).push(key);
  }
  for(const [victim,keys] of byVictim) {
    const attackers=new Set();
    for(const key of keys) for(const neighbor of adjacentKeys(key,radius)) {
      const adjacent=after[neighbor];
      if(adjacent && adjacent!==victim)attackers.add(adjacent);
    }
    if(attackers.size>=2)return true;
  }
  return false;
}

/** Reproducible game for browser/CLI/analytics. Includes legal replay moves. */
export function simulate({radius=3,seed=1,maxTurns=400,strategies=['tactical','tactical','tactical']}={}) {
  if(!Number.isInteger(maxTurns)||maxTurns<1)throw new Error('maxTurns must be positive');
  if(!Array.isArray(strategies)||strategies.length!==3||
      strategies.some(p=>!['baseline','tactical'].includes(p)))throw new Error('Invalid strategies');
  const random=seededRandom(seed);
  let state=createGame(radius);
  const history=[];
  while(!state.ended&&history.length<maxTurns) {
    const player=COLORS[state.turn];
    const move=chooseMove(state,random,strategies[state.turn]);
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw new Error(result.reason);
    const captured=result.captured??[];
    history.push({
      player,...(move||{pass:true}),captured:captured.length,
      jointCapture:jointCapture(state.board,result.state.board,captured,radius)
    });
    state=result.state;
  }
  return {state:snapshot(state),history,truncated:!state.ended,seed,strategies:[...strategies]};
}

/**
 * Explain endangered groups without implying that a capture is inevitable.
 * "Danger" means exactly one liberty, not that the group is necessarily lost.
 */
export function dangerGroups(state) {
  const visited=new Set(), result=[];
  for(const key of Object.keys(state.board)) {
    if(visited.has(key))continue;
    const group=groupInfo(state.board,key,state.radius);
    for(const stone of group.stones)visited.add(stone);
    if(group.liberties.length===1) {
      result.push({
        color:state.board[key],
        stones:[...group.stones],
        liberties:[...group.liberties]
      });
    }
  }
  return result;
}

/**
 * Human-facing CPU levels. Names are relative heuristic presets, not an Elo rating.
 * Keep chooseMove(...,'tactical') as the default for agent/analysis compatibility.
 */
export function chooseDifficultyMove(state,random=Math.random,level='hard') {
  if(!['easy','normal','hard'].includes(level))throw new Error('Unknown CPU level');
  if(level==='hard')return chooseMove(state,random,'tactical');
  if(level==='normal')return chooseMove(state,random,'baseline');
  if(state.ended || state.moveCount>=pointsOnBoard(state.radius).length*2)return null;
  const moves=legalMoves(state);
  return moves.length ? moves[Math.min(moves.length-1, Math.floor(random()*moves.length))] : null;
}
