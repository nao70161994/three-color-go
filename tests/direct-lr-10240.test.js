import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const rates=[['lr001',.001],['lr0003',.0003],['lr0001',.0001],
  ['lr00003',.00003],['lr00001',.00001]];
const groups=['hard-balanced','balanced-balanced','tactical-guarded',
  'baseline-baseline'];

test('Five-rate 10240 comparison checks 32 cumulative checkpoints and fresh holdouts',()=>{
  const folder=mkdtempSync(join(tmpdir(),'direct-10240-'));
  try{
    const old=rates.map(([key,lr],j)=>({
      key,lr,holdout:{games:192,meanStoneShare:.1},
      points:Array.from({length:16},(_,i)=>({
        games:(i+1)*320,
        meanStoneShare:(i+j+1)/100,
        hardBalancedShare:.1,baselineShare:.1,winShareRate:0,meanStones:3
      }))
    }));
    writeFileSync(join(folder,'old.json'),JSON.stringify({
      totalTrainingPerRate:5120,all:old}));
    for(const [key,rate] of rates){
      const root=join(folder,'new',key);
      mkdirSync(root,{recursive:true});
      const checkpoints=Array.from({length:16},(_,i)=>({
        iteration:680+i*40,
        gamesTrained:(680+i*40)*8,
        evaluations:[3,4].flatMap(radius=>groups.map(group=>({
          radius,opponents:group.split('-'),games:12,
          meanStoneShare:rate*10,winShareRate:.25,meanStones:5
        })))
      }));
      writeFileSync(join(root,'extension-10240-summary.json'),JSON.stringify({
        startIteration:640,iterations:1280,trainingGames:10240,
        evalGamesPerMatch:12,checkpoints,
        learning:Array.from({length:640},()=>({
          meanCapturedStones:[3,4,5],meanTotalSurvivingStones:30
        }))
      }));
      for(const radius of [3,4])for(const group of groups)
        writeFileSync(join(root,'holdout-r'+radius+'-'+group+'.json'),
          JSON.stringify({radius,opponents:group.split('-'),
            games:24,finished:24,truncated:0,
            directMeanStoneShare:rate*10,directWinShareRate:.2}));
    }
    const out=join(folder,'report.json');
    const run=()=>spawnSync(process.execPath,[
      new URL('../scripts/compare-direct-lr-10240.mjs',import.meta.url).pathname,
      '--history',join(folder,'old.json'),'--new-root',join(folder,'new'),
      '--out',out],{encoding:'utf8',timeout:30000});
    let proc=run();
    assert.equal(proc.status,0,proc.stderr||proc.error?.message);
    const report=JSON.parse(readFileSync(out,'utf8'));
    assert.equal(report.rates.length,5);
    assert.deepEqual(report.rates.map(r=>r.lr),[.001,.0003,.0001,.00003,.00001]);
    assert.ok(report.rates.every(r=>r.points.length===32));
    assert.equal(report.rates[0].points.at(-1).games,10240);
    assert.equal(report.rates[0].points[16].games,5440);
    assert.equal(report.rates[0].holdout.games,192);
    assert.ok(report.markdown.includes('10,240'));
    rmSync(join(folder,'new','lr0003','holdout-r3-hard-balanced.json'));
    proc=run();
    assert.notEqual(proc.status,0,'Missing independent holdout must fail comparison');
  }finally{rmSync(folder,{recursive:true,force:true});}
});
