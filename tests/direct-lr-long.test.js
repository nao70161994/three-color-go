import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

test('Five-rate long comparison enforces 8 complete checkpoints and records real stone shares',()=>{
  const dir=mkdtempSync(join(tmpdir(),'three-color-long-lr-'));
  const keys=['lr001','lr0003','lr0001','lr00003','lr00001'];
  try{
    for(let j=0;j<keys.length;j++){
      const folder=join(dir,'reports',keys[j]);mkdirSync(folder,{recursive:true});
      const checkpoints=Array.from({length:8},(_,k)=>({
        gamesTrained:(k+1)*320,iteration:(k+1)*40,
        evaluations:[3,4].flatMap(radius=>[
          ['hard','balanced'],['balanced','balanced'],
          ['tactical','guarded'],['baseline','baseline']
        ].map((opponents,i)=>({
          radius,opponents,winShareRate:0,
          meanStoneShare:(j+k+i+1)/100,
          meanStones:j+k+i+1, games:12
        })))
      }));
      const learning=Array.from({length:320},(_,i)=>({
        meanCapturedStones:[i%3,1,2],
        meanTotalSurvivingStones:20+i/100,
        valueMse:.02,policyKlOldToNew:.00001
      }));
      writeFileSync(join(folder,'learning-curve-summary.json'),
        JSON.stringify({trainingGames:2560,evalGamesPerMatch:12,checkpoints,learning}));
    }
    const output=join(dir,'comparison.json');
    const p=spawnSync(process.execPath,[
      new URL('../scripts/compare-direct-lr-long.mjs',import.meta.url).pathname,
      '--root',dir,'--out',output
    ],{encoding:'utf8',timeout:30000});
    assert.equal(p.status,0,p.stderr||p.error?.message);
    const x=JSON.parse(readFileSync(output,'utf8'));
    assert.deepEqual(x.records.map(r=>r.rate),[.001,.0003,.0001,.00003,.00001]);
    assert.equal(x.records[0].checkpoints.length,8);
    assert.equal(x.records[4].checkpoints.at(-1).games,2560);
    assert.ok(x.markdown.includes('2560'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
