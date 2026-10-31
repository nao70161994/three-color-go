import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {COLORS,createGame,pointsOnBoard,play} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {createInitialPV2Model} from '../src/pv2-ai.js';
import {
  finalStoneShares,policyLegalActions,directPolicy,
  selectDirectPolicyMove,applyDirectPolicy
} from '../src/direct-policy.js';

const model=createInitialPV2Model(52);
test('stone-share reward tracks all 3 colors and sums to one even without stones',()=>{
  const base=createGame(2);
  const state={...base,ended:true,
    board:{'0,0':COLORS[0],'1,0':COLORS[0],
      '0,1':COLORS[1],'-1,1':COLORS[2]}};
  assert.deepEqual(finalStoneShares(state),[.5,.25,.25]);
  assert.deepEqual(finalStoneShares({...state,board:{}}),[1/3,1/3,1/3]);
  assert.throws(()=>finalStoneShares(base),/finished/);
});
test('one-pass direct selection samples actual legal moves with probability one',()=>{
  const state=createGame(3);
  const x=directPolicy(state,model);
  assert.equal(x.actions.length,pointsOnBoard(3).length);
  assert.ok(x.actions.every(a=>play(state,a.q,a.r).ok));
  assert.ok(Math.abs(x.probabilities.reduce((a,b)=>a+b,0)-1)<1e-9);
  const a=selectDirectPolicyMove(state,model,{random:seededRandom(9)});
  const b=selectDirectPolicyMove(state,model,{random:seededRandom(9)});
  assert.deepEqual(a,b);
  assert.ok(play(state,a.move.q,a.move.r).ok);
  assert.ok(applyDirectPolicy(state,a.move).moveCount===1);
});
test('CPU cap forces pass and prevents endless games, without changing human rules',()=>{
  const state=createGame(3),n=pointsOnBoard(3).length;
  assert.deepEqual(policyLegalActions({...state,moveCount:n*2}),
    [{type:'pass',index:n}]);
  assert.equal(selectDirectPolicyMove({...state,moveCount:n*2},model).move,null);
  assert.deepEqual(policyLegalActions({...state,ended:true}),[]);
});
test('direct self-play updates all three seats with real terminal stone shares',()=>{
  const folder=mkdtempSync(join(tmpdir(),'tgo-direct-'));
  try{
    const path=join(folder,'model.json');
    writeFileSync(path,JSON.stringify(model));
    const result=spawnSync(process.execPath,[
      new URL('../scripts/direct-selfplay.mjs',import.meta.url).pathname,
      '--model',path,'--games','2','--seed','99','--radius','2'
    ],{encoding:'utf8',timeout:90000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    const games=result.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(games.length,2);
    for(const g of games){
      assert.equal(g.ended,true);
      assert.ok(g.seatCounts.every(n=>n>0));
      assert.equal(g.seatCounts.reduce((a,b)=>a+b,0),g.samples.length);
      assert.ok(Math.abs(g.rewards.reduce((a,b)=>a+b,0)-1)<1e-8);
      const total=Object.values(g.scores).reduce((a,b)=>a+b,0);
      for(let i=0;i<3;i++){
        const actual=total?g.scores[COLORS[i]]/total:1/3;
        assert.ok(Math.abs(g.rewards[i]-actual)<1e-8);
      }
      for(const sample of g.samples){
        assert.ok(sample.legal.includes(sample.selected));
        assert.equal(sample.features.length,19);
        for(let i=0;i<3;i++)
          assert.ok(Math.abs(sample.value[i]-g.rewards[(sample.seat+i)%3])<1e-8);
      }
    }
  }finally{rmSync(folder,{recursive:true,force:true});}
});
