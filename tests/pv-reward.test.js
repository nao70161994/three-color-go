import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,play,pass} from '../src/game.js';
import {terminalPVReward,resolvePVRewardProfile,validatePVRewardProfile} from '../src/pv-reward.js';
import {createInitialPV2Model} from '../src/pv2-ai.js';
import {searchPV} from '../src/pv-ai.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
function terminal(scores){
  const state=createGame(3),board={};
  let n=0;
  for(const [color,count] of Object.entries(scores))
    for(let i=0;i<count;i++)board[`custom-${n++}`]=color;
  return {...state,board,ended:true};
}
test('all modes conserve value and preserve winner order and tie splitting',()=>{
  for(const scores of [
    {black:20,white:10,red:5},{black:9,white:9,red:5},
    {black:10,white:10,red:10},{black:0,white:0,red:0}
  ]){
    const state=terminal(scores);
    for(const profile of ['winner','blend','margin']){
      const reward=terminalPVReward(state,profile);
      near(reward.reduce((x,y)=>x+y,0),1);
      assert.ok(reward.every(x=>x>=0&&x<=1));
    }
  }
});
test('winner only uses actual terminal win/tie shares',()=>{
  assert.deepEqual(terminalPVReward(terminal({black:20,white:10,red:5}),'winner'),[1,0,0]);
  assert.deepEqual(terminalPVReward(terminal({black:10,white:10,red:5}),'winner'),[.5,.5,0]);
  const even=terminalPVReward(terminal({black:10,white:10,red:10}),'winner');
  even.forEach(x=>near(x,1/3));
});
test('blend adds proportional final stone share; margin is translation invariant',()=>{
  const state=terminal({black:20,white:10,red:5});
  const blend=terminalPVReward(state,'blend');
  near(blend[0],.75+.25*20/35);
  near(blend[1],.25*10/35);
  near(blend[2],.25*5/35);
  const a=terminalPVReward(state,'margin');
  const b=terminalPVReward(terminal({black:120,white:110,red:105}),'margin');
  for(let i=0;i<3;i++)near(a[i],b[i]);
  assert.notDeepEqual(a,blend);
});
test('invalid or nonterminal reward requests reject, old model profiles remain compatible',()=>{
  assert.throws(()=>terminalPVReward(createGame(3),'winner'),/terminal/);
  assert.throws(()=>terminalPVReward(terminal({black:1,white:0,red:0}),'undefined'),/Invalid/);
  assert.throws(()=>validatePVRewardProfile('made-up'),/Invalid/);
  assert.equal(resolvePVRewardProfile({architecture:'hex-group-pv-16-v2'}),'blend');
  assert.equal(resolvePVRewardProfile({architecture:'hex-neighbor-pv-16-v1'}),'winner');
});
test('MCTS terminal value uses the exact model reward profile, not winner-only backup',()=>{
  const state=terminal({black:20,white:10,red:5});
  const model=createInitialPV2Model(7);
  for(const profile of ['winner','blend','margin']){
    model.rewardProfile=profile;
    assert.deepEqual(searchPV(state,model,{simulations:3}).value,
      terminalPVReward(state,profile));
  }
});
