import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

test('20480 continuation joins exactly 64 checkpoints and validates independent holdouts',()=>{
  const root=mkdtempSync(join(tmpdir(),'direct-20480-'));
  const groups=['hard-balanced','balanced-balanced','tactical-guarded','baseline-baseline'];
  const rates=[['lr001',.001],['lr0003',.0003],['lr0001',.0001],
    ['lr00003',.00003],['lr00001',.00001]];
  try{
    writeFileSync(join(root,'prior.json'),JSON.stringify({
      totalTrainingPerRate:10240,
      rates:rates.map(([key,lr])=>({key,lr,holdout:{games:192},
        points:Array.from({length:32},(_,i)=>({
          games:(i+1)*320,meanStoneShare:.15,winShareRate:.2,
          meanStones:3,hardBalancedShare:.1,baselineShare:.1
        }))}))
    }));
    for(const [key,lr] of rates){
      const folder=join(root,'new',key);
      mkdirSync(folder,{recursive:true});
      const checkpoints=Array.from({length:32},(_,i)=>({
        iteration:1320+i*40,
        gamesTrained:(1320+i*40)*8,
        evaluations:[3,4].flatMap(radius=>groups.map(group=>({
          radius,opponents:group.split('-'),games:12,
          meanStoneShare:lr*10,winShareRate:.1,meanStones:3
        })))
      }));
      writeFileSync(join(folder,'extension-20480-summary.json'),JSON.stringify({
        startIteration:1280,iterations:2560,trainingGames:20480,
        evalGamesPerMatch:12,checkpoints,
        learning:Array.from({length:1280},(_,i)=>({
          radius:[2,3,4][i%3],
          meanCapturedStones:[2,3,4],
          meanTotalSurvivingStones:20,meanTurns:50
        }))
      }));
      for(const radius of [3,4])for(const group of groups)
        writeFileSync(join(folder,'holdout-r'+radius+'-'+group+'.json'),
          JSON.stringify({radius,opponents:group.split('-'),games:24,
            finished:24,truncated:0,
            directMeanStoneShare:lr*10,directWinShareRate:.1}));
    }
    const dest=join(root,'result.json');
    const run=()=>spawnSync(process.execPath,[
      new URL('../scripts/compare-direct-lr-20480.mjs',import.meta.url).pathname,
      '--history',join(root,'prior.json'),
      '--new-root',join(root,'new'),'--out',dest
    ],{encoding:'utf8',timeout:30000});
    let res=run();
    assert.equal(res.status,0,res.stderr||res.error?.message);
    const data=JSON.parse(readFileSync(dest,'utf8'));
    assert.equal(data.totalTrainingPerRate,20480);
    assert.deepEqual(data.rates.map(x=>x.lr),rates.map(x=>x[1]));
    assert.ok(data.rates.every(x=>x.points.length===64));
    assert.equal(data.rates[0].points[32].games,10560);
    assert.equal(data.rates[0].at20480.games,20480);
    assert.equal(data.rates[0].holdout.games,192);
    assert.ok(data.markdown.includes('20,480'));
    const malformed=join(root,'new','lr0003','holdout-r3-hard-balanced.json');
    writeFileSync(malformed,JSON.stringify({radius:3,games:24,finished:0,truncated:24,
      opponents:['hard','balanced'],directMeanStoneShare:.1,directWinShareRate:0}));
    res=run();
    assert.notEqual(res.status,0,'Bad heldout should fail comparison');
  }finally{rmSync(root,{force:true,recursive:true});}
});
