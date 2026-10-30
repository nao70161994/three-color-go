#!/usr/bin/env node
/**
 * AI-friendly JSON-lines protocol; no npm install required.
 * Commands:
 * {"action":"new","radius":3}
 * {"action":"state"}  {"action":"legal"}
 * {"action":"play","q":0,"r":0}  {"action":"pass"}  {"action":"bot"}
 * {"action":"undo"}  {"action":"export"}
 * {"action":"import","record":{"radius":3,"actions":[...]}}
 * {"action":"simulate","games":20,"seed":1,"radius":3}
 */
import readline from 'node:readline';
import { COLORS, createGame, pass, play } from '../src/game.js';
import { chooseMove, legalMoves, seededRandom, simulate, snapshot } from '../src/agent.js';

let state=createGame(3), history=[], record=[], random=seededRandom(1);

function commit(result,action) {
  if (!result.ok) return {ok:false,error:result.reason};
  history.push(state);
  state=result.state;
  record.push(action);
  return {ok:true,state:snapshot(state)};
}
function loadRecord(data) {
  if (!data || !Array.isArray(data.actions) || data.actions.length>2000) return {ok:false,error:'Invalid record'};
  let next;
  try {next=createGame(data.radius??3);} catch(e){return {ok:false,error:e.message};}
  const previous=[],actions=[];
  for (const a of data.actions) {
    if (!a || !['play','pass'].includes(a.type)) return {ok:false,error:'Invalid action'};
    const result=a.type==='pass'?pass(next):play(next,a.q,a.r);
    if (!result.ok) return {ok:false,error:result.reason};
    previous.push(next);next=result.state;actions.push({...a});
  }
  state=next;history=previous;record=actions;
  return {ok:true,state:snapshot(state)};
}

export function handle(command) {
  if (!command || typeof command!=='object') return {ok:false,error:'Expected JSON object'};
  switch(command.action) {
    case 'new':
      try {
        state=createGame(command.radius??3);
        random=seededRandom(command.seed??1);
        history=[];record=[];
        return {ok:true,state:snapshot(state)};
      } catch(e) {return {ok:false,error:e.message};}
    case 'state': return {ok:true,state:snapshot(state)};
    case 'legal': return {ok:true,player:state.ended?null:COLORS[state.turn],moves:legalMoves(state),passAllowed:!state.ended};
    case 'play': return commit(play(state,command.q,command.r),{type:'play',q:command.q,r:command.r});
    case 'pass': return commit(pass(state),{type:'pass'});
    case 'bot': {
      const move=chooseMove(state,random);
      return move ? commit(play(state,move.q,move.r),{type:'play',...move})
                  : commit(pass(state),{type:'pass'});
    }
    case 'undo':
      if (!history.length) return {ok:false,error:'No moves to undo'};
      state=history.pop();record.pop();
      return {ok:true,state:snapshot(state)};
    case 'export': return {ok:true,record:{version:1,radius:state.radius,actions:record.map(a=>({...a}))}};
    case 'import': return loadRecord(command.record);
    case 'simulate': {
      const games=Number(command.games??1),seed=Number(command.seed??1),radius=Number(command.radius??3);
      if (!Number.isInteger(games)||games<1||games>100) return {ok:false,error:'games must be 1..100'};
      const runs=Array.from({length:games},(_,i)=>simulate({radius,seed:seed+i}));
      const wins=Object.fromEntries(COLORS.map(c=>[c,0]));
      for (const run of runs) for (const c of run.state.winners) wins[c]++;
      return {ok:true,games,truncated:runs.filter(r=>r.truncated).length,
        wins,averageTurns:runs.reduce((n,r)=>n+r.history.length,0)/games,
        firstGame:runs[0]};
    }
    default: return {ok:false,error:'Unknown action'};
  }
}

if (process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  const i=process.argv.indexOf('--selfplay');
  if (i>=0) {
    const games=Number(process.argv[i+1]??10);
    const seedIndex=process.argv.indexOf('--seed');
    const radiusIndex=process.argv.indexOf('--radius');
    console.log(JSON.stringify(handle({action:'simulate',games,seed:seedIndex>=0?Number(process.argv[seedIndex+1]):1,
      radius:radiusIndex>=0?Number(process.argv[radiusIndex+1]):3}),null,2));
  } else {
    console.error('JSONL agent protocol ready; send one JSON command per line.');
    const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
    for await (const line of rl) {
      try {console.log(JSON.stringify(handle(JSON.parse(line))));}
      catch(e) {console.log(JSON.stringify({ok:false,error:e.message}));}
    }
  }
}
