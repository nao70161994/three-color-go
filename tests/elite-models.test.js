import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,play,pass} from '../src/game.js';
import {ELITE_LEVELS,ELITE_LABELS,getEliteModel,eliteModelsInfo,chooseEliteMove} from '../src/elite-models.js';

test('three original frozen finalists are present and have correct training identity',()=>{
  assert.deepEqual(ELITE_LEVELS,[
    'elite-attn64-50000','elite-gnn64-50000','elite-pv2-122400'
  ]);
  const info=eliteModelsInfo();
  assert.deepEqual(info.map(i=>i.games),[50000,50000,122400]);
  assert.equal(getEliteModel(ELITE_LEVELS[0]).kind,'attn64');
  assert.equal(getEliteModel(ELITE_LEVELS[1]).kind,'gnn64');
  assert.equal(getEliteModel(ELITE_LEVELS[2]).architecture,'hex-group-pv-16-v2');
  const provenance=JSON.parse(readFileSync('src/elite-model-provenance.json','utf8'));
  for(const id of ELITE_LEVELS){
    assert.ok(ELITE_LABELS[id]);
    assert.ok(info.find(m=>m.id===id)?.headToHeadCandidate);
    assert.match(provenance.models[id].sha256,/^[a-f0-9]{64}$/);
  }
  assert.throws(()=>getEliteModel('wrong'),/Unknown/);
});
test('elite models use learned legal policy, including each seat and pass',()=>{
  for(const id of ELITE_LEVELS){
    for(const radius of [2,3,4]){
      let state=createGame(radius);
      for(let moveNo=0;moveNo<8&&!state.ended;moveNo++){
        const history=JSON.stringify(state),inspection=[];
        const decision=chooseEliteMove(state,id,inspection);
        const outcome=decision?play(state,decision.q,decision.r):pass(state);
        assert.ok(outcome.ok,id+' produced an illegal move');
        assert.ok(inspection.length>0&&inspection.length<=5);
        assert.ok(inspection.every(x=>Number.isFinite(x.score)&&x.score>=0&&x.score<=1));
        assert.deepEqual(chooseEliteMove(state,id),decision,'deterministic greedy policy');
        assert.equal(JSON.stringify(state),history,'selection must not mutate position');
        state=outcome.state;
      }
      state.ended=true;
      assert.equal(chooseEliteMove(state,id),null);
    }
  }
  const source=readFileSync('src/elite-models.js','utf8');
  assert.doesNotMatch(source,/isOwnEye|safeCpuMoves|isUnsafeCpuMove|MCTS/);
});
test('mixed elite autonomous match completes legal turns without model substitution',()=>{
  let state=createGame(2);
  let count=0;
  while(!state.ended&&count<150){
    const model=ELITE_LEVELS[state.turn];
    const move=chooseEliteMove(state,model);
    const next=move?play(state,move.q,move.r):pass(state);
    assert.ok(next.ok);
    state=next.state;count++;
  }
  assert.ok(count>0);
  assert.equal(state.ended,true,'3-policy game should end via genuine passes');
});
