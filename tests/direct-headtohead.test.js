import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createInitialPV2Model} from '../src/pv2-ai.js';

test('head-to-head rotates all six positions and is exactly symmetric for identical model weights',()=>{
  const folder=mkdtempSync(join(tmpdir(),'tgo-head2head-'));
  try{
    const model=join(folder,'model.json');
    writeFileSync(model,JSON.stringify(createInitialPV2Model(23)));
    const run=(extra=[])=>spawnSync(process.execPath,[
      new URL('../scripts/benchmark-direct-headtohead.mjs',import.meta.url).pathname,
      '--model-a',model,'--model-b',model,'--radius','2',
      '--games','12','--seed','123123','--opponent','baseline',...extra
    ],{encoding:'utf8',timeout:120000});
    const r=run();
    assert.equal(r.status,0,r.stderr||r.error?.message);
    const data=JSON.parse(r.stdout);
    assert.equal(data.games,12);
    assert.equal(data.results.length,12);
    assert.equal(new Set(data.results.slice(0,6).map(x=>x.order.join(','))).size,6);
    assert.ok(data.results.every(x=>x.winnerKeys.length>0));
    assert.equal(data.wins.a,data.wins.b);
    assert.equal(data.meanStoneShare.a,data.meanStoneShare.b);
    assert.equal(data.winShareRate.a,data.winShareRate.b);
    assert.ok(Math.abs(Object.values(data.meanStoneShare).reduce((a,b)=>a+b,0)-1)<1e-5);
    assert.equal(data.rotationsPerBlock,6);
    const invalid=run(['--games','13']);
    assert.notEqual(invalid.status,0);
  }finally{
    rmSync(folder,{recursive:true,force:true});
  }
});
