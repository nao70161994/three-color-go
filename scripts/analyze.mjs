#!/usr/bin/env node
// Seeded v0.3 analysis; no external dependencies. JSON is suitable for CI/agents.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analyzeGames, compareStrategies } from '../src/analysis.js';

function usage() {
  console.log('node scripts/analyze.mjs [--games 300] [--seed 1] [--radius 3] [--strategy tactical|baseline] [--samples 3] [--compare] [--out reports/result.json]');
}

async function main(argv) {
  if(argv.includes('--help'))return usage();
  const values={};
  const keys=new Set(['games','seed','radius','strategy','samples','out','max-turns']);
  for(let i=0;i<argv.length;i++) {
    const name=argv[i];
    if(name==='--compare'){values.compare=true;continue;}
    if(!name.startsWith('--')||!keys.has(name.slice(2))||!argv[i+1]||
       argv[i+1].startsWith('--'))throw new Error('Invalid argument: '+name);
    values[name.slice(2)]=argv[++i];
  }
  const config={
    games:values.games===undefined?300:Number(values.games),
    seed:values.seed===undefined?1:Number(values.seed),
    radius:values.radius===undefined?3:Number(values.radius),
    samples:values.samples===undefined?3:Number(values.samples),
    maxTurns:values['max-turns']===undefined?400:Number(values['max-turns']),
    strategy:values.strategy??'tactical'
  };
  if(!Number.isSafeInteger(config.seed))throw new Error('seed must be an integer');
  const result=values.compare
    ? compareStrategies({rounds:config.games,seed:config.seed,radius:config.radius,
        maxTurns:config.maxTurns,samples:config.samples})
    : analyzeGames(config);
  const json=JSON.stringify(result,null,2)+'\n';
  if(values.out) {
    await mkdir(dirname(values.out),{recursive:true});
    await writeFile(values.out,json,'utf8');
    console.error('Wrote reproducible report: '+values.out);
  }
  process.stdout.write(json);
}
main(process.argv.slice(2)).catch(e=>{console.error('Analysis failed: '+e.message);process.exitCode=1;});
