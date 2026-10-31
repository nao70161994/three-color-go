import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInitialPV2Model} from '../src/pv2-ai.js';

test('no-search benchmark accepts hard/balanced/tactical/guarded/baseline in seat rotations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'three-color-lr-'));
  try{
    const file=join(dir,'model.json'),report=join(dir,'match.json');
    writeFileSync(file,JSON.stringify(createInitialPV2Model(11)));
    for(const pair of ['baseline,baseline','tactical,guarded','balanced,balanced','hard,balanced']){
      const run=spawnSync(process.execPath,[
        new URL('../scripts/benchmark-direct-matchups.mjs',import.meta.url).pathname,
        '--model',file,'--radius','2','--games','6',
        '--seed','12345','--opponents',pair,'--out',report
      ],{encoding:'utf8',timeout:90000});
      assert.equal(run.status,0,run.stderr||run.error?.message);
      const result=JSON.parse(readFileSync(report,'utf8'));
      assert.deepEqual(result.opponents,pair.split(','));
      assert.equal(result.finished+result.truncated,6);
      assert.equal(result.samples.length,6);
      assert.deepEqual(result.samples.map(x=>x.order),
        [['direct','op1','op2'],['direct','op2','op1'],
        ['op1','direct','op2'],['op2','direct','op1'],
        ['op1','op2','direct'],['op2','op1','direct']]);
      if(result.finished){
        assert.ok(result.directMeanStoneShare>=0&&result.directMeanStoneShare<=1);
        assert.ok(result.directWinShareRate>=0&&result.directWinShareRate<=1);
        assert.equal(result.vsOp1.ahead+result.vsOp1.behind+result.vsOp1.tied,
          result.finished);
        assert.equal(result.vsOp2.ahead+result.vsOp2.behind+result.vsOp2.tied,
          result.finished);
      }
      assert.equal(result.promotionReady,false);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
