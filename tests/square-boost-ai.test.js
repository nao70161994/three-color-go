import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGame,play,pass} from '../src/game.js';
import {SQUARE_BOOST_MODELS} from '../src/square-boost-model-data.js';
import {SQUARE_BOOST_LEVEL,getSquareBoostModel,squareBoostModelInfo,
 chooseSquareBoostMove} from '../src/square-boost-ai.js';
import {CPU_LEVELS,isCpuLevelSupported} from '../src/cpu-catalog.js';
import {selectCpuMove} from '../src/cpu-engine.js';

test('Only real hashed 512+teacher square GNN64s may ship as boosted CPU',()=>{
 const roots=JSON.parse(readFileSync(new URL('../experiments/square-strength-stage2/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(SQUARE_BOOST_MODELS).sort(),['-13','-9']);
 const sources={[-9]:'gnn64-staged',[-13]:'gnn64-direct'};
 for(const radius of [-9,-13]){
   const m=getSquareBoostModel(radius);
   const original=readFileSync(new URL('../experiments/square-strength-stage2/'+sources[radius]+'.json',import.meta.url),'utf8');
   assert.equal(createHash('sha256').update(original).digest('hex'),roots.variants[sources[radius]].sha256);
   assert.deepEqual(m.layers,JSON.parse(original).layers);
   assert.equal(m.kind,'gnn64');
   assert.equal(m.metadata.games,512);
   assert.equal(m.metadata.teacherDistillation,true);
   assert.equal(m.metadata.teacherTrainingSamples,3620);
   assert.equal(m.metadata.teacherValidationSamples,927);
   const state=createGame(radius);
   const move=chooseSquareBoostMove(state);
   assert.ok(move,'Initial greedy neural move must not be a pass');
   assert.equal(play(state,move.q,move.r).ok,true);
   const a=selectCpuMove(state,SQUARE_BOOST_LEVEL);
   assert.deepEqual(a.move,move);
   assert.equal(a.decision.level,SQUARE_BOOST_LEVEL);
   assert.ok(a.decision.candidates.length>0);
 }
 assert.equal(squareBoostModelInfo().length,2);
 assert.ok(CPU_LEVELS.includes(SQUARE_BOOST_LEVEL));
});

test('Boosted model rejects untrained boards and preserves deterministic legal action',()=>{
 for(const radius of [4,-19]){
   assert.equal(isCpuLevelSupported(SQUARE_BOOST_LEVEL,radius),false);
   assert.throws(()=>getSquareBoostModel(radius),/専用/);
   assert.throws(()=>selectCpuMove(createGame(radius),SQUARE_BOOST_LEVEL),/専用|四角盤/);
 }
 for(const radius of [-9,-13]){
   assert.equal(isCpuLevelSupported(SQUARE_BOOST_LEVEL,radius),true);
   const state=createGame(radius);
   const moves=[chooseSquareBoostMove(state),chooseSquareBoostMove(state)];
   assert.deepEqual(moves[0],moves[1]);
   const legal=moves[0]?play(state,moves[0].q,moves[0].r):pass(state);
   assert.equal(legal.ok,true);
 }
});

test('Square boosted models are shipped in PWA and standalone build paths',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const html=read('index.html'),sw=read('sw.js'),build=read('scripts/build-standalone.mjs'),ui=read('src/main.js');
 for(const tag of ['cpuLevel','seatBlack','seatWhite','seatRed']){
   const select=html.match(new RegExp('<select id="'+tag+'"[^>]*>([\\s\\S]*?)<\\/select>'));
   assert.ok(select[1].includes('value="'+SQUARE_BOOST_LEVEL+'"'));
 }
 assert.match(build,/squareBoostWeights/);
 assert.match(build,/squareBoost/);
 assert.ok(sw.includes('square-boost-model-data.js'));
 assert.ok(sw.includes('square-boost-ai.js'));
 assert.match(ui,/getSquareBoostModelInfo/);
});
