import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const executable=new URL('../scripts/compare-mixed-checkpoints.mjs',import.meta.url).pathname;
const ids=['baseline','balanced','tactical'];
function testDir(){const root=mkdtempSync(join(tmpdir(),'threecolor-mixed-'));
  mkdirSync(join(root,'models'));
  writeFileSync(join(root,'models','manifest.json'),JSON.stringify({
    version:1,entries:ids.map(id=>({id,type:'cpu',version:'current-rule-cpu',architecture:'rules'}))
  }));
  return root;
}
test('cross-era scheduler checks each candidate pair with six equal seat rotations',()=>{
 const root=testDir();
 try{
  const report=join(root,'output','report.json');
  const result=spawnSync(process.execPath,[executable,
    '--manifest',join(root,'models','manifest.json'),
    '--models-dir',join(root,'models'), '--out',report,
    '--chunks','1','--chunk','0','--radii','2','--rounds','1',
    '--seed','20261105','--horizon-multiplier','10',
  ],{encoding:'utf8',timeout:90000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  const data=JSON.parse(readFileSync(report,'utf8'));
  assert.equal(data.version,1);
  assert.equal(data.candidateCount,3);
  assert.equal(data.pairCount,3);
  for(const pair of data.pairs){
    assert.equal(pair.games,6);
    assert.ok(pair.finished+pair.truncated===6);
    assert.equal(pair.aOutranksB+pair.bOutranksA+pair.ties,pair.finished);
    assert.notEqual(pair.bridge,pair.a);
    assert.notEqual(pair.bridge,pair.b);
    assert.equal(pair.radii['2'].games,6);
  }
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('cross-era playoff schedules only user-selected pairs without silently adding others',()=>{
 const root=testDir();
 try{
  const selection=join(root,'finalists.json');
  writeFileSync(selection,JSON.stringify({pairs:[['baseline','tactical']]}));
  const report=join(root,'out.json');
  const result=spawnSync(process.execPath,[executable,
    '--manifest',join(root,'models','manifest.json'),
    '--models-dir',join(root,'models'),'--out',report,
    '--pairs-file',selection,'--radii','2','--rounds','1',
    '--horizon-multiplier','5'
  ],{encoding:'utf8',timeout:90000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  const data=JSON.parse(readFileSync(report,'utf8'));
  assert.equal(data.pairs.length,1);
  assert.equal(data.pairs[0].bridge,'balanced');
  assert.equal(data.pairs[0].games,6);
  const bad=spawnSync(process.execPath,[executable,
    '--manifest',join(root,'models','manifest.json'),
    '--models-dir',join(root,'models'),'--out',report,
    '--pairs-file',selection,'--radii','2','--chunks','0',
  ],{encoding:'utf8',timeout:30000});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/Invalid tournament settings/);
 }finally{rmSync(root,{recursive:true,force:true})}
});
