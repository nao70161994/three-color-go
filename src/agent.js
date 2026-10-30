import { COLORS, adjacentKeys, createGame, pass, play, pointKey, pointsOnBoard, scores, winner } from './game.js';

/** Read-only, JSON-serializable view for an AI agent or test harness. */
export function snapshot(state) {
  return {
    version: 1,
    radius: state.radius,
    board: { ...state.board },
    currentPlayer: state.ended ? null : COLORS[state.turn],
    moveCount: state.moveCount,
    consecutivePasses: state.passes,
    ended: state.ended,
    scores: scores(state),
    winners: winner(state),
    lastAction: state.lastAction
  };
}

export function legalMoves(state) {
  if (state.ended) return [];
  return pointsOnBoard(state.radius).filter(({q,r}) => {
    const key = pointKey(q,r);
    return !state.board[key] && play(state,q,r).ok;
  });
}

export function seededRandom(seed = 1) {
  let n = (Number(seed) >>> 0) || 1;
  return () => {
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    return (n >>> 0) / 4294967296;
  };
}

/** A lightweight tactical opponent, not a strong Go AI. Returns {q,r} or null (pass). */
export function chooseMove(state, random = Math.random) {
  // Prototype heuristic: avoid endless capture cycles; bots pass after two boardfuls of moves.
  // This is an AI policy only, not an extra mandatory end condition for human games.
  if (state.moveCount >= pointsOnBoard(state.radius).length * 2) return null;
  const options = legalMoves(state);
  if (!options.length) return null;
  const own = COLORS[state.turn];
  let best = null, bestValue = -Infinity;
  for (const {q,r} of options) {
    const result = play(state,q,r);
    const neighbors = adjacentKeys(pointKey(q,r),state.radius);
    const adjacentFriends = neighbors.filter(k => state.board[k]===own).length;
    const nearbyEnemies = neighbors.filter(k => state.board[k] && state.board[k]!==own).length;
    const afterLiberties = neighbors.filter(k => !result.state.board[k]).length;
    const value = result.captured.length*22 + adjacentFriends*1.4
      + nearbyEnemies*.2 + afterLiberties*.5 - (Math.abs(q)+Math.abs(r)+Math.abs(q+r))*.08
      + random()*1.4;
    if (value > bestValue) {bestValue=value; best={q,r};}
  }
  return best;
}

export function simulate({radius=3, seed=1, maxTurns=400}={}) {
  const random = seededRandom(seed);
  let state = createGame(radius);
  const history = [];
  while (!state.ended && history.length < maxTurns) {
    const color = COLORS[state.turn];
    const move = chooseMove(state,random);
    const result = move ? play(state,move.q,move.r) : pass(state);
    if (!result.ok) throw new Error(result.reason);
    history.push({player:color, ...(move || {pass:true}), captured:result.captured?.length ?? 0});
    state = result.state;
  }
  return {state:snapshot(state), history, truncated:!state.ended};
}
