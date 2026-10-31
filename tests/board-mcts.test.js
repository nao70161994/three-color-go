import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,play,pass,pointKey,pointsOnBoard} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {boardPlanes,boardIndex,boardPredict,validateBoardModel,BOARD_AREA,
  BOARD_PASS} from '../src/board-pv.js';
import {chooseBoardMctsMove,terminalShares} from '../src/board-mcts.js';

function blankModel(){
  const layer=(size,outputs)=>({weights:new Array(size).fill(0),
    bias:new Array(outputs).fill(0)});
  return {
    architecture:'hex-board-pv-v1',version:'test-only-untrained',
    conv1:layer(8*8*3*3,8),conv2:layer(8*8*3*3,8),
    policy:layer(8,1),passHead:layer(8,1),valueHead:layer(3*8,3)
  };
}
test('whole-board representation includes every stone, turn and playable point',()=>{
  let state=createGame(3);
  const first=play(state,0,0);assert.equal(first.ok,true);
  state=first.state;
  const a=boardPlanes(state),p=boardIndex(0,0),cells=pointsOnBoard(3).length;
  assert.equal(a.length,8*BOARD_AREA);
  assert.equal(a[p],1);
  assert.equal(a[BOARD_AREA+p],0);
  assert.equal(a[3*BOARD_AREA+p],1);
  assert.equal(a[5*BOARD_AREA+p],1); // white is next
  assert.equal(a[4*BOARD_AREA+p],0);
  assert.ok(Math.abs(a[7*BOARD_AREA+p]-1/(2*cells))<1e-7);
  assert.equal(a[3*BOARD_AREA+boardIndex(10,0)],0);
});
test('full-board model produces 626 logits and calibrated three-way softmax',()=>{
  const model=blankModel();
  assert.equal(validateBoardModel(model),model);
  const result=boardPredict(createGame(2),model);
  assert.equal(result.policyLogits.length,BOARD_PASS+1);
  assert.equal(result.value.length,3);
  assert.ok(result.value.every(p=>Math.abs(p-1/3)<1e-6));
  assert.ok(result.policyLogits.every(Number.isFinite));
  assert.throws(()=>validateBoardModel({}),/Unknown board model/);
});
test('3-player terminal value assigns each color an independent win share',()=>{
  const state={...createGame(2),ended:true,
    board:{'0,0':'black','1,0':'white','-1,0':'red'}};
  assert.deepEqual(terminalShares(state),[1/3,1/3,1/3]);
  assert.deepEqual(terminalShares({...state,board:{'0,0':'black'}}),[1,0,0]);
  assert.throws(()=>terminalShares(createGame(2)),/finished/);
});
test('MCTS selects legal moves and preserves caller state',()=>{
  const model=blankModel(),state=createGame(2),before=JSON.stringify(state);
  const r=chooseBoardMctsMove(state,model,{simulations:8,temperature:0,
    random:seededRandom(123)});
  assert.ok(r);
  assert.equal(r.rootVisits,8);
  assert.ok(r.policy.some(item=>item.index===BOARD_PASS));
  assert.ok(Math.abs(r.policy.reduce((s,x)=>s+x.probability,0)-1)<1e-6);
  assert.ok(r.policy.every(item=>item.visits>=0));
  assert.ok(r.move===null||play(state,r.move.q,r.move.r).ok);
  assert.equal(JSON.stringify(state),before);
  const again=chooseBoardMctsMove(state,model,{simulations:8,
    temperature:0,random:seededRandom(123)});
  assert.equal(again.index,r.index);
  assert.throws(()=>chooseBoardMctsMove(state,model,{simulations:0}),/configuration/);
});
test('MCTS can play from all three colors without illegal transitions',()=>{
  const model=blankModel();
  let state=createGame(2);
  for(let i=0;i<9&&!state.ended;i++){
    const action=chooseBoardMctsMove(state,model,{simulations:3,
      temperature:1,noise:.2,random:seededRandom(i+10)});
    const result=action.move?play(state,action.move.q,action.move.r):pass(state);
    assert.equal(result.ok,true);
    state=result.state;
  }
  assert.ok(state.moveCount>2);
});
