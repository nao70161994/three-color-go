import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGame} from '../src/game.js';
import {validateComparisonModel,selectComparisonMove} from '../src/architecture-comparison.js';

test('512-game square experiment checkpoints have genuine, hashed reproducible provenance',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../experiments/square-512/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.sourceRun,42364679877);
  assert.deepEqual(Object.keys(manifest.architectures).sort(),['attn64','gnn16','gnn64']);
  for(const kind of ['gnn16','gnn64','attn64']){
    const raw=readFileSync(new URL('../experiments/square-512/'+kind+'.json',import.meta.url),'utf8');
    const checksum=createHash('sha256').update(raw).digest('hex');
    const archived=manifest.architectures[kind];
    assert.equal(checksum,archived.sha256);
    const model=validateComparisonModel(JSON.parse(raw));
    assert.equal(model.kind,kind);
    assert.equal(model.metadata.games,512);
    assert.equal(model.metadata.iterations,64);
    assert.equal(model.metadata.boardShape,'square');
    assert.deepEqual(model.metadata.radii,[-9,-9,-9,-13]);
    assert.equal(archived.evaluationGames,12);
    assert.equal(archived.evaluationWinShare,0);
    const decision=selectComparisonMove(createGame(-9),model,{greedy:true});
    assert.equal(decision.probabilities.length,82);
    assert.ok(decision.probabilities.every(Number.isFinite));
  }
});
