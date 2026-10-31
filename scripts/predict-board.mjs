#!/usr/bin/env node
/** Evaluate an exported board network for Python/JS parity verification. */
import {readFileSync} from 'node:fs';
import {createGame,play} from '../src/game.js';
import {boardPredict} from '../src/board-pv.js';
const modelFile=process.argv[2];
if(!modelFile)throw Error('Usage: node scripts/predict-board.mjs MODEL.json');
const model=JSON.parse(readFileSync(modelFile,'utf8'));
let state=createGame(2);
for(const [q,r] of [[0,0],[1,0],[-1,0]]){
  const result=play(state,q,r);
  if(!result.ok)throw Error(result.reason);
  state=result.state;
}
const result=boardPredict(state,model);
process.stdout.write(JSON.stringify({
  value:result.value,policy:Array.from(result.policyLogits)
})+'\n');
