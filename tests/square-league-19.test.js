import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createGame,play,pass} from '../src/game.js';
import {validateComparisonModel,selectComparisonMove} from '../src/architecture-comparison.js';
import {isCpuLevelSupported} from '../src/cpu-catalog.js';

const root=new URL('../',import.meta.url);
const relative=path=>new URL('../'+path,import.meta.url);
const source19='experiments/square-strength-stage2/gnn64-direct.json';

test('Real 3-player mixed-league rolls through every learning seat with only legal actions',()=>{
 const args=['scripts/square-league-selfplay.mjs','--model',source19,'--anchor',source19,
  '--radius','-9','--games','3','--seed','20261116','--temperature','1',
  '--sample-stride','3','--horizon-multiplier','3'];
 const run=()=>execFileSync(process.execPath,args,{cwd:root,encoding:'utf8'}).trim()
   .split('\n').map(JSON.parse);
 const one=run(),repeat=run();
 assert.deepEqual(one,repeat,'League sample seeds must be reproducible');
 assert.equal(one.length,3);
 for(let i=0;i<one.length;i++){
   const game=one[i];
   assert.equal(game.candidateSeat,i,'Train seat must rotate');
   assert.equal(game.radius,-9);
   assert.equal(game.finished,!game.truncated);
   assert.equal(game.wins.length,3);
   assert.equal(game.shares.length,3);
   assert.equal(game.rewards.length,3);
   assert.ok(game.samples.length>0);
   for(const sample of game.samples){
     assert.equal(sample.seat,game.candidateSeat);
     assert.ok(sample.legal.includes(sample.selected));
     assert.equal(sample.features.length,81);
     assert.equal(sample.value.length,3);
     assert.ok(sample.value.every(Number.isFinite));
   }
 }
});

test('No 19x19 CPU is promoted without a separate adoption test, but its GNN features are valid',()=>{
 const model=validateComparisonModel(JSON.parse(readFileSync(relative(source19),'utf8')));
 assert.equal(model.kind,'gnn64');
 assert.equal(isCpuLevelSupported('square-gnn64-boost-v1',-19),false);
 const state=createGame(-19);
 const t=performance.now();
 const move=selectComparisonMove(state,model,{greedy:true}).move;
 const elapsed=performance.now()-t;
 assert.ok(elapsed<5000,'19x19 GNN initialization inference too slow: '+elapsed);
 const result=move?play(state,move.q,move.r):pass(state);
 assert.equal(result.ok,true);
 assert.equal(result.state.moveCount,1);
});

test('League rejects illegal training configuration before sampling',()=>{
 assert.throws(()=>execFileSync(process.execPath,
  ['scripts/square-league-selfplay.mjs','--model',source19,'--anchor',source19,
   '--radius','-9','--games','0'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}),
  /status 1|Error/);
});
