// Matchmaking ONLY. Moves and board sync still use host-authoritative WebRTC.
// Deploy this Worker separately; GitHub Pages alone cannot discover strangers.
const TTL=1000*60*3;
const validTicket=x=>typeof x==='string' && /^[a-f0-9]{32}$/.test(x);
const json=(x,code=200)=>new Response(JSON.stringify(x),{status:code,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store",
  "access-control-allow-origin":"*","access-control-allow-methods":"GET, POST, OPTIONS",
  "access-control-allow-headers":"content-type"
}});
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='OPTIONS')return json({ok:true});
    if(!['/join','/status','/ready','/leave','/health'].includes(url.pathname))return json({error:'Not found'},404);
    if(url.pathname==='/health')return json({ok:true});
    if(request.method==='POST' && Number(request.headers.get('content-length')||0)>512)return json({error:'Too large'},413);
    const id=env.LOBBY.idFromName('global-v1');
    return env.LOBBY.get(id).fetch(request);
  }
};
export class Matchmaker {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(request){
    const url=new URL(request.url),now=Date.now();
    let data={queue:[],players:{}};
    const original=await this.ctx.storage.get('lobby');
    if(original&&typeof original==='object')data=original;
    data.queue=data.queue.filter(id=>data.players[id]&&now-data.players[id].time<TTL);
    for(const [ticket,p] of Object.entries(data.players))
      if(now-p.time>TTL)delete data.players[ticket];
    let body={};
    if(request.method==='POST') {
      try {body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
    }
    const ticket=request.method==='GET'?url.searchParams.get('ticket'):body.ticket;
    if(!validTicket(ticket))return json({error:'Invalid ticket'},400);
    if(url.pathname==='/join'){
      if(!data.players[ticket]) {
        if(Object.keys(data.players).length>=400)return json({error:'Lobby is busy'},429);
        data.players[ticket]={time:now,status:'waiting'};
        data.queue.push(ticket);
      }
      // Group the oldest three independent tickets into a single match.
      while(data.queue.length>=3){
        const group=data.queue.splice(0,3);
        const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
        const room='tgo-'+[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
        group.forEach((id,seat)=>{
          data.players[id]={...data.players[id],time:now,status:'matched',seat,room,ready:false};
        });
      }
    } else if(!data.players[ticket])return json({error:'Unknown or expired ticket'},404);
    const player=data.players[ticket];
    if(url.pathname==='/ready'){
      if(player.status!=='matched'||player.seat!==0)return json({error:'Not the host'},403);
      player.ready=true;
    }
    if(url.pathname==='/leave') {
      if(player.status==='waiting')data.queue=data.queue.filter(id=>id!==ticket);
      const room=player.room;
      delete data.players[ticket];
      // If the host leaves, remaining guests return to the queue.
      if(room && player.seat===0){
        for(const [id,p] of Object.entries(data.players))if(p.room===room){
          data.players[id]={time:now,status:'waiting'};
          data.queue.push(id);
        }
      }
      await this.ctx.storage.put('lobby',data);
      return json({ok:true,status:'left'});
    }
    player.time=now;
    await this.ctx.storage.put('lobby',data);
    const host=player.status==='matched' && player.seat===0;
    const hostReady=host || Object.values(data.players).some(p=>p.room===player.room&&p.seat===0&&p.ready);
    return json({ok:true,status:player.status,seat:player.seat??null,
      room:player.status==='matched' && hostReady?player.room:null,
      hostReady:!!hostReady,ttlSeconds:180});
  }
}
