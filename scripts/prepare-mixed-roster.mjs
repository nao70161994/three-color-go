#!/usr/bin/env node
/** Curate strongest/representative checkpoint candidates before new-seed matches.
 * Selection is based on earlier CPU-heldout and same-step studies, never on
 * the yet-unseen cross-checkpoint tournament. All source model bytes preserved.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CHECKPOINTS} from '../src/trained-model-data.js';
import {PASS_CHECKPOINTS} from '../src/pass-trained-model-data.js';
import {validateComparisonModel} from '../src/architecture-comparison.js';
import {validatePV2Model} from '../src/pv2-ai.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];
 if(!['--early','--late','--pass-models','--out'].includes(k)||v===undefined)
   throw Error('Bad argument '+k);
 args[k.slice(2)]=v;
}
if(!args.early||!args.late||!args['pass-models']||!args.out)
  throw Error('Expected --early, --late, --pass-models, --out');
const groups={
  gnn16:[20000,32000,46000,50000,60000],
  gnn64:[20000,30000,36000,50000,60000],
  attn64:[20000,28000,36000,42000,50000,60000]
};
const originals=['trained-lr001-final','trained-lr001-peak','trained-lr0003-peak'];
const passRates=['lr001','lr0003','lr0001','lr00003','lr00001'];
const entries=[],duplicates=new Set();
mkdirSync(args.out,{recursive:true});
function store(id,type,model,other={}){
  if(duplicates.has(id))throw Error('Duplicate ID '+id);
  duplicates.add(id);
  if(type==='comparison')validateComparisonModel(model);
  if(type==='pv2')validatePV2Model(model);
  const payload=JSON.stringify(model);
  const sha256=createHash('sha256').update(payload).digest('hex');
  writeFileSync(join(args.out,id+'.json'),payload+'\n');
  entries.push({id,type,version:model.version,architecture:model.architecture,
    originalTrainingGames:model.metadata?.games??null,
    sha256,...other});
}
for(const [kind,checkpoints] of Object.entries(groups))for(const games of checkpoints){
  const folder=join(games<=20000?args.early:args.late,
    'architecture-milestone-'+games/8+'-'+kind);
  const model=JSON.parse(readFileSync(join(folder,'model.json'),'utf8'));
  if(model.kind!==kind||model.metadata?.games!==games)
    throw Error('Wrong checkpoint identity '+folder);
  store(kind+'-g'+games,'comparison',model,{
    kind,games,sourceRun:games<=20000?41610283160:41672945203,
    selection:'historical score high or start/final control'
  });
}
for(const rate of passRates){
  const folder=join(args['pass-models'],'pass-20k-'+rate);
  const model=JSON.parse(readFileSync(join(folder,'pass-20k-'+rate+'.json'),'utf8'));
  if(model.architecture!=='hex-group-pv-16-v2'||model.metadata?.games!==20000||
     model.metadata?.passInLegalActions!==true||!
     String(model.metadata?.initializedFrom).includes('model-102400'))
    throw Error('Invalid frozen 122400-game historical model '+rate);
  store('old122k-'+rate,'pv2',model,{
    historicalTrainingGames:122400,sourceRun:41487742023,
    note:'102400 source games then 20000 pass-inclusive games; legacy phase feature and init-pass-margin'
  });
}
for(const name of originals){
  const original=CHECKPOINTS[name],tuned=PASS_CHECKPOINTS[name];
  if(original.architecture!=='hex-group-pv-16-v2'||tuned.architecture!=='hex-group-pv-16-v2')
    throw Error('Wrong published legacy model '+name);
  store('old-original-'+name.replace('trained-',''),'pv2',original,{
    historicalTrainingGames:original.metadata.games,
    note:'embedded older phase-feature model (no pass-aware continuation)'
  });
  store('old-pass-'+name.replace('trained-',''),'pv2',tuned,{
    historicalTrainingGames:original.metadata.games+320+tuned.metadata.games,
    note:'embedded 320+120 pass-aware continuation (historical separate stage)'
  });
}
for(const id of ['baseline','balanced','tactical']){
  entries.push({id,type:'cpu',architecture:'rules',version:'current-rule-cpu',
    originalTrainingGames:0});
}
if(entries.length!==30)throw Error('Expected 30 models and CPU choices');
const manifest={version:1,design:'cross-era curated diverse checkpoints, independent evaluation seeds',
  selectionData:'prior conventional-CPU and same-step comparisons; no cross-era match results',
  actualEvaluationDoNotTreatSameCheckpointAsStrongest:true,
  entries};
writeFileSync(join(args.out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({entries:entries.length,byType:{
  comparison:entries.filter(x=>x.type==='comparison').length,
  pv2:entries.filter(x=>x.type==='pv2').length,
  cpu:entries.filter(x=>x.type==='cpu').length
},ids:entries.map(x=>x.id)}));
