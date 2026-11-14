#!/usr/bin/env node
/**
 * Reproducible bootstrap for square-board neural-style learned policy:
 * supervised behavior cloning from actual 3-color square-board games.
 * No hand-authored final policy weights. No inference-time tactical score.
 * The teacher is the existing balanced/tactical CPU; therefore this does
 * NOT establish independent RL strength or a win rate against that teacher.
 *
 * Usage: node scripts/train-square-policy.mjs [games9] [games13] [games19] [out]
 */
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {COLORS,createGame,play,pass,pointsOnBoard,scores,winner} from '../src/game.js';
import {seededRandom,chooseMove} from '../src/agent.js';
import {squarePolicyDistribution,SQUARE_FEATURES} from '../src/square-policy.js';
import {squareTrainingCounts} from './square-training-config.mjs';

const games=squareTrainingCounts(process.argv.slice(2,5));
const out=process.argv[5]??'src/square-policy-weights.js';
const model={
  architecture:'square-linear-policy-v1',
  weights:Array(SQUARE_FEATURES).fill(0),
  passWeights:[-4,6,1.5],
  training:{kind:'square-3-player-teacher-imitation',games:0,
    boardSizes:[],seed:7112026,positions:0,learningRate:0.11,
    details:'balanced+tactical teacher actions, online softmax cross-entropy, true square rules'}
};
const rng=seededRandom(model.training.seed);
const learningRate=model.training.learningRate;
for(const [idx,size] of [9,13,19].entries()){
  if(!games[idx])continue;
  model.training.boardSizes.push(size);
  const moveLimit={9:145,13:105,19:55}[size];
  for(let gameIdx=0;gameIdx<games[idx];gameIdx++){
    let state=createGame(-size),steps=0;
    while(!state.ended&&steps<moveLimit){
      const mentor=chooseMove(state,rng,gameIdx%2?'balanced':'tactical');
      const {actions,probabilities}=squarePolicyDistribution(state,model);
      const selected=actions.find(a=>mentor===null?a.type==='pass':
        a.type==='play'&&a.move.q===mentor.q&&a.move.r===mentor.r);
      if(!selected)throw Error('Teacher move is not in legal action list');
      const expected=Array(SQUARE_FEATURES).fill(0),target=selected.features??expected;
      let passProbability=0;
      const passFeatures=actions[actions.length-1].passFeatures;
      for(let i=0;i<actions.length;i++){
        const a=actions[i],p=probabilities[i];
        if(a.type==='pass'){passProbability=p;continue;}
        for(let j=0;j<SQUARE_FEATURES;j++)expected[j]+=p*a.features[j];
      }
      for(let j=0;j<SQUARE_FEATURES;j++)
        model.weights[j]+=learningRate*(target[j]-expected[j])-0.000002*model.weights[j];
      const isPass=selected.type==='pass'?1:0;
      for(let j=0;j<3;j++)
        model.passWeights[j]+=learningRate*(isPass-passProbability)*passFeatures[j];
      const result=mentor?play(state,mentor.q,mentor.r):pass(state);
      if(!result.ok)throw Error('Teacher move illegal '+result.reason);
      state=result.state;steps++;model.training.positions++;
    }
    model.training.games++;
  }
  console.log('Trained',size+'×'+size,'games',games[idx],'positions',model.training.positions);
}
model.weights=model.weights.map(v=>Number(v.toFixed(7)));
model.passWeights=model.passWeights.map(v=>Number(v.toFixed(7)));
model.training.checkpoint='frozen-supervised-square-20261107';
const output='// Deterministically fitted from real three-player square-board teacher games.\n'+
  'export const SQUARE_POLICY_WEIGHTS='+JSON.stringify(model,null,2)+';\n';
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,output);
console.log('Saved trained square model',out,JSON.stringify(model.training));
