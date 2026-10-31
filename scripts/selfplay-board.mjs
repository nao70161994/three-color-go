#!/usr/bin/env node
/**
 * Generate teacher-free board-based AlphaZero-style training examples.
 * Uses official JS game rules, current full-board policy/value model and
 * three-player MaxN MCTS. All targets come from search and terminal outcomes.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {COLORS,createGame,play,pass,scores} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {chooseBoardMctsMove,terminalShares} from '../src/board-mcts.js';
import {validateBoardModel} from '../src/board-pv.js';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--model','--games','--radius','--simulations','--seed','--out'].includes(process.argv[i])||
      !process.argv[i+1])throw Error('Missing or unknown argument '+process.argv[i]);
  args[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!args.model)throw Error('--model is required');
const games=Number(args.games??2),radius=Number(args.radius??2);
const simulations=Number(args.simulations??12),seed=Number(args.seed??20261031);
if(!Number.isInteger(games)||games<1||games>100||
    !Number.isInteger(radius)||radius<2||radius>4||
    !Number.isInteger(simulations)||simulations<2||simulations>256||
    !Number.isSafeInteger(seed)||seed<0||seed>4294967295)
  throw Error('Invalid board self-play settings');
const model=validateBoardModel(JSON.parse(readFileSync(args.model,'utf8')));
const results=[];
for(let game=0;game<games;game++){
  const gameSeed=(seed+game*104729)>>>0;
  const random=seededRandom(gameSeed);
  let state=createGame(radius);
  const samples=[];
  const maxTurns=2*(3*radius*(radius+1)+1)+3;
  while(!state.ended&&state.moveCount<maxTurns){
    const snapshot={
      radius:state.radius,turn:state.turn,moveCount:state.moveCount,
      stones:Object.entries(state.board).map(([p,color])=>{
        const [q,r]=p.split(',').map(Number);
        return [q,r,COLORS.indexOf(color)];
      })
    };
    const search=chooseBoardMctsMove(state,model,{
      simulations,temperature:1,noise:0.20,random
    });
    const move=search.move;
    const transition=move?play(state,move.q,move.r):pass(state);
    if(!transition.ok)throw Error('Illegal MCTS move '+transition.reason);
    samples.push({
      ...snapshot,legal:search.policy.map(x=>x.index),
      policy:search.policy.filter(x=>x.probability>0)
        .map(x=>[x.index,x.probability]),choice:search.index
    });
    state=transition.state;
  }
  if(!state.ended)throw Error('Self-play truncated');
  const terminal=terminalShares(state);
  for(const sample of samples)sample.value=terminal;
  results.push({
    version:1,kind:'board-policy-value-mcts',seed:gameSeed,
    radius,simulations,ended:true,scores:scores(state),terminal,samples
  });
}
const output=results.map(value=>JSON.stringify(value)).join('\n')+'\n';
if(args.out)writeFileSync(args.out,output);
else process.stdout.write(output);
