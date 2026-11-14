import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame,play,pass,insideBoard,pointsOnBoard} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {selectCpuMove} from '../src/cpu-engine.js';
import {boardEdgeFactor,boardCenterDistance,center,boardExtent} from '../src/board-layout.js';
import {CPU_LEVELS,isCpuLevelSupported,compatibleCpuLevel,compatibleSeats,
  defaultCpuLevelForBoard} from '../src/cpu-catalog.js';

test('CPU compatibility is explicit and disallows computationally prohibitive attention',()=>{
  for(const radius of [2,4,8,12,-9,-13,-19]){
    for(const level of CPU_LEVELS){
      const yes=isCpuLevelSupported(level,radius);
      assert.equal(typeof yes,'boolean');
      if(yes)assert.equal(compatibleCpuLevel(level,radius),level);
      else assert.equal(compatibleCpuLevel(level,radius),defaultCpuLevelForBoard(radius));
    }
  }
  for(const n of [9,13,19]){
    for(const level of ['neural','trained-lr001-final','elite-gnn64-50000','elite-pv2-122400'])
      assert.equal(isCpuLevelSupported(level,-n),false);
    for(const level of ['square-trained-v1','square-gnn16-32','square-gnn64-32'])
      assert.equal(isCpuLevelSupported(level,-n),true);
  }
  assert.equal(isCpuLevelSupported('square-attn64-32',-19),false);
  assert.equal(isCpuLevelSupported('square-attn64-32',-13),true);
  assert.equal(isCpuLevelSupported('elite-attn64-50000',8),false);
  assert.equal(isCpuLevelSupported('elite-attn64-50000',4),true);
  assert.deepEqual(compatibleSeats(['human','elite-gnn64-50000','easy'],-9),
    ['human','square-trained-v1','easy']);
});
test('CPU dispatcher cannot run models on unsupported geometry',()=>{
  assert.throws(()=>selectCpuMove(createGame(-9),'elite-gnn64-50000'),/六角盤/);
  assert.throws(()=>selectCpuMove(createGame(4),'square-gnn16-32'),/四角盤/);
  assert.throws(()=>selectCpuMove(createGame(-19),'square-attn64-32'),/負荷|Attention/);
  assert.throws(()=>selectCpuMove(createGame(8),'elite-attn64-50000'),/負荷|Attention/);
});
test('Shared CPU dispatch produces legal moves on square and hex boards',()=>{
  for(const radius of [-9,-13,-19,4]){
    const state=createGame(radius);
    const levels=radius<0?['easy','normal','hard','square-trained-v1','square-gnn16-32']:['easy','normal','hard','neural','elite-gnn64-50000'];
    for(const level of levels){
      const {move,decision}=selectCpuMove(state,level,seededRandom(27));
      const result=move?play(state,move.q,move.r):pass(state);
      assert.equal(result.ok,true,level+' radius '+radius);
      if(!['easy','normal'].includes(level)){
        assert.equal(decision.level,level);
        assert.ok(Array.isArray(decision.candidates));
      }else assert.equal(decision,null);
    }
  }
});
test('Square deep CPU supports deterministic seeded rollouts',()=>{
  const run=()=>{
    const rng=seededRandom(20261114);
    let state=createGame(-9);
    const actions=[];
    for(let i=0;i<8;i++){
      const {move}=selectCpuMove(state,'square-gnn16-32',rng);
      const res=move?play(state,move.q,move.r):pass(state);
      assert.equal(res.ok,true);
      actions.push(move);
      state=res.state;
    }
    return actions;
  };
  assert.deepEqual(run(),run());
});
test('Square and hex drawing geometry remain centered and bounded',()=>{
  for(const size of [9,13,19]){
    const pts=pointsOnBoard(-size);
    assert.equal(pts.length,size*size);
    assert.deepEqual(center((size-1)/2,(size-1)/2,-size),[0,0]);
    assert.equal(boardEdgeFactor((size-1)/2,(size-1)/2,-size),0);
    assert.equal(boardEdgeFactor(0,0,-size),1);
    assert.equal(boardCenterDistance((size-1)/2,(size-1)/2,-size),0);
    const ext=boardExtent(-size);
    for(const {q,r} of pts){
      const [x,y]=center(q,r,-size);
      assert.ok(Math.abs(x)<ext.x&&Math.abs(y)<ext.y);
      assert.equal(insideBoard(q,r,-size),true);
    }
  }
  assert.deepEqual(center(0,0,4),[0,0]);
  assert.equal(boardEdgeFactor(4,0,4),1);
  assert.equal(boardEdgeFactor(0,0,4),0);
});
test('Browser, Worker, offline and PWA share catalog/dispatcher/assets',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(read('src/main.js'),/selectCpuMove/);
  assert.match(read('src/main.js'),/recoverCpu/);
  assert.match(read('src/ai-worker.js'),/selectCpuMove/);
  assert.match(read('scripts/build-standalone.mjs'),/cpuCatalog/);
  assert.match(read('scripts/build-standalone.mjs'),/cpuEngine/);
  for(const path of ['board-layout.js','cpu-catalog.js','cpu-engine.js'])
    assert.ok(read('sw.js').includes('./src/'+path));
});
