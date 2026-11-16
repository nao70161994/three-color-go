import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,play,pass} from '../src/game.js';
import {SQUARE_BOOST_MODELS} from '../src/square-boost-model-data.js';
import {getSquareBoostModel,SQUARE_19_BETA_LEVEL,
  chooseSquare19BetaMove,square19BetaModelInfo} from '../src/square-boost-ai.js';
import {selectComparisonMove} from '../src/architecture-comparison.js';
import {isCpuLevelSupported,compatibleCpuLevel} from '../src/cpu-catalog.js';
import {selectCpuMove} from '../src/cpu-engine.js';

test('19x19 beta reuses exactly the already-reviewed source 13x13 checkpoint',()=>{
 const info=square19BetaModelInfo();
 assert.equal(info.id,SQUARE_19_BETA_LEVEL);
 assert.equal(info.board,19);
 assert.equal(info.sourceBoard,13);
 assert.equal(info.teacherTrainedOn19,false);
 assert.equal(info.experimental,true);
 assert.equal(getSquareBoostModel(-13),SQUARE_BOOST_MODELS['-13']);
 assert.deepEqual(Object.keys(SQUARE_BOOST_MODELS).sort(),['-13','-9'],
   'Do not embed a duplicate or unverified 19x19 checkpoint');
 const archived=JSON.parse(readFileSync(
   new URL('../experiments/square19-source/manifest.json',import.meta.url),'utf8'));
 assert.equal(archived.optInBetaEligible,true);
 for(const b of ['balanced','guarded']){
   assert.ok(archived.metrics[b].linear.outrankRate>.65);
   assert.ok(archived.metrics[b].linear.finished>=10);
 }
});

test('19x19 beta produces a greedy legal action and the same result as source GNN64',()=>{
 const state=createGame(-19);
 const reference=selectComparisonMove(state,getSquareBoostModel(-13),{greedy:true}).move;
 const start=performance.now();
 const selected=chooseSquare19BetaMove(state);
 const elapsed=performance.now()-start;
 assert.deepEqual(selected,reference);
 assert.ok(elapsed<5000,'No unbounded 19x19 inference: '+elapsed+'ms');
 const res=selected?play(state,selected.q,selected.r):pass(state);
 assert.equal(res.ok,true);
 const decision=selectCpuMove(state,SQUARE_19_BETA_LEVEL);
 assert.deepEqual(decision.move,selected);
 assert.equal(decision.decision.level,SQUARE_19_BETA_LEVEL);
 assert.ok(decision.decision.candidates.length>0);
});

test('19x19 beta is strictly opt-in, rejects other shapes and preserves defaults',()=>{
 assert.equal(isCpuLevelSupported(SQUARE_19_BETA_LEVEL,-19),true);
 for(const radius of [-9,-13,4,8]){
   assert.equal(isCpuLevelSupported(SQUARE_19_BETA_LEVEL,radius),false);
   assert.notEqual(compatibleCpuLevel(SQUARE_19_BETA_LEVEL,radius),SQUARE_19_BETA_LEVEL);
   assert.throws(()=>chooseSquare19BetaMove(createGame(radius)),/19路/);
   assert.throws(()=>selectCpuMove(createGame(radius),SQUARE_19_BETA_LEVEL),/19路/);
 }
});
