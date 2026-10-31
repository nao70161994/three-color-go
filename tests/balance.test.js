import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {COLORS,boardHash,createGame,pass,play,scores} from '../src/game.js';
import {captureExposure,chooseMove,chooseDifficultyMove,seededRandom,simulate} from '../src/agent.js';
import {analyzeBalance,comparePolicies} from '../src/balance.js';

function replay(record){
  let state=createGame(record.radius);
  for(const action of record.actions){
    const result=action.type==='pass'?pass(state):play(state,action.q,action.r);
    assert.equal(result.ok,true,result.reason);
    state=result.state;
  }
  return state;
}
test('balanced policy remains legal and deterministic for a fixed seed',()=>{
  const initial=createGame(3),copy=JSON.stringify(initial);
  const a=chooseMove(initial,seededRandom(42),'balanced');
  const b=chooseMove(initial,seededRandom(42),'balanced');
  assert.deepEqual(a,b);
  assert.ok(play(initial,a.q,a.r).ok);
  assert.equal(JSON.stringify(initial),copy);
  assert.deepEqual(chooseDifficultyMove(initial,seededRandom(42),'hard'),a);
});
test('two-rival capture exposure recognizes surrounding stones and does not mutate',()=>{
  const initial=createGame(2);
  initial.board={'0,0':'black','1,0':'white','1,-1':'red','0,-1':'white','-1,0':'red','-1,1':'white'};
  initial.turn=1;
  const before=JSON.stringify(initial);
  assert.equal(captureExposure(initial,'black'),1);
  assert.equal(JSON.stringify(initial),before);
  assert.equal(captureExposure(createGame(2),'black'),0);
});
test('second rival can capture even if first rival is superko-blocked',()=>{
  const state=createGame(2);
  state.board={'0,0':'black','1,0':'white','1,-1':'red','0,-1':'white',
    '-1,0':'red','-1,1':'white'};
  state.turn=1; // white moves, then red
  const whiteCapture=play(state,0,1);
  assert.equal(whiteCapture.ok,true);
  state.seen.push(boardHash(whiteCapture.state.board));
  assert.equal(play(state,0,1).ok,false);
  const afterPass=pass(state).state;
  assert.equal(play(afterPass,0,1).ok,true);
  assert.equal(captureExposure(state,'black'),1);
});

test('balanced three-player simulation always uses legal moves and can be replayed',()=>{
  const run=simulate({radius:2,seed:55,strategies:['balanced','guarded','baseline']});
  assert.equal(run.truncated,false);
  const record={radius:2,actions:run.history.map(h=>h.pass?{type:'pass'}:{type:'play',q:h.q,r:h.r})};
  assert.deepEqual(replay(record).board,run.state.board);
});
test('seat bias report is seeded, complete, tie-safe and replays exact records',()=>{
  const options={rounds:6,seed:15,radius:2,samples:2,policy:'balanced'};
  const report=analyzeBalance(options);
  assert.deepEqual(report,analyzeBalance(options));
  assert.equal(report.finished+report.truncated,6);
  assert.equal(report.sampleRecords.length,2);
  assert.equal(report.seats.length,3);
  assert.ok(report.averages.occupancy>=0&&report.averages.occupancy<=1);
  assert.ok(report.averages.lastThirdNonCaptureFraction>=0&&report.averages.lastThirdNonCaptureFraction<=1);
  assert.ok(report.highOccupancyFraction>=0&&report.highOccupancyFraction<=1);
  for(const sample of report.sampleRecords) assert.deepEqual(scores(replay(sample)),sample.scores);
  const total=report.seats.reduce((s,x)=>s+x.winShare,0);
  assert.ok(Math.abs(total-report.finished)<.0002);
});
test('incomplete games are excluded from winner and margin denominators',()=>{
  const report=analyzeBalance({rounds:3,seed:1,radius:2,maxTurns:1,samples:1});
  assert.equal(report.finished,0);
  assert.equal(report.truncated,3);
  assert.equal(report.highOccupancyFraction,null);
  assert.equal(report.averages.finalMargin,null);
  for(const seat of report.seats)assert.equal(seat.winRate,null);
});
test('rotated policies compare each seat equally, never counting unfinished matches',()=>{
  const report=comparePolicies({rounds:3,seed:5,radius:2,samples:1});
  assert.equal(report.settings.games,9);
  assert.equal(report.finished+report.truncated,9);
  assert.equal(report.seats.length,3);
  for(const seat of report.seats)assert.equal(seat.games,3);
  assert.deepEqual(scores(replay(report.sampleRecords[0])),report.sampleRecords[0].scores);
  assert.deepEqual(report,comparePolicies({rounds:3,seed:5,radius:2,samples:1}));
});
test('invalid batch parameters and strategies are rejected',()=>{
  assert.throws(()=>analyzeBalance({rounds:0}),/rounds/);
  assert.throws(()=>analyzeBalance({radius:6}),/radius/);
  assert.throws(()=>analyzeBalance({seed:-1}),/seed/);
  assert.throws(()=>analyzeBalance({policy:'unknown'}),/policy/);
  assert.throws(()=>comparePolicies({challenger:'balanced',opponent:'balanced'}),/different/);
});
test('CLI emits machine-readable balance report for external agents',()=>{
  const cmd=spawnSync(process.execPath,['scripts/balance.mjs','--games','3','--radius','2','--seed','5','--samples','1'],{
    cwd:process.cwd(),timeout:30000,encoding:'utf8'
  });
  assert.equal(cmd.status,0,cmd.stderr);
  const report=JSON.parse(cmd.stdout);
  assert.equal(report.kind,'balance-selfplay');
  assert.equal(report.settings.rounds,3);
  assert.equal(report.sampleRecords.length,1);
});
