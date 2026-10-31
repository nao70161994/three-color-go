import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGame, pass, play, pointKey, scores, winner } from '../src/game.js';
import { chooseMove, groupInfo, seededRandom, simulate } from '../src/agent.js';
import { analyzeGames, compareStrategies } from '../src/analysis.js';

function replay(record) {
  let state=createGame(record.radius);
  for(const a of record.actions) {
    const result=a.type==='pass'?pass(state):play(state,a.q,a.r);
    assert.equal(result.ok,true,'invalid action in seeded record');
    state=result.state;
  }
  return state;
}

test('groupInfo handles linked stones and unique liberties',()=>{
  const s=createGame(2);
  s.board={'0,0':'black','1,0':'black','0,1':'red'};
  const g=groupInfo(s.board,'0,0',2);
  assert.deepEqual(new Set(g.stones),new Set(['0,0','1,0']));
  assert.equal(g.liberties.length,new Set(g.liberties).size);
  assert.ok(g.liberties.length>0);
});

test('tactical CPU rescues an endangered own stone instead of playing randomly',()=>{
  const s=createGame(3);
  s.board={
    '0,0':'black', '1,0':'red','1,-1':'white','0,-1':'red',
    '-1,0':'white','-1,1':'red'
  };
  s.turn=0;
  const move=chooseMove(s,seededRandom(4),'tactical');
  assert.deepEqual(move,{q:0,r:1});
  assert.equal(play(s,move.q,move.r).ok,true);
});

test('baseline and tactical choices are legal and deterministic with seeds',()=>{
  for(const strategy of ['baseline','tactical']) {
    const s=createGame(3);
    const a=chooseMove(s,seededRandom(888),strategy);
    const b=chooseMove(s,seededRandom(888),strategy);
    assert.deepEqual(a,b);
    assert.equal(play(s,a.q,a.r).ok,true);
  }
  assert.throws(()=>chooseMove(createGame(3),seededRandom(1),'unknown'),/Unknown/);
});

test('seeded batch metrics do not claim truncated matches as wins',()=>{
  const report=analyzeGames({games:9,seed:10,radius:2,maxTurns:1,samples:2});
  assert.equal(report.finished,0);
  assert.equal(report.truncated,9);
  assert.deepEqual(report.winRate,{black:null,white:null,red:null});
  assert.equal(report.sampleRecords.length,2);
  assert.equal(report.averageTurns,1);
  assert.deepEqual(replay(report.sampleRecords[0]).board,
    Object.fromEntries(report.sampleRecords[0].actions.filter(x=>x.type==='play').map(x=>[pointKey(x.q,x.r),'black'])));
});

test('self-play results are reproducible and each sample replays exactly',()=>{
  const a=analyzeGames({games:6,seed:6,radius:2,samples:2});
  const b=analyzeGames({games:6,seed:6,radius:2,samples:2});
  assert.deepEqual(a,b);
  assert.equal(a.finished+a.truncated,6);
  assert.ok(a.averageOccupancy>=0&&a.averageOccupancy<=1);
  assert.ok(a.jointCaptures<=a.captures);
  for(const record of a.sampleRecords) {
    const state=replay(record);
    assert.deepEqual(scores(state),record.scores);
    assert.deepEqual(winner(state),record.winners);
  }
  const totalShare=Object.values(a.winShare).reduce((s,n)=>s+n,0);
  assert.ok(Math.abs(totalShare-a.finished)<0.0002);
});

test('rotated tactical-versus-baseline matches report each seat equally',()=>{
  const r=compareStrategies({rounds:3,seed:4,radius:2,samples:1});
  assert.equal(r.settings.games,9);
  assert.equal(r.finished+r.truncated,9);
  assert.equal(r.seats.length,3);
  for(const seat of r.seats)assert.equal(seat.games,3);
  assert.equal(r.sampleRecords.length,1);
  assert.deepEqual(scores(replay(r.sampleRecords[0])),r.sampleRecords[0].scores);
});

test('analytics refuses non-finite/unbounded inputs and has machine-readable CLI',()=>{
  assert.throws(()=>analyzeGames({games:5001}),/games/);
  assert.throws(()=>analyzeGames({samples:6}),/samples/);
  assert.throws(()=>compareStrategies({rounds:1001}),/rounds/);
  const call=spawnSync(process.execPath,
    ['scripts/analyze.mjs','--games','3','--seed','9','--radius','2','--samples','1'],
    {cwd:process.cwd(),encoding:'utf8',timeout:25000});
  assert.equal(call.status,0,call.stderr);
  const parsed=JSON.parse(call.stdout);
  assert.equal(parsed.settings.games,3);
  assert.equal(parsed.sampleRecords.length,1);
});
