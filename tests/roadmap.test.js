import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createGame,play,pass} from '../src/game.js';
import {analyzeRecord,formatAnalysis,explainPosition} from '../src/insights.js';
import {createOnlineSession,validRoom,roomLink} from '../src/online.js';

test('match analysis identifies legal moves, passes and tactical dangers',()=>{
  let state=createGame(2);
  const actions=[{type:'play',q:0,r:0},{type:'pass'},{type:'play',q:1,r:0}];
  for(const a of actions){const result=a.type==='pass'?pass(state):play(state,a.q,a.r);assert.equal(result.ok,true);state=result.state;}
  const data=analyzeRecord({radius:2,actions});
  assert.equal(data.stats.turns,3);
  assert.equal(data.stats.moves,2);
  assert.equal(data.stats.passes,1);
  assert.deepEqual(data.scores,{black:1,white:0,red:1});
  assert.equal(explainPosition(state).moveCount,3);
  assert.match(formatAnalysis(data),/三色六角碁 対局分析/);
  assert.throws(()=>analyzeRecord({radius:2,actions:[{type:'play',q:99,r:99}]}),/Illegal/);
});

test('invitation links use valid unique room identifiers',()=>{
  const room='tgo-0123456789abcdef0123456789abcdef';
  assert.equal(validRoom(room),true);
  assert.equal(validRoom('bad'),false);
  assert.equal(roomLink('https://example.com/game?x=1#test',room),
    'https://example.com/game?x=1&room='+room);
});

class FakeConn extends EventEmitter {
  constructor(peer){super();this.peer=peer;this.open=false;}
  send(data){if(this.open)queueMicrotask(()=>this.other?.emit('data',structuredClone(data)));}
  close(){this.open=false;this.emit('close');if(this.other?.open){this.other.open=false;this.other.emit('close');}}
}
const nodes=new Map();
class FakePeer extends EventEmitter {
  constructor(id){super();this.id=id||'guest-'+Math.random();nodes.set(this.id,this);queueMicrotask(()=>this.emit('open',this.id));}
  connect(id){
    const target=nodes.get(id);
    const a=new FakeConn(id),b=new FakeConn(this.id);
    a.other=b;b.other=a;
    if(!target)throw Error('Missing host');
    target.emit('connection',b);
    queueMicrotask(()=>{a.open=true;b.open=true;a.emit('open');b.emit('open');});
    return a;
  }
  destroy(){nodes.delete(this.id);this.emit('close');}
}
async function tick(){await new Promise(r=>setTimeout(r,0));}

test('host-authoritative three-person network validates turns and syncs guests',async()=>{
  nodes.clear();
  let state=createGame(3);
  const actions=[];
  const record=()=>({radius:3,mode:'online',actions:actions.map(a=>({...a}))});
  const apply=(action,seat,count)=>{
    if(seat!==state.turn||count!==state.moveCount)return {ok:false,reason:'wrong turn'};
    const r=action.type==='pass'?pass(state):play(state,action.q,action.r);
    if(r.ok){state=r.state;actions.push(action);host.broadcast();}
    return r;
  };
  let white=null,red=null;
  const host=createOnlineSession({Peer:FakePeer,token:()=> 'a'.repeat(32),
    getRecord:record,applyMove:apply,receiveRecord:()=>{}});
  const room=await host.createRoom();
  assert.equal(room.seat,0);
  const guest1=createOnlineSession({Peer:FakePeer,token:()=> 'b'.repeat(32),
    getRecord:()=>({}),applyMove:()=>{throw Error('guest must not decide');},receiveRecord:r=>{white=r;}});
  const guest2=createOnlineSession({Peer:FakePeer,token:()=> 'c'.repeat(32),
    getRecord:()=>({}),applyMove:()=>{throw Error('guest must not decide');},receiveRecord:r=>{red=r;}});
  const [w,r]=await Promise.all([guest1.joinRoom(room.room),guest2.joinRoom(room.room)]);
  assert.deepEqual([w.status.seat,r.status.seat],[1,2]);
  assert.equal(host.status().players,2);
  assert.equal(guest1.submit({type:'play',q:0,r:0},0).ok,true);
  await tick();
  assert.equal(state.moveCount,0,'white cannot act when it is black turn');
  assert.equal(host.submit({type:'play',q:0,r:0},0).ok,true);
  await tick();
  assert.equal(white.actions.length,1);
  assert.equal(red.actions.length,1);
  assert.equal(guest1.submit({type:'play',q:1,r:0},0).ok,true);
  await tick();assert.equal(state.moveCount,1,'stale move cannot be committed');
  guest1.submit({type:'play',q:1,r:0},1);
  await tick();assert.equal(state.moveCount,2);
  guest2.submit({type:'pass'},2);
  await tick();assert.equal(state.moveCount,3);
  assert.equal(white.actions.length,3);
  assert.equal(red.actions.length,3);
  guest1.close();guest2.close();host.close();
});


test('protocol v2 broadcasts deltas and resynchronizes rejected increments',async()=>{
  nodes.clear();
  let state=createGame(2),actions=[];
  const record=()=>({radius:2,mode:'online',actions:actions.map(a=>({...a}))});
  let host;
  host=createOnlineSession({Peer:FakePeer,getRecord:record,
    applyMove:(action,seat,expected)=>{
      if(state.turn!==seat||state.moveCount!==expected)return {ok:false,reason:'wrong turn'};
      const res=action.type==='pass'?pass(state):play(state,action.q,action.r);
      if(res.ok){state=res.state;actions.push(action);host.broadcastMove(action,expected);}
      return res;
    },receiveRecord:()=>{}});
  const room=await host.createRoom();
  const seen={w:0,r:0},full={w:0,r:0};
  const mk=(k,refuse)=>createOnlineSession({Peer:FakePeer,getRecord:()=>({}),
    applyMove:()=>{throw Error('client cannot commit a move');},
    receiveRecord:record=>{full[k]=record.actions.length;},
    receiveDelta:(action,expected)=>{
      seen[k]++;
      if(refuse())return false;
      assert.ok(['play','pass'].includes(action.type));
      assert.ok(Number.isSafeInteger(expected));
      return true;
    }});
  let refuseWhite=false;
  const white=mk('w',()=>refuseWhite),red=mk('r',()=>false);
  await Promise.all([white.joinRoom(room.room),red.joinRoom(room.room)]);
  assert.equal(host.submit({type:'play',q:0,r:0},0).ok,true);
  await tick();await tick();
  assert.equal(seen.w,1);assert.equal(seen.r,1);
  assert.equal(full.w,0);
  refuseWhite=true;
  assert.equal(white.submit({type:'pass'},1).ok,true);
  await tick();await tick();
  assert.equal(seen.w,2);assert.equal(seen.r,2);
  assert.equal(full.w,2,'failed delta must request a full resync');
  white.close();red.close();host.close();
});
