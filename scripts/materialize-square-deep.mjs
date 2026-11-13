#!/usr/bin/env node
/** Materialize only real, verified self-play checkpoints into browser model data. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateComparisonModel,selectComparisonMove} from '../src/architecture-comparison.js';
import {createGame} from '../src/game.js';
import {SQUARE_DEEP_LEVELS} from '../src/square-deep-ai.js';
const folder=process.argv[2]??'artifacts';
const output=process.argv[3]??'src/square-deep-model-data.js';
const kinds=['gnn16','gnn64','attn64'];
const models={};
const hashes={};
for(const kind of kinds){
  const path=folder+'/square-deep-'+kind+'/model.json';
  const data=readFileSync(path,'utf8');
  const model=validateComparisonModel(JSON.parse(data));
  if(model.kind!==kind || model.metadata.boardShape!=='square' ||
     model.metadata.games!==32||model.metadata.iterations!==4||
     model.metadata.phaseFeature!==false||
     JSON.stringify(model.metadata.radii)!==JSON.stringify([-9,-9,-9,-13])||
     model.metadata.naturallyEndedGames+model.metadata.truncatedGames!==32)
    throw Error('Wrong/non-complete square self-play checkpoint '+kind);
  for(const size of [9,13,19]){
    const state=createGame(-size);
    const decision=selectComparisonMove(state,model,{greedy:true});
    if(!decision.action||!decision.probabilities.every(Number.isFinite))
      throw Error('Invalid square model inference '+kind+' '+size);
  }
  const id='square-'+kind+'-32';
  if(!SQUARE_DEEP_LEVELS.includes(id))throw Error('Unknown square deep model '+id);
  models[id]=model;
  hashes[id]=createHash('sha256').update(data).digest('hex');
}
const code='// Self-play PyTorch checkpoints from GitHub Actions. No hex weights reused.\n'+
  '// SHA-256 of exact original JSON checkpoints: '+JSON.stringify(hashes)+'\n'+
  'export const SQUARE_DEEP_MODELS='+JSON.stringify(models)+';\n';
writeFileSync(output,code);
console.log('Frozen square deep checkpoints:',JSON.stringify(Object.fromEntries(
  Object.entries(models).map(([id,m])=>[id,{games:m.metadata.games,
    ended:m.metadata.naturallyEndedGames,truncated:m.metadata.truncatedGames}]))));
