import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {COLORS,createGame,play,pointsOnBoard} from '../src/game.js';
import {createInitialPV2Model} from '../src/pv2-ai.js';
import {selectDirectPolicyMove} from '../src/direct-policy.js';

test('frozen architecture produces a legal opening for all supported sizes',()=>{
  const model=createInitialPV2Model(18);
  for(const radius of [2,3,4,5,6,8,12]){
    const state=createGame(radius);
    const result=selectDirectPolicyMove(state,model,{greedy:true});
    assert.equal(result.action.type,'play');
    assert.equal(play(state,result.move.q,result.move.r).ok,true);
    assert.equal(pointsOnBoard(radius).length,1+3*radius*(radius+1));
  }
});
test('size benchmark produces six-seat-rotated, finished matches with metrics',()=>{
  const dir=mkdtempSync(join(tmpdir(),'go-size-'));
  try{
    const model=join(dir,'model.json'),out=join(dir,'report.json');
    writeFileSync(model,JSON.stringify(createInitialPV2Model(7)));
    const run=spawnSync(process.execPath,[
      new URL('../scripts/benchmark-direct-board-size.mjs',import.meta.url).pathname,
      '--model',model,'--radius','2','--games','6','--seed','18000',
      '--opponents','baseline,baseline','--max-seconds','180','--out',out
    ],{encoding:'utf8',timeout:150000});
    assert.equal(run.status,0,run.stderr||run.error?.message);
    const report=JSON.parse(readFileSync(out,'utf8'));
    assert.equal(report.radius,2);
    assert.equal(report.points,19);
    assert.equal(report.status,'complete');
    assert.equal(report.gamesFinished,6);
    assert.equal(report.results.length,6);
    assert.equal(new Set(report.results.map(x=>x.order.join(','))).size,6);
    assert.ok(report.averageGameMs>=0);
    assert.ok(report.meanStoneShare>=0&&report.meanStoneShare<=1);
    assert.ok(report.winShareRate>=0&&report.winShareRate<=1);
    assert.ok(report.results.every(x=>x.turns>0&&x.finished));
  }finally{rmSync(dir,{recursive:true,force:true})}
});
