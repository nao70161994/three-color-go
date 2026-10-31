// Three-player lobby ONLY: moves remain host-authoritative over WebRTC.
// Short leases prevent abandoned tabs from occupying matching seats.
const WAIT_LEASE_MS = 12000;
const MATCH_LEASE_MS = 50000;
const HOST_START_MS = 25000;
const BURST_MS = 60000;
const MAX_JOIN_PER_IP = 12;
const MAX_SEATS_PER_IP = 6;
const validTicket = x => typeof x === 'string' && /^[a-f0-9]{32}$/.test(x);
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS',
  'access-control-allow-headers':'content-type'
}});
const empty = () => ({queue:[],players:{},rates:{}});
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method==='OPTIONS')return json({ok:true});
    if(url.pathname==='/health')return json({ok:true});
    if(!['/join','/status','/ready','/leave'].includes(url.pathname))return json({error:'Not found'},404);
    if((url.pathname==='/status' && request.method!=='GET') ||
       (url.pathname!=='/status' && request.method!=='POST'))return json({error:'Method not allowed'},405);
    if(request.method==='POST' && Number(request.headers.get('content-length')||0)>512)
      return json({error:'Too large'},413);
    const id=env.LOBBY.idFromName('global-v1');
    return env.LOBBY.get(id).fetch(request);
  }
};
export class Matchmaker {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(request) {
    // Serializes the read-modify-write sequence, including overlapping joins.
    return this.ctx.blockConcurrencyWhile
      ? this.ctx.blockConcurrencyWhile(()=>this.handle(request)) : this.handle(request);
  }
  async handle(request) {
    const url=new URL(request.url),now=Date.now();
    const data=(await this.ctx.storage.get('lobby'))||empty();
    data.players ||= {};data.queue ||= [];data.rates ||= {};
    for(const [ip,v] of Object.entries(data.rates))if(now-v.since>BURST_MS)delete data.rates[ip];
    for(const [id,p] of Object.entries(data.players)){
      const ttl=p.status==='waiting'?WAIT_LEASE_MS:MATCH_LEASE_MS;
      if(now-p.time>ttl)delete data.players[id];
    }
    // Guests from a dead or never-ready host return to the waiting queue.
    const rooms=new Map();
    for(const [id,p] of Object.entries(data.players))if(p.status==='matched'){
      if(!rooms.has(p.room))rooms.set(p.room,[]);
      rooms.get(p.room).push([id,p]);
    }
    for(const members of rooms.values()){
      const host=members.find(([,p])=>p.seat===0);
      if(!host || (!host[1].ready && now-host[1].matchedAt>HOST_START_MS)){
        for(const [id,p] of members){
          if(p.seat===0)delete data.players[id];
          else data.players[id]={time:now,status:'waiting',ip:p.ip};
        }
      }
    }
    data.queue=data.queue.filter(id=>data.players[id]?.status==='waiting');
    for(const [id,p] of Object.entries(data.players))
      if(p.status==='waiting'&&!data.queue.includes(id))data.queue.push(id);
    let body={};
    if(request.method==='POST'){
      try {body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
    }
    const ticket=request.method==='GET'?url.searchParams.get('ticket'):body.ticket;
    if(!validTicket(ticket))return json({error:'Invalid ticket'},400);
    if(url.pathname==='/join'&&!data.players[ticket]){
      if(Object.keys(data.players).length>=400)return json({error:'Lobby is busy'},429);
      const ip=request.headers.get('cf-connecting-ip')||'';
      if(ip){
        const rate=data.rates[ip] ||= {since:now,count:0};
        if(rate.count>=MAX_JOIN_PER_IP ||
          Object.values(data.players).filter(p=>p.ip===ip).length>=MAX_SEATS_PER_IP)
          return json({error:'Too many matchmaking requests'},429);
        rate.count++;
      }
      data.players[ticket]={time:now,status:'waiting',ip};
      data.queue.push(ticket);
    } else if(!data.players[ticket]){
      await this.ctx.storage.put('lobby',data);
      return json({error:'Unknown or expired ticket'},404);
    }
    while(data.queue.length>=3){
      const group=data.queue.splice(0,3);
      const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
      const room='tgo-'+[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
      group.forEach((id,seat)=>{data.players[id]={
        ...data.players[id],time:now,matchedAt:now,status:'matched',seat,room,ready:false
      };});
    }
    const player=data.players[ticket];
    if(url.pathname==='/ready'){
      if(player.status!=='matched'||player.seat!==0)return json({error:'Not the host'},403);
      player.ready=true;
    }
    if(url.pathname==='/leave'){
      const room=player.room,wasHost=player.seat===0;
      delete data.players[ticket];
      if(room&&wasHost){
        for(const [id,p] of Object.entries(data.players))if(p.room===room){
          data.players[id]={time:now,status:'waiting',ip:p.ip};
          data.queue.push(id);
        }
      }
      await this.ctx.storage.put('lobby',data);
      return json({ok:true,status:'left'});
    }
    player.time=now;
    await this.ctx.storage.put('lobby',data);
    const host=player.status==='matched'&&player.seat===0;
    const hostReady=host || Object.values(data.players).some(p=>
      p.room===player.room && p.seat===0 && p.ready);
    return json({ok:true,status:player.status,seat:player.seat??null,
      room:player.status==='matched'&&hostReady?player.room:null,
      hostReady:!!hostReady,ttlSeconds:player.status==='waiting'?12:50});
  }
}
