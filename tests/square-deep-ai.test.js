import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,play} from '../src/game.js';
import {comparisonShape,validateComparisonModel,selectComparisonMove} from '../src/architecture-comparison.js';
import {SQUARE_DEEP_MODELS} from '../src/square-deep-model-data.js';
import {SQUARE_DEEP_LEVELS,chooseSquareDeepMove,getSquareDeepModel} from '../src/square-deep-ai.js';

function zeroModel(kind){
  const layers={};
  for(const [name,[rows,cols]] of Object.entries(comparisonShape(kind))){
    layers[name]={rows,cols,weights:Array(rows*cols).fill(0),bias:Array(rows).fill(0)};
  }
  return {architecture:'tgo-comparison-v1',kind,layers,
    metadata:{features:10,phaseFeature:false,valueOutput:'independent',
      boardShape:'square',radii:[-9,-13]}};
}
test('Square deep model uses legal 4-neighbor moves and finite grid attention',()=>{
  for(const kind of ['gnn16','gnn64','attn64']){
    const model=validateComparisonModel(zeroModel(kind));
    for(const size of [9,13]){
      const state=createGame(-size);
      const result=selectComparisonMove(state,model,{greedy:true});
      assert.equal(result.probabilities.length,size*size+1);
      assert.ok(result.probabilities.every(Number.isFinite));
      assert.ok(Math.abs(result.probabilities.reduce((a,b)=>a+b,0)-1)<1e-9);
      if(result.move)assert.equal(play(state,result.move.q,result.move.r).ok,true);
    }
    assert.throws(()=>selectComparisonMove(createGame(4),model),/square board/i);
  }
});
test('Square deep policy is only exposed with real self-play checkpoints',()=>{
  assert.deepEqual(SQUARE_DEEP_LEVELS,
    ['square-gnn16-32','square-gnn64-32','square-attn64-32']);
  const count=Object.keys(SQUARE_DEEP_MODELS).length;
  assert.ok(count===0||count===3,'Models must be absent or complete');
  if(process.env.REQUIRE_SQUARE_DEEP_MODELS==='1')assert.equal(count,3);
  for(const id of SQUARE_DEEP_LEVELS){
    if(!SQUARE_DEEP_MODELS[id]){
      assert.throws(()=>getSquareDeepModel(id),/not yet trained/);
      continue;
    }
    const m=getSquareDeepModel(id);
    assert.equal(m.metadata.games,32);
    assert.equal(m.metadata.boardShape,'square');
    for(const size of [9,13,19]){
      const state=createGame(-size);
      const move=chooseSquareDeepMove(state,id);
      assert.ok(move===null||play(state,move.q,move.r).ok);
    }
  }
});
test('Square deep levels and offline bundle are wired across entrypoints',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  for(const file of ['index.html','src/main.js','src/ai-worker.js','scripts/build-standalone.mjs']){
    const txt=read(file);
    assert.ok(txt.includes('square-deep')||txt.includes('SQUARE_DEEP'));
  }
});
