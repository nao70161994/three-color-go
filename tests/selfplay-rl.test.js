import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGame,play} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {NEURAL_MODEL} from '../src/neural-weights.js';
import {neuralCandidates,chooseNeuralMove,neuralMoveFeatures,neuralScore} from '../src/neural-ai.js';

function withModel(run){
  const folder=mkdtempSync(join(tmpdir(),'tgo-rl-test-'));
  const file=join(folder,'policy.json');
  try {
    writeFileSync(file,JSON.stringify(NEURAL_MODEL));
    return run(file);
  } finally {rmSync(folder,{recursive:true,force:true});}
}
function nodeScript(name,args){
  const result=spawnSync(process.execPath,[new URL('../scripts/'+name,import.meta.url).pathname,...args],
    {encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  return result.stdout;
}
test('self-play and browser inference see the same legal candidate features',()=>{
  const state=createGame(3),options=neuralCandidates(state,seededRandom(1));
  assert.ok(options.length>0);
  for(const option of options){
    const result=play(state,option.q,option.r);
    assert.equal(result.ok,true);
    assert.deepEqual(neuralMoveFeatures(state,option.q,option.r,result),option.features);
    assert.ok(Number.isFinite(neuralScore(option.features)));
  }
  const chosen=chooseNeuralMove(state,seededRandom(1),null,NEURAL_MODEL);
  assert.ok(options.some(({q,r})=>q===chosen.q&&r===chosen.r));
});
test('teacher-free self-play uses outcome-only rewards and complete real-rule games',()=>withModel(file=>{
  const lines=nodeScript('selfplay-trajectories.mjs',[
    '--model',file,'--games','2','--radius','2','--seed','123']);
  const games=lines.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(games.length,2);
  for(const game of games){
    assert.equal(game.ended,true);
    assert.equal(game.kind,'policy-gradient-selfplay');
    assert.ok(Math.abs(game.reward.reduce((a,b)=>a+b,0))<1e-8);
    assert.ok(game.samples.length>5);
    for(const sample of game.samples){
      assert.ok(sample.seat>=0&&sample.seat<=2);
      assert.ok(sample.choice>=0&&sample.choice<sample.candidates.length);
      assert.ok(sample.candidates.every(x=>x.length===12&&x.every(Number.isFinite)));
      assert.equal(sample.reward,game.reward[sample.seat]);
    }
  }
}));
test('seat-rotated benchmark reports actual hard CPU comparisons',()=>withModel(file=>{
  const output=nodeScript('benchmark-neural.mjs',[
    '--model',file,'--games','6','--radius','2','--seed','123']);
  const report=JSON.parse(output);
  assert.equal(report.finished+report.truncated,6);
  assert.equal(report.neuralAhead+report.hardAhead+report.tied,report.finished);
  assert.equal(report.perSeat.reduce((n,s)=>n+s.games,0),report.finished);
  assert.equal(report.promotionReady,false);
  assert.ok(report.stats.neural.winShareRate>=0);
}));
