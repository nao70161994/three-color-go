import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Matchmaker} from '../worker/src/index.js';
import {makeMatchmaker} from '../src/matchmaking.js';
import {validRoom} from '../src/online.js';

const storage=new Map();
const ctx={storage:{
  async get(k){return storage.get(k);},
  async put(k,v){storage.set(k,structuredClone(v));}
}};
const endpoint='https://example.workers.dev';
const ticket=n=>n.toString(16).padStart(32,'0');
function req(path,id,method='GET'){
  return new Request(endpoint+path+(method==='GET'?'?ticket='+id:''),
    {method,...(method==='POST'?{headers:{'content-type':'application/json'},
      body:JSON.stringify({ticket:id})}:{})});
}
test('durable-object matchmaking groups exactly three, waits for host readiness and releases seats',async()=>{
  storage.clear();const lobby=new Matchmaker(ctx,{});
  const ids=[ticket(1),ticket(2),ticket(3)];
  for(const id of ids){
    const response=await lobby.fetch(req('/join',id,'POST'));assert.equal(response.status,200);
  }
  const a=await (await lobby.fetch(req('/status',ids[0]))).json();
  const b=await (await lobby.fetch(req('/status',ids[1]))).json();
  const c=await (await lobby.fetch(req('/status',ids[2]))).json();
  assert.equal(a.seat,0);assert.equal(b.seat,1);assert.equal(c.seat,2);
  assert.ok(validRoom(a.room));assert.equal(b.room,null);
  await lobby.fetch(req('/ready',ids[0],'POST'));
  const ready=await (await lobby.fetch(req('/status',ids[1]))).json();
  assert.equal(ready.room,a.room);assert.equal(ready.hostReady,true);
  const fourth=await (await lobby.fetch(req('/join',ticket(4),'POST'))).json();
  assert.equal(fourth.status,'waiting');
  await lobby.fetch(req('/connected',ids[1],'POST'));
  await lobby.fetch(req('/connected',ids[2],'POST'));
  await lobby.fetch(req('/leave',ids[0],'POST'));
  const formerlyMatched=await lobby.fetch(req('/status',ids[1]));
  assert.equal(formerlyMatched.status,404,'connected guests must not become phantom queue players');
});
test('matchmaker browser adapter validates URL and request format',async()=>{
  assert.throws(()=>makeMatchmaker(''),/URL|未設定|Invalid/);
  assert.throws(()=>makeMatchmaker('http://not-local.test'),/HTTPS/);
  const called=[];
  const client=makeMatchmaker(endpoint,async(url,opts)=>{
    called.push([url,opts.method,opts.body]);
    return {ok:true,json:async()=>({ok:true,status:'waiting'})};
  });
  await client.join(ticket(5));await client.status(ticket(5));await client.leave(ticket(5));
  assert.equal(called.length,3);
  assert.match(called[0][0],/\/join$/);
  assert.match(called[1][0],/\/status\?ticket=/);
  assert.match(called[2][0],/\/leave$/);
});
test('PWA assets include install icons, service worker, offline game shell and worker',()=>{
  const manifest=JSON.parse(readFileSync('manifest.webmanifest','utf8'));
  assert.equal(manifest.display,'standalone');
  assert.deepEqual(manifest.icons.filter(i=>i.type==='image/png').map(i=>i.sizes),['192x192','512x512']);
  for(const n of [192,512]){
    const data=readFileSync('icons/icon-'+n+'.png');
    assert.equal(data.subarray(1,4).toString(),'PNG');
    assert.equal(data.readUInt32BE(16),n);
    assert.equal(data.readUInt32BE(20),n);
  }
  const sw=readFileSync('sw.js','utf8');
  assert.match(sw,/src\/ai-worker\.js/);
  assert.match(sw,/src\/matchmaking\.js/);
  assert.match(sw,/cache|caches/i);
  assert.match(readFileSync('index.html','utf8'),/rel="manifest"/);
  assert.match(readFileSync('src\/main.js','utf8'),/serviceWorker\.register/);
});


test('abandoned waiting tabs expire before three-person matching',async()=>{
  storage.clear();
  const real=Date.now;let time=1000;Date.now=()=>time;
  try{
    const lobby=new Matchmaker(ctx,{});
    await lobby.fetch(req('/join',ticket(21),'POST'));
    time+=13000;
    await lobby.fetch(req('/join',ticket(22),'POST'));
    await lobby.fetch(req('/join',ticket(23),'POST'));
    const stale=await lobby.fetch(req('/status',ticket(21)));
    assert.equal(stale.status,404);
    const alive=await (await lobby.fetch(req('/status',ticket(22)))).json();
    assert.equal(alive.status,'waiting');
    await lobby.fetch(req('/join',ticket(24),'POST'));
    assert.equal((await (await lobby.fetch(req('/status',ticket(22)))).json()).status,'matched');
  }finally{Date.now=real;}
});
test('never-ready host is removed and guests can be matched again',async()=>{
  storage.clear();
  const real=Date.now;let time=1000;Date.now=()=>time;
  try{
    const lobby=new Matchmaker(ctx,{});
    for(const i of [31,32,33])await lobby.fetch(req('/join',ticket(i),'POST'));
    time+=26000;
    const guest=await (await lobby.fetch(req('/status',ticket(32)))).json();
    assert.equal(guest.status,'waiting');
    assert.equal(guest.room,null);
    await lobby.fetch(req('/join',ticket(34),'POST'));
    assert.equal((await (await lobby.fetch(req('/status',ticket(32)))).json()).status,'matched');
  }finally{Date.now=real;}
});
test('single IP cannot flood the public lobby with new tickets',async()=>{
  storage.clear();const lobby=new Matchmaker(ctx,{});
  const ip='203.0.113.9';
  for(let i=41;i<47;i++){
    const response=await lobby.fetch(new Request(endpoint+'/join',{method:'POST',
      headers:{'cf-connecting-ip':ip,'content-type':'application/json'},
      body:JSON.stringify({ticket:ticket(i)})}));
    assert.equal(response.status,200);
  }
  const reject=await lobby.fetch(new Request(endpoint+'/join',{method:'POST',
    headers:{'cf-connecting-ip':ip,'content-type':'application/json'},
    body:JSON.stringify({ticket:ticket(47)})}));
  assert.equal(reject.status,429);
});
