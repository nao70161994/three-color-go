import test from 'node:test';
import assert from 'node:assert/strict';
import {squareTrainingCounts} from '../scripts/square-training-config.mjs';
test('square training defaults are 12 games 9x9, 3 games 13x13 and 1 game 19x19',()=>{
  assert.deepEqual(squareTrainingCounts(),[12,3,1]);
  assert.deepEqual(squareTrainingCounts([]),[12,3,1]);
  assert.deepEqual(squareTrainingCounts([1]),[1,3,1]);
  assert.deepEqual(squareTrainingCounts(['2','0','0']),[2,0,0]);
});
test('square training rejects empty or bad curricula',()=>{
  for(const data of [[0,0,0],[-1,1,1],[301,0,0],[1.5,0,0],['bad',0,0]])
    assert.throws(()=>squareTrainingCounts(data),/Expected game counts/);
});
