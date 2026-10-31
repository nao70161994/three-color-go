import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGame, pass, play, pointKey, scores, winner } from '../src/game.js';
import { chooseMove, chooseDifficultyMove, dangerGroups, legalMoves, seededRandom, simulate, snapshot } from '../src/agent.js';

test('agents can inspect the initial board and legal moves',()=>{
  const state=createGame(3);
  assert.equal(legalMoves(state).length,37);
  assert.equal(snapshot(state).currentPlayer,'black');
  assert.equal(snapshot(state).ended,false);
  assert.deepEqual(snapshot(state).scores,{black:0,white:0,red:0});
});

test('snapshots are safe copies and invalid moves do not mutate state',()=>{
  const state=createGame(2);
  const view=snapshot(state);view.board['0,0']='white';
  assert.deepEqual(state.board,{});
  assert.equal(play(state,5,0).ok,false);
  assert.equal(legalMoves(state).length,19);
});

test('bot chooses a legal move and seeded simulations terminate',()=>{
  const game=createGame(3);
  const move=chooseMove(game,seededRandom(123));
  assert.ok(move);
  assert.equal(play(game,move.q,move.r).ok,true);
  for (let seed=1;seed<=20;seed++) {
    const run=simulate({radius:3,seed});
    assert.equal(run.truncated,false,'seed='+seed);
    assert.equal(run.state.ended,true,'seed='+seed);
    assert.ok(run.history.length<=400,'seed='+seed);
    assert.equal(run.state.consecutivePasses,3,'seed='+seed);
    assert.equal(run.state.moveCount,run.history.length);
    const counted=Object.values(run.state.scores).reduce((a,b)=>a+b,0);
    assert.equal(counted,Object.keys(run.state.board).length,'seed='+seed);
    assert.ok(counted<=37);
    const replay=simulate({radius:3,seed});
    assert.deepEqual(run.history,replay.history,'determinism seed='+seed);
  }
});

test('simulated records replay legally and produce identical boards',()=>{
  const run=simulate({radius:3,seed:17});
  let state=createGame(3);
  for (const move of run.history) {
    const result=move.pass?pass(state):play(state,move.q,move.r);
    assert.equal(result.ok,true,JSON.stringify(move));
    state=result.state;
  }
  assert.deepEqual(scores(state),run.state.scores);
  assert.deepEqual(winner(state),run.state.winners);
  assert.deepEqual(state.board,run.state.board);
});

test('JSONL process lets external AI agents play, inspect and export',()=>{
  const commands=[
    {action:'new',radius:2},
    {action:'legal'},
    {action:'play',q:0,r:0},
    {action:'play',q:0,r:0},
    {action:'bot'},
    {action:'undo'},
    {action:'export'}
  ];
  const result=spawnSync(process.execPath,['scripts/agent-play.mjs'],{
    cwd:process.cwd(),input:commands.map(x=>JSON.stringify(x)).join('\n')+'\n',
    encoding:'utf8',timeout:10000
  });
  assert.equal(result.status,0,result.stderr);
  const responses=result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses.length,commands.length);
  assert.equal(responses[0].ok,true);
  assert.equal(responses[1].moves.length,19);
  assert.equal(responses[2].state.scores.black,1);
  assert.equal(responses[3].ok,false);
  assert.equal(responses[4].state.currentPlayer,'red');
  assert.equal(responses[5].state.currentPlayer,'white');
  assert.equal(responses[6].record.actions.length,1);
});


test('v0.4: exactly one liberty is reported as danger but not as certain death',()=>{
  const state=createGame(3);
  state.board={
    '0,0':'black', '1,0':'white','1,-1':'red','0,-1':'white',
    '-1,0':'red','-1,1':'white'
  };
  const groups=dangerGroups(state);
  const black=groups.find(g=>g.color==='black');
  assert.ok(black);
  assert.deepEqual(black.stones,['0,0']);
  assert.deepEqual(black.liberties,['0,1']);
  assert.deepEqual(dangerGroups(createGame(3)),[]);
});

test('v0.4: easy / normal / hard difficulty moves are valid, seeded and nonmutating',()=>{
  const empty=createGame(3), before=JSON.stringify(empty);
  for(const level of ['easy','normal','hard']) {
    const first=chooseDifficultyMove(empty,seededRandom(11),level);
    const second=chooseDifficultyMove(empty,seededRandom(11),level);
    assert.deepEqual(first,second,level);
    assert.equal(play(empty,first.q,first.r).ok,true,level);
  }
  assert.equal(JSON.stringify(empty),before);
  assert.throws(()=>chooseDifficultyMove(empty,seededRandom(3),'fake'),/Unknown CPU level/);
  const ended={...empty,ended:true};
  for(const level of ['easy','normal','hard']) {
    assert.equal(chooseDifficultyMove(ended,seededRandom(11),level),null);
  }
});
