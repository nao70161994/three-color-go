import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,play,pass} from '../src/game.js';
import {TRAINED_LEVELS,trainedModelsInfo,chooseTrainedMove,getTrainedModel} from '../src/trained-direct-ai.js';
import {evaluatePV2,createInitialPV2Model} from '../src/pv2-ai.js';
import {policyLegalActions,directPolicy,selectDirectPolicyMove} from '../src/direct-policy.js';
import {pointsOnBoard} from '../src/game.js';
import {chooseMove,seededRandom} from '../src/agent.js';
import {readFileSync} from 'node:fs';

test('three real saved self-play checkpoints load with actual architecture and metadata',()=>{
  assert.equal(TRAINED_LEVELS.length,3);
  assert.deepEqual(trainedModelsInfo().map(x=>x.games),[102840,96120,95800]);
  assert.deepEqual(trainedModelsInfo().map(x=>x.passTrainingGames),[440,440,440]);
  assert.ok(trainedModelsInfo().every(x=>x.passLearned));
  assert.deepEqual(trainedModelsInfo().map(x=>x.learningRate),[0.001,0.001,0.0003]);
  for(const id of TRAINED_LEVELS){
    const m=getTrainedModel(id);
    assert.equal(m.architecture,'hex-group-pv-16-v2');
    assert.match(m.training,/on-policy actor-critic/);
    assert.equal(m.metadata.passInLegalActions,true);
    assert.equal(m.metadata.initialPassMargin,1.5);
    assert.ok(m.metadata.optionalPassesSampled>0);
    assert.equal(m.layers.mix3.weights.length,512);
  }
});
test('trained networks are distinct, seeded deterministic, and legal across all board sizes',()=>{
  const fingerprints=new Set();
  for(const id of TRAINED_LEVELS){
    const model=getTrainedModel(id);
    fingerprints.add(model.layers.embed.weights.slice(0,8).join(','));
    for(const radius of [2,3,4,5,6,8,10,11,12]){
      const state=createGame(radius),before=JSON.stringify(state);
      const choices=[];
      const move=chooseTrainedMove(state,id,choices);
      assert.ok(move,'trained pass-aware model should open with a placement at radius '+radius);
      assert.equal(play(state,move.q,move.r).ok,true,
        id+' must choose a legal placement or pass at radius '+radius);
      assert.deepEqual(chooseTrainedMove(state,id),move);
      assert.equal(JSON.stringify(state),before);
      assert.ok(choices.length>0&&choices.length<=5);
      assert.ok(choices.every(x=>Number.isFinite(x.score)&&x.score>=0&&x.score<=1));
      assert.ok(Number.isFinite(evaluatePV2(state,model).logits[0]));
    }
  }
  assert.equal(fingerprints.size,3,'choices must load distinct trained weights');
});
test('all models work for three colors and pass if game ended',()=>{
  for(const id of TRAINED_LEVELS){
    let state=createGame(3);
    for(let turn=0;turn<9&&!state.ended;turn++){
      const move=chooseTrainedMove(state,id);
      const outcome=move?play(state,move.q,move.r):pass(state);
      assert.ok(outcome.ok);
      state=outcome.state;
    }
    state.ended=true;
    assert.equal(chooseTrainedMove(state,id),null);
  }
  assert.throws(()=>getTrainedModel('wrong'),/Unknown trained/);
});

test('pass competes with playable moves and can be deliberately chosen',()=>{
  const state=createGame(3),num=pointsOnBoard(3).length;
  const actions=policyLegalActions(state);
  assert.equal(actions.length,num+1);
  assert.deepEqual(actions.at(-1),{type:'pass',index:num});
  assert.ok(actions.some(a=>a.type==='play'));
  const model=createInitialPV2Model(10);
  // Give pass a strong learned logit and verify it wins the same softmax.
  model.layers.pass.weights.fill(0);
  model.layers.pass.bias[0]=1e3;
  const pred=directPolicy(state,model);
  assert.equal(pred.actions.length,num+1);
  assert.equal(pred.probabilities.at(-1),1);
  assert.equal(selectDirectPolicyMove(state,model,{greedy:true}).action.type,'pass');
  assert.equal(selectDirectPolicyMove(state,model,{greedy:true}).move,null);
  assert.equal(pass(state).ok,true);
  for(const id of TRAINED_LEVELS){
    const trained=directPolicy(state,getTrainedModel(id));
    assert.equal(trained.actions.at(-1).type,'pass');
    assert.ok(Number.isFinite(trained.probabilities.at(-1)));
  }
});

test('trained inference exactly follows raw legal policy without tactical filters',()=>{
  const source=readFileSync(new URL('../src/trained-direct-ai.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/isOwnEye|safeCpuMoves|isUnsafeCpuMove/);
  const ring={'1,0':'black','1,-1':'black','0,-1':'black',
    '-1,0':'black','-1,1':'black','0,1':'black'};
  const scenarios=[
    createGame(2),
    createGame(3),
    {...createGame(2),board:ring,turn:0,moveCount:6}
  ];
  // Include real mid/late-game states from seeded play; verify same argmax
  // even when the network's preferred action would look strategically bad.
  const random=seededRandom(20261106);
  let state=createGame(3);
  for(let i=0;i<36&&!state.ended;i++){
    scenarios.push(state);
    const move=chooseMove(state,random,'balanced');
    const outcome=move?play(state,move.q,move.r):pass(state);
    assert.ok(outcome.ok);
    state=outcome.state;
  }
  for(const id of TRAINED_LEVELS){
    const model=getTrainedModel(id);
    for(const scenario of scenarios){
      const expected=selectDirectPolicyMove(scenario,model,{greedy:true});
      const candidates=[];
      const actual=chooseTrainedMove(scenario,id,candidates);
      assert.deepEqual(actual,expected.move,id+' must use raw policy argmax');
      assert.ok(actual===null||play(scenario,actual.q,actual.r).ok,
        'only game-legal placements are playable');
      assert.ok(candidates.every(c=>c.score>=0&&c.score<=1));
    }
  }
});
