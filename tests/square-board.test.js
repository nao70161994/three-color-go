import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,pointsOnBoard,adjacentKeys,boardPointsCount,play,pass,scores,winner,insideBoard} from '../src/game.js';
import {legalMoves,isOwnEye} from '../src/agent.js';
import {SQUARE_POLICY_WEIGHTS} from '../src/square-policy-weights.js';
import {SQUARE_TRAINED_LEVEL,squarePolicyDistribution,chooseSquareTrainedMove,squareTrainedModelInfo} from '../src/square-policy.js';

test('四角盤の9・13・19路と六角盤は保存形式で区別する',()=>{
  for(const n of [9,13,19]){
    const state=createGame(-n);
    assert.equal(state.radius,-n);
    assert.equal(pointsOnBoard(-n).length,n*n);
    assert.equal(boardPointsCount(-n),n*n);
    assert.equal(adjacentKeys('0,0',-n).length,2);
    assert.equal(adjacentKeys('4,4',-n).length,4);
    assert.equal(insideBoard(n-1,n-1,-n),true);
    assert.equal(insideBoard(n,0,-n),false);
    assert.equal(play(state,n,0).ok,false);
    assert.equal(play(state,-1,0).ok,false);
  }
  assert.throws(()=>createGame(-8));
  assert.throws(()=>createGame(-10));
  assert.equal(pointsOnBoard(4).length,61);
  assert.equal(adjacentKeys('0,0',4).length,6);
});
test('四角盤で斜めは連結しない・他2色が共同で取れる',()=>{
  const state={...createGame(-9),turn:2,board:{
    '4,4':'black','3,4':'white','4,3':'red','5,4':'white',
    '5,5':'black'
  }};
  const outcome=play(state,4,5);
  assert.equal(outcome.ok,true);
  assert.deepEqual(outcome.captured,['4,4']);
  assert.equal(outcome.state.board['4,4'],undefined);
  assert.equal(outcome.state.board['5,5'],'black');
});
test('四角盤で自殺手・着手済み・三者連続パスを確認',()=>{
  const blocked={...createGame(-9),board:{
    '3,4':'white','5,4':'red','4,3':'white','4,5':'red'
  }};
  assert.equal(play(blocked,4,4).ok,false);
  let state=createGame(-9);
  state=play(state,4,4).state;
  assert.equal(play(state,4,4).ok,false);
  for(let i=0;i<3;i++)state=pass(state).state;
  assert.equal(state.ended,true);
  assert.deepEqual(winner(state),['black']);
  assert.deepEqual(scores(state),{black:1,white:0,red:0});
});
test('square model is trained and selects only legal actions on every supported board',()=>{
  const info=squareTrainedModelInfo();
  assert.equal(info.games,SQUARE_POLICY_WEIGHTS.training.games);
  assert.ok(info.games>0);
  assert.deepEqual(info.trainedOn,[9,13,19]);
  assert.equal(SQUARE_TRAINED_LEVEL,'square-trained-v1');
  for(const n of [9,13,19]){
    const state=createGame(-n);
    const output=squarePolicyDistribution(state);
    assert.equal(output.actions.length,n*n+1);
    assert.ok(output.probabilities.every(Number.isFinite));
    assert.ok(Math.abs(output.probabilities.reduce((a,b)=>a+b,0)-1)<1e-10);
    const move=chooseSquareTrainedMove(state);
    assert.ok(move===null||play(state,move.q,move.r).ok);
  }
});
test('square board option, worker and offline model wiring are present',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/ai-worker.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  for(const n of [9,13,19])assert.ok(html.includes('value="-'+n+'"'));
  assert.ok(html.includes('value="'+SQUARE_TRAINED_LEVEL+'"'));
  const dispatcher=readFileSync(new URL('../src/cpu-engine.js',import.meta.url),'utf8');
  assert.ok(worker.includes('selectCpuMove'));
  assert.ok(main.includes('selectCpuMove'));
  assert.ok(dispatcher.includes('chooseSquareTrainedMove'));
  assert.ok(main.includes('boardExtent(view.radius)'));
});
