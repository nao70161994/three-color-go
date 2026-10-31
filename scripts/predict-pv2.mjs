#!/usr/bin/env node
/** JS side of a PyTorch/JS forward parity check for exported PV2 weights. */
import {readFileSync} from 'node:fs';
import {createGame,play,pass,pointsOnBoard} from '../src/game.js';
import {evaluatePV2,encodePV2State} from '../src/pv2-ai.js';

if(process.argv.length!==3)throw Error('Usage: node scripts/predict-pv2.mjs model.json');
const model=JSON.parse(readFileSync(process.argv[2],'utf8'));
const samples=[];
for(const radius of [2,3,4]){
  let state=createGame(radius);
  const points=pointsOnBoard(radius);
  for(let i=0;i<Math.min(points.length,16);i++){
    const point=points[(i*7+3)%points.length];
    const result=play(state,point.q,point.r);
    if(result.ok)state=result.state;
    else state=pass(state).state;
    if(state.ended)break;
  }
  const features=encodePV2State(state);
  const prediction=evaluatePV2(state,model);
  samples.push({...features,logits:prediction.logits,value:prediction.value});
}
process.stdout.write(JSON.stringify(samples)+'\n');
