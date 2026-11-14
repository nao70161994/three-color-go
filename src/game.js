/**
 * Three-color hex Go (local prototype).
 * Axial hex coordinates, six neighbors, stone-count scoring.
 * No territory scoring or komi. Positional superko on stone placements.
 */

export const COLORS = ['black', 'white', 'red'];
export const LABELS = { black: '黒', white: '白', red: '赤' };
const HEX_DIRECTIONS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const SQUARE_DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1]];
// Negative radius encodes a square grid: -9 means 9×9, etc.
// Positive radii retain historical hex geometry and save formats.
export const SQUARE_SIZES = Object.freeze([9,13,19]);
export function insideBoard(q,r,radius){
  if(!Number.isInteger(q)||!Number.isInteger(r))return false;
  return radius<0 ? q>=0&&r>=0&&q< -radius&&r< -radius
    : Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=radius;
}
export function boardPointsCount(radius){return radius<0?radius*radius:3*radius*(radius+1)+1;}

export function pointKey(q, r) { return `${q},${r}`; }

export function pointsOnBoard(radius = 4) {
  const points = [];
  if(radius<0){for(let r=0;r< -radius;r++)for(let q=0;q< -radius;q++)points.push({q,r});return points;}
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) points.push({q, r});
    }
  }
  return points;
}

export function adjacentKeys(key, radius) {
  const [q, r] = key.split(',').map(Number);
  return (radius<0?SQUARE_DIRECTIONS:HEX_DIRECTIONS).map(([dq, dr]) => [q+dq, r+dr])
    .filter(([x, y]) => insideBoard(x,y,radius))
    .map(([x,y]) => pointKey(x,y));
}

// Cache a frozen history array's membership set per immutable state version.
const historySets=new WeakMap();
function hasPosition(state,hash){
  let set=historySets.get(state.seen);
  if(!set){set=new Set(state.seen);historySets.set(state.seen,set);}
  return set.has(hash);
}
export function boardHash(board) {
  return Object.keys(board).sort().map(k => `${k}:${board[k]}`).join('|');
}

export function createGame(radius = 4) {
  if (!Number.isInteger(radius) || !(radius>=2&&radius<=12) && !SQUARE_SIZES.includes(-radius))
    throw new Error('六角盤は半径2～12、四角盤は9・13・19路にしてください');
  return {
    radius,
    board: {},
    turn: 0,
    passes: 0,
    ended: false,
    seen: [boardHash({})],
    moveCount: 0,
    lastAction: 'ゲーム開始'
  };
}

function groupWithLiberties(board, start, radius) {
  const color = board[start];
  if (!color) return { stones: [], liberties: new Set() };
  const pending = [start], visited = new Set([start]);
  const liberties = new Set();
  for (let i=0; i<pending.length; i++) {
    const current = pending[i];
    for (const next of adjacentKeys(current, radius)) {
      if (!board[next]) liberties.add(next);
      else if (board[next] === color && !visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return { stones: pending, liberties };
}

/** Pure legal move. Returns {ok, state, captured} or {ok:false, reason}. */
export function play(state, q, r) {
  if (state.ended) return {ok:false, reason:'すでに終局しています'};
  if (!insideBoard(q,r,state.radius)) {
    return {ok:false, reason:'盤外には置けません'};
  }
  const target = pointKey(q, r);
  if (state.board[target]) return {ok:false, reason:'すでに石があります'};

  const color = COLORS[state.turn];
  const board = { ...state.board, [target]: color };
  const captured = [];
  const processed = new Set();
  // Evaluate all adjacent opposing groups against the same post-placement board.
  // Removing one group early must not grant liberties to another group that
  // simultaneously reached zero liberties (a special case in three-color Go).
  for (const neighbor of adjacentKeys(target, state.radius)) {
    if (!board[neighbor] || board[neighbor] === color || processed.has(neighbor)) continue;
    const group = groupWithLiberties(board, neighbor, state.radius);
    group.stones.forEach(k => processed.add(k));
    if (group.liberties.size === 0) captured.push(...group.stones);
  }
  captured.forEach(k => delete board[k]);
  if (groupWithLiberties(board, target, state.radius).liberties.size === 0) {
    return {ok:false, reason:'自殺手は禁止です'};
  }
  const hash = boardHash(board);
  if (hasPosition(state,hash)) return {ok:false, reason:'全局同形禁止により置けません'};
  const next = {
    ...state, board, turn:(state.turn+1)%3, passes:0,
    moveCount: state.moveCount + 1,
    seen: [...state.seen, hash],
    lastAction: `${LABELS[color]}が着手${captured.length ? `（${captured.length}石取り）` : ''}`
  };
  return {ok:true, state:next, captured};
}

export function pass(state) {
  if (state.ended) return {ok:false, reason:'すでに終局しています'};
  const passes = state.passes + 1;
  return {ok:true, state: {
    ...state, passes, turn:(state.turn+1)%3,
    ended: passes >= 3,
    moveCount: state.moveCount + 1,
    lastAction: passes >= 3 ? '3人連続パスで終局' : `${LABELS[COLORS[state.turn]]}がパス`
  }};
}

export function scores(state) {
  const count = {black:0, white:0, red:0};
  Object.values(state.board).forEach(color => { count[color]++; });
  return count;
}

export function winner(state) {
  if (!state.ended) return [];
  const s = scores(state), max = Math.max(...Object.values(s));
  return COLORS.filter(c => s[c] === max);
}
