#!/usr/bin/env node
/** PyTorch parity samples for experimental models of all three architectures. */
import {readFileSync} from 'node:fs';
import {createGame,play,pass,pointsOnBoard} from '../src/game.js';
import {PV3_ARCH,encodePV2State} from '../src/pv2-ai.js';
import {validateComparisonModel,evaluateComparison} from '../src/architecture-comparison.js';
if(process.argv.length!==3)throw Error('Usage: node scripts/predict-architecture.mjs model.json');
const model=validateComparisonModel(JSON.parse(readFileSync(process.argv[2],'utf8')));
const samples=[];
for(const radius of [2,3,4]){
  let state=createGame(radius);
  const points=pointsOnBoard(radius);
  for(let i=0;i<Math.min(points.length,12);i++){
    const p=points[(i*7+3)%points.length];
    const o=play(state,p.q,p.r);
    state=o.ok?o.state:pass(state).state;
    if(state.ended)break;
  }
  const features=encodePV2State(state,{architecture:PV3_ARCH});
  const prediction=evaluateComparison(state,model);
  samples.push({radius,features:features.features,turn:state.turn,
    logits:prediction.logits,value:prediction.value});
}
process.stdout.write(JSON.stringify(samples)+'\n');
