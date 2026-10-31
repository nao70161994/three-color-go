import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {COLORS,createGame,play,pass,pointsOnBoard} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {createInitialPVModel,encodePVState,evaluatePV,
  legalPVActions,searchPV,choosePVMove} from '../src/pv-ai.js';

const model=createInitialPVModel(123);
test('full board encoding uses every hex intersection, not 12 move features',()=>{
  for(const radius of [2,3,4,12]){
    const state=createGame(radius);
    const encoded=encodePVState(state);
    assert.equal(encoded.board.length,3*radius*(radius+1)+1);
    assert.ok(encoded.board.every(s=>s===-1));
    const scored=evaluatePV(state,model);
    assert.equal(scored.logits.length,encoded.board.length+1);
    assert.ok(scored.logits.every(Number.isFinite));
    assert.ok(scored.value.every(x=>x>=0&&x<=1));
    assert.ok(Math.abs(scored.value.reduce((a,b)=>a+b,0)-1)<1e-8);
  }
});
test('three-player search returns legal, repeatable moves with visit normalization',()=>{
  for(const radius of [2,3]){
    const state=createGame(radius);
    const before=JSON.stringify(state);
    const result=searchPV(state,model,{simulations:5,random:seededRandom(42)});
    const repeated=searchPV(state,model,{simulations:5,random:seededRandom(42)});
    assert.deepEqual(result,repeated);
    assert.equal(result.options.reduce((n,a)=>n+a.visits,0),5);
    assert.ok(Math.abs(result.policy.reduce((a,b)=>a+b,0)-1)<1e-8);
    assert.ok(result.move&&play(state,result.move.q,result.move.r).ok);
    assert.equal(JSON.stringify(state),before);
    assert.deepEqual(choosePVMove(state,model,5,seededRandom(42)),result.move);
  }
});
test('legal MCTS actions obey real rule engine including forced passes',()=>{
  let state=createGame(2);
  for(let i=0;i<40&&!state.ended;i++){
    const actions=legalPVActions(state);
    assert.ok(actions.length);
    for(const a of actions){
      const result=a.type==='pass'?pass(state):play(state,a.q,a.r);
      assert.ok(result.ok);
    }
    const action=actions[0];
    state=(action.type==='pass'?pass(state):play(state,action.q,action.r)).state;
  }
  assert.ok(state.ended);
});
test('self-play produces terminal outcome targets for all three seats',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tgo-pv-'));
  try{
    const filename=join(dir,'policy.json');
    writeFileSync(filename,JSON.stringify(model));
    const run=spawnSync(process.execPath,[
      new URL('../scripts/pv-selfplay.mjs',import.meta.url).pathname,
      '--model',filename,'--games','1','--radius','2',
      '--simulations','3','--seed','123'
    ],{encoding:'utf8',timeout:90000});
    assert.equal(run.status,0,run.stderr||run.error?.message);
    const output=JSON.parse(run.stdout.trim());
    assert.equal(output.ended,true);
    assert.ok(output.examples.length>10);
    for(const ex of output.examples){
      assert.equal(ex.board.length,19);
      assert.equal(ex.legal.length,ex.policy.length);
      assert.ok(ex.legal.every(n=>n>=0&&n<=19));
      assert.ok(Math.abs(ex.policy.reduce((a,b)=>a+b,0)-1)<1e-8);
      assert.ok(Math.abs(ex.value.reduce((a,b)=>a+b,0)-1)<1e-8);
    }
  }finally{rmSync(dir,{force:true,recursive:true});}
});
