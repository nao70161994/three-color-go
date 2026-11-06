import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,play,pass,pointsOnBoard} from '../src/game.js';
import {evaluateComparison,selectComparisonMove} from '../src/architecture-comparison.js';
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

test('Attention stays numerically finite and chooses legal moves beyond radius 5',()=>{
  const model=getEliteModel('elite-attn64-50000');
  // On radius >=6, some pairs of cells are >10 apart. Before the fix,
  // bias[head*11+distance] became undefined, poisoning attention with NaNs.
  for(const radius of [5,6,8,12]){
    const state=createGame(radius),length=pointsOnBoard(radius).length+1;
    const evaluated=evaluateComparison(state,model);
    assert.equal(evaluated.logits.length,length);
    assert.ok(evaluated.logits.every(Number.isFinite),
      'non-finite attention logits on board radius '+radius);
    assert.ok(evaluated.value.every(Number.isFinite));
    const chosen=selectComparisonMove(state,model,{greedy:true});
    assert.equal(chosen.probabilities.length,chosen.actions.length);
    assert.ok(chosen.probabilities.every(p=>Number.isFinite(p)&&p>=0&&p<=1));
    assert.ok(Math.abs(chosen.probabilities.reduce((a,b)=>a+b,0)-1)<1e-8);
    assert.ok(chosen.action);
    const result=chosen.move?play(state,chosen.move.q,chosen.move.r):pass(state);
    assert.ok(result.ok,'invalid attention move at radius '+radius);
  }
});
