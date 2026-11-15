#!/usr/bin/env node
/** Promote only SHA-verified teacher-distilled square GNNs with grounded H2H checks. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createGame,play,pass} from '../src/game.js';
import {validateComparisonModel,selectComparisonMove} from '../src/architecture-comparison.js';

const root='experiments/square-strength-stage2';
const manifest=JSON.parse(readFileSync(root+'/manifest.json','utf8'));
const duels=JSON.parse(readFileSync('experiments/square-headtohead/staged-direct-greedy.json','utf8'));
const staged=JSON.parse(readFileSync('experiments/square-headtohead/staged-linear-greedy.json','utf8'));
const direct=JSON.parse(readFileSync('experiments/square-headtohead/direct-linear-greedy.json','utf8'));
if(duels.labels.a!=='staged'||duels.labels.b!=='direct'||duels.mode!=='greedy'||
  duels.seed!==20271117||duels.reports.length!==2||
  duels.reports[0].aOutranksB<=.5||duels.reports[1].aOutranksB>=.5||
  staged.reports[0].aOutranksB<=.5||direct.reports[1].aOutranksB<=.5)
 throw Error('Promotion must match real heldout head-to-head evidence');
const chosen={'-9':'gnn64-staged','-13':'gnn64-direct'},models={},hashes={};
for(const [radius,id] of Object.entries(chosen)){
  const source=root+'/'+id+'.json',raw=readFileSync(source,'utf8');
  const hash=createHash('sha256').update(raw).digest('hex');
  if(manifest.variants[id]?.sha256!==hash)
    throw Error('SHA-256 mismatch: '+id);
  const model=validateComparisonModel(JSON.parse(raw));
  const md=model.metadata;
  if(model.kind!=='gnn64'||md.boardShape!=='square'||md.games!==512||
     md.teacherDistillation!==true||md.teacherTrainingSamples!==3620||
     md.teacherValidationSamples!==927||md.teacherEpoch<1||
     !md.radii.includes(Number(radius)))
    throw Error('Wrong source model metadata '+id);
  const state=createGame(Number(radius));
  const move=selectComparisonMove(state,model,{greedy:true}).move;
  const result=move?play(state,move.q,move.r):pass(state);
  if(!result.ok||move===null)throw Error('Initial policy fails to make a legal placement');
  models[radius]=model;hashes[radius]=hash;
}
const output='// Actual selfplay-then-teacher-distilled checkpoints; immutable provenance.\n'+
  '// Selected by independently seeded three-player head-to-head 20271117.\n'+
  '// Source SHA-256: '+JSON.stringify(hashes)+'\n'+
  'export const SQUARE_BOOST_MODELS='+JSON.stringify(models)+';\n';
const out=process.argv[2]??'src/square-boost-model-data.js';
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,output);
console.log('Materialized square boost checkpoints',JSON.stringify({hashes,
 boards:Object.keys(models),source:chosen}));
