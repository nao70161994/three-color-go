import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,pass,play,pointKey} from '../src/game.js';
import {seededRandom,isOwnEye} from '../src/agent.js';
import {chooseNeuralMove,neuralModelInfo,neuralScore} from '../src/neural-ai.js';

test('neural policy has genuinely trained quantized layers and finite scores',()=>{
  const info=neuralModelInfo();
  assert.deepEqual(info.shape,[12,24,16,8,1]);
  assert.match(info.source,/synthetic tactical/);
  const x=new Array(12).fill(0);
  assert.ok(Number.isFinite(neuralScore(x)));
  x[5]=1;
  assert.notEqual(neuralScore(x),neuralScore(new Array(12).fill(0)));
  assert.throws(()=>neuralScore([1]),/12 finite/);
});
test('neural CPU chooses reproducible legal moves for all board sizes',()=>{
  for(const radius of [2,3,4,6,8,10,11,12]){
    const state=createGame(radius),before=JSON.stringify(state);
    const move=chooseNeuralMove(state,seededRandom(99));
    const repeat=chooseNeuralMove(state,seededRandom(99));
    assert.deepEqual(move,repeat,'radius '+radius);
    assert.ok(move,'radius '+radius);
    assert.equal(play(state,move.q,move.r).ok,true);
    assert.equal(JSON.stringify(state),before);
  }
});
test('neural policy works on every color and is safe over a short seeded game',()=>{
  let state=createGame(3);
  let moved=0;
  for(let i=0;i<55&&!state.ended;i++){
    const move=chooseNeuralMove(state,seededRandom(i+1));
    if(move){
      assert.equal(isOwnEye(state,move.q,move.r),false);
      const result=play(state,move.q,move.r);
      assert.equal(result.ok,true,'illegal neural move '+i);
      state=result.state;moved++;
    }else{
      const result=pass(state);
      assert.equal(result.ok,true);
      state=result.state;
    }
  }
  assert.ok(moved>8,'neural CPU should play rather than instantly pass');
});
test('neural CPU runs a large board within a bounded time budget',()=>{
  const state=createGame(12),t0=performance.now();
  const move=chooseNeuralMove(state,seededRandom(2026));
  assert.ok(move&&play(state,move.q,move.r).ok);
  assert.ok(performance.now()-t0<10000);
});
