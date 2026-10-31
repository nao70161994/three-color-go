import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,play,pointsOnBoard} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {createInitialPV2Model,encodePV2State,evaluatePV2} from '../src/pv2-ai.js';
import {searchPV,choosePVMove,legalPVActions} from '../src/pv-ai.js';

const model=createInitialPV2Model(99);
test('PV2 uses whole board, current seat relative colors, and exact group observations',()=>{
  let state=createGame(3);
  const original=JSON.stringify(state);
  const empty=encodePV2State(state);
  assert.equal(empty.features.length,37);
  assert.ok(empty.features.every(row=>row.length===11&&row[3]===1));
  const placed=play(state,0,0);
  assert.equal(placed.ok,true);
  const after=encodePV2State(placed.state);
  const center=pointsOnBoard(3).findIndex(p=>p.q===0&&p.r===0);
  assert.equal(after.features[center][2],1,'black is the second rival from white turn');
  assert.equal(after.features[center][7],1,'black group liberties normalized to six');
  assert.ok(after.features[center][10]>0,'non-empty group size');
  assert.equal(JSON.stringify(state),original);
});
test('PV2 outputs finite logits and 3-player winning shares for all colors',()=>{
  for(const radius of [2,3,4,12]){
    const state=createGame(radius);
    const score=evaluatePV2(state,model);
    assert.equal(score.logits.length,pointsOnBoard(radius).length+1);
    assert.ok(score.logits.every(Number.isFinite));
    assert.ok(score.value.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.ok(Math.abs(score.value.reduce((a,b)=>a+b,0)-1)<1e-8);
  }
});
test('PV2 MaxN search visits sum to budget and the chosen move is legal/reproducible',()=>{
  const state=createGame(3);
  const a=searchPV(state,model,{simulations:6,random:seededRandom(17)});
  const b=searchPV(state,model,{simulations:6,random:seededRandom(17)});
  assert.deepEqual(a,b);
  assert.equal(a.options.reduce((sum,x)=>sum+x.visits,0),6);
  assert.ok(a.move&&play(state,a.move.q,a.move.r).ok);
  assert.deepEqual(choosePVMove(state,model,6,seededRandom(17)),a.move);
});

test('seeded root noise diversifies self-play but remains reproducible and normalized',()=>{
  const state=createGame(3);
  const first=searchPV(state,model,{simulations:8,rootNoise:.25,random:seededRandom(2718)});
  const again=searchPV(state,model,{simulations:8,rootNoise:.25,random:seededRandom(2718)});
  const other=searchPV(state,model,{simulations:8,rootNoise:.25,random:seededRandom(3141)});
  assert.deepEqual(first,again);
  assert.equal(first.options.reduce((a,b)=>a+b.visits,0),8);
  assert.ok(Math.abs(first.options.reduce((a,b)=>a+b.prior,0)-1)<1e-8);
  assert.notDeepEqual(first.options.map(x=>x.prior),other.options.map(x=>x.prior));
  assert.throws(()=>searchPV(state,model,{rootNoise:1.1}),/Invalid search budget/);
});

test('stone-count MCTS never passes early when safe placements remain',()=>{
  const state=createGame(3),cells=pointsOnBoard(3).length;
  const advanced={...state,moveCount:Math.floor(cells*.7)};
  const actions=legalPVActions(advanced);
  assert.ok(actions.some(x=>x.type==='play'));
  assert.ok(actions.every(x=>x.type!=='pass'));
  const capped={...state,moveCount:cells*2};
  assert.deepEqual(legalPVActions(capped),[{type:'pass',index:cells}]);
});
