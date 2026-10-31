#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {analyzeBalance,comparePolicies} from '../src/balance.js';

const keys=new Set(['games','seed','radius','max-turns','samples','policy','challenger','opponent','out']);
const args={};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==='--matchup'){args.matchup=true;continue;}
  if(!key.startsWith('--')||!keys.has(key.slice(2))||process.argv[i+1]===undefined||process.argv[i+1].startsWith('--')){
    console.error('Unknown or missing parameter: '+key);process.exit(2);
  }
  args[key.slice(2)]=process.argv[++i];
}
const options={
  rounds:args.games===undefined?(args.matchup?30:90):Number(args.games),
  seed:args.seed===undefined?20261031:Number(args.seed),
  radius:args.radius===undefined?3:Number(args.radius),
  maxTurns:args['max-turns']===undefined?400:Number(args['max-turns']),
  samples:args.samples===undefined?3:Number(args.samples)
};
try{
  const result=args.matchup
    ? comparePolicies({...options,challenger:args.challenger??'balanced',opponent:args.opponent??'guarded'})
    : analyzeBalance({...options,policy:args.policy??'balanced'});
  const json=JSON.stringify(result,null,2)+'\n';
  if(args.out){
    await mkdir(dirname(args.out),{recursive:true});
    await writeFile(args.out,json,'utf8');
    console.error('Saved '+args.out);
  }
  process.stdout.write(json);
}catch(e){
  console.error('Balance analysis failed: '+e.message);
  process.exitCode=1;
}
