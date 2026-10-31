import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, play, pass, scores, winner} from '../src/game.js';
import {seededRandom} from '../src/agent.js';
import {chooseStrongMove, strongMatch} from '../src/strong-ai.js';

test('strong CPU always chooses reproducible legal moves without mutating the board',()=>{
  for(const radius of [2,3,4]){
    const state=createGame(radius),unchanged=JSON.stringify(state);
    const first=chooseStrongMove(state,seededRandom(2026));
    const second=chooseStrongMove(state,seededRandom(2026));
    assert.deepEqual(first,second);
    assert.equal(play(state,first.q,first.r).ok,true);
    assert.equal(JSON.stringify(state),unchanged);
  }
});

test('strong CPU takes a direct capture rather than leaving a single-stone atari',()=>{
  const state=createGame(2);
  state.turn=1;
  state.board={
    '0,0':'black','1,0':'red','1,-1':'white','0,-1':'red',
    '-1,0':'white','-1,1':'red'
  };
  const capture=play(state,0,1);
  assert.ok(capture.ok);
  assert.deepEqual(capture.captured,['0,0']);
  const move=chooseStrongMove(state,seededRandom(15));
  assert.deepEqual(move,{q:0,r:1});
});

test('seeded strong-vs-balanced match terminates and its history replays legally',()=>{
  for(const seat of [0,1,2]){
    const match=strongMatch({radius:2,seed:12+seat,strongSeat:seat,maxTurns:100});
    assert.equal(match.ended,true,'seat='+seat);
    let replay=createGame(2);
    for(const a of match.history){
      const result=a.type==='pass'?pass(replay):play(replay,a.q,a.r);
      assert.equal(result.ok,true,result.reason);
      replay=result.state;
    }
    assert.deepEqual(replay.board,match.state.board);
    assert.deepEqual(scores(replay),scores(match.state));
    assert.deepEqual(winner(replay),match.winners);
  }
});

test('strong CPU passes after its bounded game-length policy',()=>{
  const state=createGame(3);
  state.moveCount=pointsOnBoardCount(3)*2;
  assert.equal(chooseStrongMove(state),null);
});

function pointsOnBoardCount(r){return 3*r*(r+1)+1;}
