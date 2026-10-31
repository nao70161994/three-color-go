import test from 'node:test';
import assert from 'node:assert/strict';
import {COLORS,createGame,play,pointKey,pointsOnBoard} from '../src/game.js';
import {chooseDifficultyMove,chooseMove,isOwnEye,legalMoves,safeCpuMoves,seededRandom} from '../src/agent.js';
import {chooseStrongMove} from '../src/strong-ai.js';

function fullBlackWithHoles(holes, radius=3) {
  const s=createGame(radius), excluded=new Set(holes);
  for(const {q,r} of pointsOnBoard(radius)) {
    const k=pointKey(q,r);
    if(!excluded.has(k))s.board[k]='black';
  }
  return s;
}

test('regression: filling one of two true eyes makes the entire group capturable',()=>{
  const state=fullBlackWithHoles(['0,0','2,-2']);
  assert.equal(isOwnEye(state,0,0),true);
  assert.equal(isOwnEye(state,2,-2),true);
  assert.deepEqual(new Set(legalMoves(state).map(({q,r})=>pointKey(q,r))),
    new Set(['0,0','2,-2']), 'engine must continue to treat eye fills as legal');
  const mistake=play(state,0,0);
  assert.equal(mistake.ok,true);
  const opponent=play(mistake.state,2,-2);
  assert.equal(opponent.ok,true);
  assert.equal(opponent.captured.length,36,
    'the opponent could capture the entire ring after the bot fills one eye');
  assert.equal(chooseStrongMove(state,seededRandom(17)),null,
    'hard CPU must pass rather than destroy its two eyes');
  for(const level of ['easy','normal','hard'])
    assert.equal(chooseDifficultyMove(state,seededRandom(17),level),null,level);
  for(const strategy of ['baseline','tactical','guarded','balanced'])
    assert.equal(chooseMove(state,seededRandom(17),strategy),null,strategy);
});

test('both cells of a two-cell enclosed eye space are protected',()=>{
  const state=fullBlackWithHoles(['0,0','1,0']);
  assert.equal(isOwnEye(state,0,0),true);
  assert.equal(isOwnEye(state,1,0),true);
  assert.deepEqual(safeCpuMoves(state),[]);
  assert.equal(chooseStrongMove(state,seededRandom(2)),null);
});

test('CPU still takes a useful outside move rather than filling an own eye',()=>{
  const state=fullBlackWithHoles(['0,0','2,-2','3,0']);
  state.board['2,0']='white';
  assert.equal(isOwnEye(state,0,0),true);
  assert.equal(isOwnEye(state,2,-2),true);
  assert.equal(isOwnEye(state,3,0),false);
  for(const level of ['easy','normal']) {
    const move=chooseDifficultyMove(state,seededRandom(3),level);
    assert.ok(move);
    assert.equal(isOwnEye(state,move.q,move.r),false);
    assert.equal(play(state,move.q,move.r).ok,true);
  }
  const hard=chooseStrongMove(state,seededRandom(3));
  assert.ok(hard);
  assert.equal(isOwnEye(state,hard.q,hard.r),false);
});

test('an invasion or a large empty space must not be misclassified as a protected eye',()=>{
  const invaded=fullBlackWithHoles(['0,0','1,0','0,-1']);
  invaded.board['1,-1']='red';
  assert.equal(isOwnEye(invaded,0,0),false);
  const open=createGame(3);
  assert.equal(isOwnEye(open,0,0),false);
  assert.equal(isOwnEye(open,9,0),false);
  assert.equal(isOwnEye(open,0,0,'purple'),false);
  assert.equal(isOwnEye(open,0.5,0),false);
});

test('eye decision never mutates the board, history, or turn order',()=>{
  const state=fullBlackWithHoles(['0,0','2,-2']);
  const original=JSON.stringify(state);
  const counts=COLORS.map(c=>Object.values(state.board).filter(x=>x===c).length);
  assert.deepEqual(counts,[35,0,0]);
  assert.deepEqual(safeCpuMoves(state),[]);
  assert.equal(JSON.stringify(state),original);
});
