import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, play, pass, scores, winner, pointsOnBoard, adjacentKeys} from '../src/game.js';

function moved(state, q, r) {
  const result=play(state,q,r);
  assert.equal(result.ok,true,JSON.stringify(result));
  return result.state;
}

test('半径4の正六角盤は61点で、中央には6隣接点がある',()=>{
  assert.equal(pointsOnBoard(4).length,61);
  assert.equal(adjacentKeys('0,0',4).length,6);
  assert.equal(adjacentKeys('4,0',4).length,3);
});

test('石の設置・手番・石数得点',()=>{
  let s=createGame(2);
  s=moved(s,0,0);
  assert.equal(s.turn,1);
  s=moved(s,1,0);
  assert.equal(s.turn,2);
  assert.deepEqual(scores(s),{black:1,white:1,red:0});
});

test('既存の石、盤外、自殺手を拒否する',()=>{
  let s=createGame(2);
  s=moved(s,0,0);
  assert.equal(play(s,0,0).ok,false);
  assert.equal(play(s,3,0).ok,false);
  // Isolate empty center (0,0) with six neighboring opposing stones.
  // All neighbors in a hex grid can be occupied and still have liberties elsewhere.
  s={...createGame(2), turn:0,board:{'1,0':'white','1,-1':'red','0,-1':'white','-1,0':'red','-1,1':'white','0,1':'red'}};
  assert.equal(play(s,0,0).ok,false);
});

test('異なる色の2人が囲んだ石も取れる',()=>{
  // Black in center with one remaining liberty at (0,1). White places last liberty.
  const s={...createGame(2),turn:1,board:{'0,0':'black','1,0':'white','1,-1':'red','0,-1':'white','-1,0':'red','-1,1':'white'}};
  const result=play(s,0,1);
  assert.equal(result.ok,true);
  assert.deepEqual(result.captured,['0,0']);
  assert.equal(result.state.board['0,0'],undefined);
  assert.deepEqual(scores(result.state),{black:0,white:4,red:2});
});

test('3人連続パスで終了し同点なら複数勝者',()=>{
  let s=createGame(2);
  for(let i=0;i<3;i++) s=pass(s).state;
  assert.equal(s.ended,true);
  assert.deepEqual(winner(s),['black','white','red']);
  assert.equal(pass(s).ok,false);
  assert.equal(play(s,0,0).ok,false);
});

test('途中の着手で連続パスはリセット',()=>{
  let s=pass(createGame(2)).state;
  s=moved(s,0,0);
  assert.equal(s.passes,0);
});

test('過去に現れた盤面への再現は拒否',()=>{
  const s={...createGame(2),seen:['','0,0:black'],board:{}};
  assert.equal(play(s,0,0).ok,false);
});

test('異なる2色の集団は同時に呼吸点が0なら両方取れる',()=>{
  const board={'1,0':'white','0,1':'red'};
  for (const k of ['2,0','2,-1','1,-1','1,1','0,2','-1,2','-1,1']) board[k]='black';
  const s={...createGame(3),board,turn:0};
  const result=play(s,0,0);
  assert.equal(result.ok,true);
  assert.deepEqual(new Set(result.captured),new Set(['1,0','0,1']));
  assert.equal(result.state.board['1,0'],undefined);
  assert.equal(result.state.board['0,1'],undefined);
});
