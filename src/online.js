/**
 * Peer-to-peer 3-player room. Host alone applies validated game moves.
 * PeerJS Cloud supplies signaling; a remote TURN relay may be needed on
 * restrictive networks. No user accounts or permanent room backend.
 */
export const ONLINE_PROTOCOL = 1;
export function validRoom(value) {
  return typeof value==='string' && /^tgo-[a-z0-9-]{12,100}$/i.test(value);
}
export function roomLink(url, room) {
  if(!validRoom(room))throw Error('Invalid room');
  const target=new URL(url);
  target.searchParams.set('room',room);
  target.hash='';
  return target.toString();
}
export function loadPeerJS() {
  if(globalThis.Peer)return Promise.resolve(globalThis.Peer);
  if(!globalThis.document)return Promise.reject(Error('Browser required'));
  return new Promise((resolve,reject)=>{
    const el=document.createElement('script');
    el.src='https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
    el.crossOrigin='anonymous';
    el.onload=()=>globalThis.Peer?resolve(globalThis.Peer):reject(Error('PeerJS unavailable'));
    el.onerror=()=>reject(Error('通信ライブラリを読み込めません。ネット接続を確認してください'));
    document.head.append(el);
  });
}
export function secureToken() {
  const a=new Uint8Array(16);
  if(!globalThis.crypto?.getRandomValues)throw Error('Secure randomness unavailable');
  globalThis.crypto.getRandomValues(a);
  return [...a].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function createOnlineSession({
  Peer, getRecord, applyMove, receiveRecord, onStatus=()=>{}, token=secureToken
}) {
  let peer=null,connection=null,host=false,hostId=null,seat=null;
  const players=new Map(), seats=new Map();
  let info='未接続',connected=false;
  const notify=()=>onStatus(status());
  const status=()=>({host,seat,room:hostId,connected,players:players.size,
    message:info,ready:host?players.size===2:connected});
  function send(conn,message) {
    if(conn?.open)conn.send({...message,v:ONLINE_PROTOCOL});
  }
  function broadcast() {
    if(!host)return;
    const record=getRecord();
    for(const conn of players.values())
      send(conn,{type:'sync',record,players:players.size});
    notify();
  }
  function close() {
    if(connection?.open)send(connection,{type:'leave'});
    for(const conn of players.values())conn.close?.();
    players.clear();seats.clear();
    connection?.close?.();connection=null;
    peer?.destroy?.();peer=null;
    connected=false;host=false;hostId=null;seat=null;info='未接続';notify();
  }
  function hostConn(conn) {
    let joinedToken=null;
    conn.on('data',msg=>{
      if(!msg||msg.v!==ONLINE_PROTOCOL||typeof msg.type!=='string')return;
      if(msg.type==='hello') {
        if(joinedToken || !/^[0-9a-f]{32}$/.test(msg.token))return;
        let chosen=seats.get(msg.token);
        if(!chosen) {
          chosen=![...seats.values()].includes(1)?1:
            ![...seats.values()].includes(2)?2:null;
        }
        if(!chosen) {send(conn,{type:'full'});conn.close?.();return;}
        joinedToken=msg.token;
        const old=players.get(chosen);
        if(old && old!==conn)old.close?.();
        seats.set(joinedToken,chosen);players.set(chosen,conn);
        send(conn,{type:'welcome',seat:chosen,room:hostId,record:getRecord()});
        info='接続中: '+(players.size+1)+'/3人';
        broadcast();return;
      }
      if(!joinedToken || players.get(seats.get(joinedToken))!==conn)return;
      const chosen=seats.get(joinedToken);
      if(msg.type==='leave'){
        players.delete(chosen);seats.delete(joinedToken);
        joinedToken=null;conn.close?.();info='参加者が退室しました';notify();return;
      }
      if(msg.type==='move' && msg.action && Number.isSafeInteger(msg.expected)){
        const result=applyMove(msg.action,chosen,msg.expected);
        if(!result.ok)send(conn,{type:'error',message:result.reason});
      }
    });
    conn.on('close',()=>{
      if(joinedToken && players.get(seats.get(joinedToken))===conn) {
        players.delete(seats.get(joinedToken));
        info='参加者が切断しました。再接続を待っています';notify();
      }
    });
  }
  function handleError(e){info='接続エラー: '+(e?.message||String(e));notify();}
  function createRoom() {
    close();
    host=true;seat=0;hostId='tgo-'+token();
    const p=peer=new Peer(hostId);
    p.on('connection',hostConn);
    p.on('error',handleError);
    return new Promise((resolve,reject)=>{
      p.on('open',()=>{
        connected=true;info='部屋を作成しました。URLを共有してください';notify();
        resolve(status());
      });
      p.on('error',e=>{if(!connected)reject(e);});
    });
  }
  function joinRoom(room,providedToken=token()) {
    if(!validRoom(room))return Promise.reject(Error('無効な部屋IDです'));
    if(!/^[0-9a-f]{32}$/.test(providedToken))return Promise.reject(Error('Invalid token'));
    close();host=false;hostId=room;info='ホストに接続しています';notify();
    const p=peer=new Peer();
    p.on('error',handleError);
    return new Promise((resolve,reject)=>{
      p.on('open',()=>{
        const conn=connection=p.connect(room,{reliable:true,serialization:'json'});
        conn.on('open',()=>send(conn,{type:'hello',token:providedToken}));
        conn.on('error',e=>{handleError(e);if(!connected)reject(e);});
        conn.on('close',()=>{connected=false;info='ホストとの接続が切れました';notify();});
        conn.on('data',msg=>{
          if(!msg || msg.v!==ONLINE_PROTOCOL)return;
          if(msg.type==='full'){info='満席です';notify();reject(Error(info));}
          if(msg.type==='welcome'){
            seat=msg.seat;
            if(![1,2].includes(seat))return;
            connected=true;receiveRecord(msg.record);
            info='オンライン対局: '+(seat===1?'白':'赤')+'を担当';
            notify();resolve({status:status(),token:providedToken});
          }
          if(msg.type==='sync' && connected)receiveRecord(msg.record);
          if(msg.type==='error'){info=String(msg.message).slice(0,120);notify();}
        });
      });
      p.on('error',e=>{if(!connected)reject(e);});
    });
  }
  function submit(action,expected) {
    if(!connected)return {ok:false,reason:'未接続です'};
    if(!action || !['play','pass'].includes(action.type))return {ok:false,reason:'Invalid action'};
    if(host)return applyMove(action,0,expected);
    if(!connection?.open)return {ok:false,reason:'接続が切れています'};
    send(connection,{type:'move',action,expected});
    return {ok:true,pending:true};
  }
  return {status,createRoom,joinRoom,submit,broadcast,close};
}
