import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,play,pass,pointKey} from '../src/game.js';
import {isOwnEye,seededRandom} from '../src/agent.js';
import {chooseExperimentalMove,EXPERIMENTAL_LEVELS} from '../src/experimental-ai.js';

test('three experimental choices are seeded, legal, and do not mutate board',()=>{
  assert.deepEqual(EXPERIMENTAL_LEVELS,['maxn','mcts','hybrid']);
  for(const radius of [2,4]){
    for(const level of EXPERIMENTAL_LEVELS){
      const state=createGame(radius),before=JSON.stringify(state);
      const move=chooseExperimentalMove(state,seededRandom(2026),level);
      const repeated=chooseExperimentalMove(state,seededRandom(2026),level);
      assert.deepEqual(move,repeated,level+' radius '+radius);
      assert.ok(move,'no move for '+level);
      assert.equal(play(state,move.q,move.r).ok,true,level+' illegal opening');
      assert.equal(JSON.stringify(state),before,level+' mutated board');
    }
  }
});
test('all three agents can respond to a live three-color position',()=>{
  let game=createGame(3);
  for(const [q,r] of [[0,0],[1,0],[0,1],[-1,0],[1,-1],[-1,1]]){
    const applied=play(game,q,r);
    assert.ok(applied.ok,applied.reason);game=applied.state;
  }
  for(const level of EXPERIMENTAL_LEVELS){
    const inspection=[];
    const move=chooseExperimentalMove(game,seededRandom(4),level,inspection);
    assert.ok(move);
    assert.equal(play(game,move.q,move.r).ok,true);
    assert.equal(isOwnEye(game,move.q,move.r),false);
    assert.ok(inspection.length<=5);
    assert.ok(inspection.every(x=>Number.isFinite(x.score)));
  }
});
test('experimental CPUs pass on ended games or after bounded turn policy',()=>{
  for(const level of EXPERIMENTAL_LEVELS){
    const state=createGame(2);
    state.moveCount=38;
    assert.equal(chooseExperimentalMove(state,seededRandom(1),level),null);
    state.moveCount=0;
    state.ended=true;
    assert.equal(chooseExperimentalMove(state,seededRandom(1),level),null);
  }
  assert.throws(()=>chooseExperimentalMove(createGame(2),Math.random,'nonsense'),/Unknown experimental/);
});
test('all three new strategies remain legal on a 469-point opening',()=>{
  const state=createGame(12),before=JSON.stringify(state);
  for(const level of EXPERIMENTAL_LEVELS){
    const start=performance.now();
    const move=chooseExperimentalMove(state,seededRandom(71),level);
    assert.ok(move,'no move '+level);
    assert.ok(play(state,move.q,move.r).ok);
    assert.ok(performance.now()-start<10000,level+' exceeded 10s');
  }
  assert.equal(JSON.stringify(state),before);
});
