import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {comparisonShape} from '../src/architecture-comparison.js';
const kinds=['gnn16','gnn64','attn64'];
function fake(kind,games=2000){
  const layers={};
  for(const [name,[rows,cols]] of Object.entries(comparisonShape(kind))){
    layers[name]={rows,cols,
      weights:Array.from({length:rows*cols},(_,i)=>name.includes('Bias')?0:
        .08*Math.sin(i+rows*3)/Math.sqrt(cols)),
      bias:Array(rows).fill(0)};
  }
  return {architecture:'tgo-comparison-v1',kind,layers,version:'fake-'+kind,
    metadata:{games,features:10,phaseFeature:false,valueOutput:'independent'}};
}
test('cross-architecture tournament uses balanced seats and censored results',()=>{
  const root=mkdtempSync(join(tmpdir(),'tgo-h2h-'));
  try{
    for(const kind of kinds){
      const folder=join(root,'architecture-milestone-250-'+kind);
      mkdirSync(folder);
      writeFileSync(join(folder,'model.json'),JSON.stringify(fake(kind)));
    }
    const output=join(root,'scores','report.json');
    const result=spawnSync(process.execPath,[
      new URL('../scripts/head-to-head-architectures.mjs',import.meta.url).pathname,
      '--models-dir',root,'--games-trained','2000','--radii','2',
      '--rounds','1','--seed','20261104','--horizon-multiplier','1',
      '--out',output
    ],{encoding:'utf8',timeout:90000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    const report=JSON.parse(readFileSync(output,'utf8'));
    assert.equal(report.gamesTrained,2000);
    assert.equal(report.results.length,1);
    assert.equal(report.forcedPasses,false);
    assert.equal(report.passIsLegal,true);
    const {triple,greedyTriple,pairwise}=report.results[0];
    for(const tripleResult of [triple,greedyTriple]){
      assert.equal(tripleResult.games,6);
      assert.equal(tripleResult.finished+tripleResult.truncated,6);
      for(const kind of kinds){
        assert.equal(tripleResult.byKind[kind].seatExposures,6);
        assert.ok(tripleResult.byKind[kind].observedStoneSharePerSeat>=0);
      }
    }
    assert.equal(Object.keys(pairwise).length,3);
    for(const value of Object.values(pairwise)){
      assert.equal(value.games,6);
      assert.equal(value.finished+value.truncated,6);
      for(const s of Object.values(value.byKind)){
        // Two triple-seat compositions, 3 rotations each:
        // (2*3)+(1*3) = 9 seat exposures per kind.
        assert.equal(s.seatExposures,9);
        assert.equal(s.finishedSeatExposures,3*value.finished/2,
          'this equality only holds when equal numbers of finishes for both compositions');
      }
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('model snapshot metadata mismatch fails closed',()=>{
  const root=mkdtempSync(join(tmpdir(),'tgo-h2h-bad-'));
  try{
    for(const kind of kinds){
      const folder=join(root,'architecture-milestone-250-'+kind);
      mkdirSync(folder);
      writeFileSync(join(folder,'model.json'),JSON.stringify(fake(kind,
        kind==='attn64'?4000:2000)));
    }
    const result=spawnSync(process.execPath,[
      new URL('../scripts/head-to-head-architectures.mjs',import.meta.url).pathname,
      '--models-dir',root,'--games-trained','2000','--radii','2',
      '--out',join(root,'invalid.json')
    ],{encoding:'utf8',timeout:30000});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Wrong checkpoint kind\/games/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
