import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,play,pass,pointKey} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {getSquareBoostModel} from '../src/square-boost-ai.js';
import {selectComparisonMove} from '../src/architecture-comparison.js';
import {getHybridSourceModel,evaluateHybridCandidates,chooseSquareHybridMove,
  SQUARE_HYBRID_VARIANTS} from '../src/square-hybrid-ai.js';

test('hybrid variants preserve actual pretrained model provenance',()=>{
 assert.deepEqual(Object.keys(SQUARE_HYBRID_VARIANTS).sort(),
   ['neural-guard','teacher-blend','teacher-guard']);
 assert.equal(getHybridSourceModel(-9),getSquareBoostModel(-9));
 assert.equal(getHybridSourceModel(-13),getSquareBoostModel(-13));
 assert.equal(getHybridSourceModel(-19),getSquareBoostModel(-13));
 for(const radius of [3,4,8])assert.throws(()=>getHybridSourceModel(radius),/四角盤/);
});

test('all experimental hybrid variants propose legal, stable moves on 9/13/19',()=>{
 for(const radius of [-9,-13,-19]){
   const state=createGame(radius);
   for(const variant of Object.keys(SQUARE_HYBRID_VARIANTS)){
     const before=JSON.stringify(state);
     const got=evaluateHybridCandidates(state,{variant});
     assert.equal(got.variant,variant);
     assert.ok(got.candidates.length>0 && got.candidates.length<=5);
     const outcome=got.move?play(state,got.move.q,got.move.r):pass(state);
     assert.equal(outcome.ok,true,'legal '+radius+' '+variant);
     assert.deepEqual(chooseSquareHybridMove(state,null,variant),got.move);
     assert.equal(JSON.stringify(state),before,'Never mutate the source state');
     assert.ok(got.candidates.every(c=>Number.isFinite(c.score)));
   }
 }
});

test('teacher-blend and neural-guard use different computations but one learned model',()=>{
 const state=createGame(-9);
 const normal=selectComparisonMove(state,getSquareBoostModel(-9),{greedy:true}).move;
 const isolated=evaluateHybridCandidates(state,{variant:'neural-guard'});
 const mixed=evaluateHybridCandidates(state,{variant:'teacher-blend'});
 assert.deepEqual(isolated.neuralMove,normal);
 assert.ok(mixed.candidates.every(c=>c.teacherProbability!==null));
 assert.ok(isolated.candidates.every(c=>c.teacherProbability===null));
 assert.ok(mixed.candidates.every(c=>c.tacticalScore===undefined));
 assert.ok(isolated.candidates.every(c=>Number.isFinite(c.tacticalScore)));
});

test('hybrid CPU respects game legality during a midgame with captures',()=>{
 let s=createGame(-9),rng=seededRandom(7026);
 for(let i=0;i<27;i++){
   const next=chooseSquareHybridMove(s,null,'teacher-guard');
   const out=next?play(s,next.q,next.r):pass(s);
   assert.equal(out.ok,true,'Move '+i);
   s=out.state;
   if(s.ended)break;
 }
 assert.ok(s.moveCount>=15);
});

test('configuration rejects malformed settings and unsupported boards',()=>{
 const square=createGame(-9);
 assert.throws(()=>evaluateHybridCandidates(square,{variant:'oops'}),/不明/);
 for(const topK of [-1,1.2,33,NaN])
   assert.throws(()=>evaluateHybridCandidates(square,{topK}),/不正/);
 assert.throws(()=>evaluateHybridCandidates(createGame(4)),/四角盤/);
});
