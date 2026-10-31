#!/usr/bin/env node
// Identical seed range and policies across board sizes. Reports are
// exploratory statistics, not a recommendation to change rules.
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {analyzeBalance} from '../src/balance.js';
const parse=(name,defaultValue)=>{
  const i=process.argv.indexOf(name);
  return i<0?defaultValue:Number(process.argv[i+1]);
};
const rounds=parse('--games',9),seed=parse('--seed',20261031);
const output=process.argv.indexOf('--out')>=0?process.argv[process.argv.indexOf('--out')+1]:null;
if(!Number.isInteger(rounds)||rounds<1||rounds>90||
   !Number.isSafeInteger(seed)||seed<0)throw Error('games 1..90 and nonnegative seed');
const sizes=[3,4,5,6];
const results=sizes.map(radius=>{
  const r=analyzeBalance({rounds,seed,radius,maxTurns:600,policy:'balanced',samples:1});
  return {radius,cells:3*radius*(radius+1)+1,
    finished:r.finished,truncated:r.truncated,
    averageTurns:r.averages.turns,
    occupancy:r.averages.occupancy,
    quietLastThird:r.averages.lastThirdNonCaptureFraction,
    leadChanges:r.averages.leadChanges,
    blackWinRate:r.seats[0].winRate,
    whiteWinRate:r.seats[1].winRate,
    redWinRate:r.seats[2].winRate,
    sampleRecord:r.sampleRecords[0]};
});
const data={kind:'cross-size-balanced-selfplay',version:1,seed,rounds,sizes:results,
  note:'Same-policy AI-only runs. Small samples and quiet moves do not prove human boredom or unfairness.'};
const json=JSON.stringify(data,null,2)+'\n';
if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,json);}
process.stdout.write(json);
