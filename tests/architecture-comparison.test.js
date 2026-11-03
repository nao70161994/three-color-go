import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createGame,play} from '../src/game.js';
import {comparisonShape,COMPARISON_ARCHS,validateComparisonModel,
  evaluateComparison,selectComparisonMove} from '../src/architecture-comparison.js';

function mock(kind){
  const layers={};
  for(const [name,[rows,cols]] of Object.entries(comparisonShape(kind)))
    layers[name]={rows,cols,weights:Array.from({length:rows*cols},(_,i)=>
      name.includes('Bias')?0:Math.sin(i*17+cols)/Math.sqrt(cols)*0.12),
      bias:Array(rows).fill(0)};
  return {architecture:'tgo-comparison-v1',kind,layers,version:'mock-'+kind,
    metadata:{features:10,phaseFeature:false,valueOutput:'independent',games:0}};
}
test('all three comparison architectures have correctly shaped outputs',()=>{
  assert.deepEqual(Object.keys(COMPARISON_ARCHS),['gnn16','gnn64','attn64']);
  for(const kind of Object.keys(COMPARISON_ARCHS)){
    const model=validateComparisonModel(mock(kind));
    assert.equal(model.layers.embed.cols,10);
    assert.equal(model.layers.embed.rows,COMPARISON_ARCHS[kind].width);
    for(const radius of [2,3,4]){
      const state=createGame(radius);
      const prediction=evaluateComparison(state,model);
      const n=3*radius*(radius+1)+1;
      assert.equal(prediction.logits.length,n+1);
      assert.equal(prediction.value.length,3);
      assert.ok(prediction.logits.every(Number.isFinite));
      assert.ok(prediction.value.every(Number.isFinite));
      const chosen=selectComparisonMove(state,model,{greedy:true});
      assert.equal(chosen.actions.length,n+1);
      assert.equal(chosen.actions.at(-1).type,'pass');
      assert.ok(chosen.move===null||play(state,chosen.move.q,chosen.move.r).ok);
      const other={...state,moveCount:9000};
      assert.deepEqual(evaluateComparison(state,model),
        evaluateComparison(other,model),'no phase feature in new architectures');
    }
  }
});
test('attention parameters are validated and expected model kinds stay separate',()=>{
  const model=mock('attn64');
  assert.equal(model.layers.attn1Q.rows,64);
  assert.equal(model.layers.attn2Bias.rows,4);
  assert.equal(model.layers.attn2Bias.cols,11);
  assert.throws(()=>validateComparisonModel({...model,kind:'fake'}),/Unknown/);
  const broken=mock('attn64');
  broken.layers.attn1V.weights.pop();
  assert.throws(()=>validateComparisonModel(broken),/Invalid comparison layer attn1V/);
});
test('sampled comparison games never synthesize forced passes on timeout',()=>{
  const dir=mkdtempSync(join(tmpdir(),'architecture-'));
  try{
    for(const kind of ['gnn16','gnn64','attn64']){
      const file=join(dir,kind+'.json');
      writeFileSync(file,JSON.stringify(mock(kind)));
      const result=spawnSync(process.execPath,[
        new URL('../scripts/architecture-selfplay.mjs',import.meta.url).pathname,
        '--model',file,'--games','1','--radius','2','--seed','105',
        '--temperature','1.5','--horizon-multiplier','1',
        '--timeout-penalty','0.3','--sample-stride','2'
      ],{encoding:'utf8',timeout:60000});
      assert.equal(result.status,0,result.stderr||result.error?.message);
      const game=JSON.parse(result.stdout);
      assert.equal(game.ended,!game.truncated);
      assert.ok(game.samples.length<=game.turns&&game.samples.length>0);
      assert.ok(game.samples.every(x=>x.features.every(row=>row.length===10)));
      assert.ok(game.samples.every(x=>x.legal.includes(19)));
      assert.ok(Math.abs(game.rewards.reduce((a,b)=>a+b,0)-
        (game.truncated?0.1:1))<1e-8);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
