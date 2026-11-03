import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createGame} from '../src/game.js';
import {createInitialPV2Model,evaluatePV2} from '../src/pv2-ai.js';
import {stoneShareTimeoutReward} from '../src/direct-policy.js';

test('natural stone shares and signed timeout rewards are distinct',()=>{
  const state={...createGame(2),board:{
    '0,0':'black','1,0':'black','-1,0':'white'}};
  const timeout=stoneShareTimeoutReward(state,0.3);
  assert.equal(timeout.truncated,true);
  assert.ok(Math.abs(timeout.stoneShares[0]-2/3)<1e-9);
  assert.ok(Math.abs(timeout.rewards[0]-(2/3-0.3))<1e-9);
  assert.ok(Math.abs(timeout.rewards[1]-(1/3-0.3))<1e-9);
  assert.ok(Math.abs(timeout.rewards[2]+0.3)<1e-9);
  assert.ok(Math.abs(timeout.rewards.reduce((a,b)=>a+b,0)-0.1)<1e-9);
  const finished=stoneShareTimeoutReward({...state,ended:true},0.3);
  assert.equal(finished.truncated,false);
  assert.deepEqual(finished.rewards,finished.stoneShares);
  assert.deepEqual(stoneShareTimeoutReward({...createGame(2),ended:true}).rewards,
    [1/3,1/3,1/3]);
  assert.throws(()=>stoneShareTimeoutReward(state,-0.01),/penalty/);
  assert.throws(()=>stoneShareTimeoutReward(state,NaN),/penalty/);
});

test('independent-return models retain negative values without softmax or sum=1',()=>{
  const state=createGame(2),m=createInitialPV2Model(20261103);
  m.layers.value.weights.fill(0);
  m.layers.value.bias=[0.8,-0.4,0.1];
  const legacy=evaluatePV2(state,m).value;
  assert.ok(Math.abs(legacy.reduce((a,b)=>a+b,0)-1)<1e-9);
  m.metadata={valueOutput:'independent',rewardProfile:'stone-share-minus-timeout'};
  assert.deepEqual(evaluatePV2(state,m).value,[0.8,-0.4,0.1]);
  assert.deepEqual(evaluatePV2({...state,turn:1},m).value,[0.1,0.8,-0.4]);
});

test('reward self-play samples voluntary actions without ever forcing end passes',()=>{
  const directory=mkdtempSync(join(tmpdir(),'tgo-reward-'));
  try{
    const model=createInitialPV2Model(20261104);
    model.metadata={valueOutput:'independent',rewardProfile:'stone-share-minus-timeout'};
    const path=join(directory,'model.json');
    writeFileSync(path,JSON.stringify(model));
    const command=[
      new URL('../scripts/direct-reward-selfplay.mjs',import.meta.url).pathname,
      '--model',path,'--games','3','--radius','2','--seed','90821',
      '--timeout-penalty','0.3','--horizon-multiplier','1'
    ];
    const result=spawnSync(process.execPath,command,{encoding:'utf8',timeout:90000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    const games=result.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(games.length,3);
    for(const g of games){
      assert.equal(g.kind,'three-player-direct-reward-selfplay');
      assert.notEqual(g.ended,g.truncated);
      assert.ok(g.turns<=g.horizon);
      assert.equal(g.horizon,22);
      if(g.truncated)assert.equal(g.turns,g.horizon);
      assert.equal(g.samples.length,g.turns,'no hidden forced moves after samples');
      assert.equal(g.seatCounts.reduce((a,b)=>a+b,0),g.turns);
      assert.ok(g.seatCounts.every(x=>x>0));
      const expectedSum=1-(g.truncated?0.9:0);
      assert.ok(Math.abs(g.rewards.reduce((a,b)=>a+b,0)-expectedSum)<1e-8);
      for(let i=0;i<3;i++)
        assert.ok(Math.abs(g.rewards[i]-(g.stoneShares[i]-
          (g.truncated?0.3:0)))<1e-8);
      for(const s of g.samples){
        assert.ok(s.legal.includes(s.selected));
        assert.ok(s.legal.includes(19));
        assert.equal(s.features.length,19);
        for(let i=0;i<3;i++)
          assert.ok(Math.abs(s.value[i]-g.rewards[(s.seat+i)%3])<1e-8);
      }
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});
