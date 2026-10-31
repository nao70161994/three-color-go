import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

test('Learning curve reporter accepts exact continuation windows (321..324)',()=>{
  const folder=mkdtempSync(join(tmpdir(),'direct-resumed-report-'));
  try{
    const rows=Array.from({length:4},(_,i)=>({
      iteration:321+i,radius:[2,3,4][i%3],trainingGamesTotal:(321+i)*8,
      meanSurvivingStones:[2,2,2],meanCapturedStones:[1,1,1],
      meanCapturedLosses:[1,1,1],
      meanFinalStoneShares:[.333333,.333333,.333334],
      meanTotalSurvivingStones:6,meanTurns:20
    }));
    const log=join(folder,'train.jsonl');writeFileSync(log,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
    const prefix=join(folder,'eval');
    for(const iteration of [322,324])for(const radius of [3,4])
      for(const group of ['baseline-baseline','hard-balanced']){
        writeFileSync(prefix+'-iter'+iteration.toString().padStart(4,'0')+
          '-r'+radius+'-'+group+'.json',
        JSON.stringify({games:6,finished:6,truncated:0,radius,
          opponents:group.split('-'),directWinShareRate:0,
          directMeanStones:3,directMeanStoneShare:.1,
          vsOp1:{meanStoneMargin:-1},vsOp2:{meanStoneMargin:-2}}));
      }
    const out=join(folder,'report.json');
    const proc=spawnSync(process.execPath,[
      new URL('../scripts/report-direct-learning-curves.mjs',import.meta.url).pathname,
      '--training-log',log,'--eval-prefix',prefix,'--out',out,
      '--iterations','324','--start-iteration','320','--checkpoint-every','2'
    ],{encoding:'utf8',timeout:30000});
    assert.equal(proc.status,0,proc.stderr||proc.error?.message);
    const r=JSON.parse(readFileSync(out,'utf8'));
    assert.equal(r.startIteration,320);
    assert.deepEqual(r.checkpoints.map(c=>c.gamesTrained),[2576,2592]);
    assert.equal(r.learning.length,4);
    assert.equal(r.trainingGames,2592);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
