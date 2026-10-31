// Authoritative three-player peer connection; a guest never commits a move locally.
export const ONLINE_PROTOCOL=2;
export function validRoom(value){return typeof value==='string' && /^tgo-[a-f0-9]{32}$/i.test(value);}
export function roomLink(url,room){if(!validRoom(room))throw Error('Invalid room');const u=new URL(url);u.searchParams.set('room',room);u.hash='';return u.toString();}
export function loadPeerJS(){
  if(globalThis.Peer)return Promise.resolve(globalThis.Peer);
  if(!globalThis.document)return Promise.reject(Error('Browser required'));
  return new Promise((resolve,reject)=>{
    const el=document.createElement('script');el.src='https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
    el.crossOrigin='anonymous';el.onload=()=>globalThis.Peer?resolve(globalThis.Peer):reject(Error('PeerJS unavailable'));
    el.onerror=()=>reject(Error('ネット接続を確認してください'));document.head.append(el);
  });
}
export function secureToken(){
 const a=new Uint8Array(16);if(!globalThis.crypto?.getRandomValues)throw Error('Secure randomness unavailable');
 globalThis.crypto.getRandomValues(a);return [...a].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function createOnlineSession({Peer,getRecord,applyMove,receiveRecord,receiveDelta=()=>false,onStatus=()=>{},token=secureToken}){
  let peer=null,connection=null,host=false,hostId=null,seat=null,connected=false,peerCount=0;
  let message='未接続';
  const players=new Map(),tokens=new Map();
  const status=()=>({host,seat,room:hostId,connected,players:host?players.size:peerCount,
    ready:connected&&(host?players.size===2:peerCount===2),message});
  const notify=()=>onStatus(status());
  const send=(conn,payload)=>{if(conn?.open)conn.send({...payload,v:ONLINE_PROTOCOL});};
  const sync=(conn)=>send(conn,{type:'sync',record:getRecord(),players:players.size});
  const broadcast=()=>{
    if(!host)return;
    for(const conn of players.values())sync(conn);
    notify();
  };
  const broadcastMove=(action,expected)=>{
    if(!host)return;
    for(const conn of players.values())send(conn,{type:'delta',action,expected,players:players.size});
    notify();
  };
  const close=()=>{
    connection?.close?.();for(const conn of players.values())conn.close?.();
    players.clear();tokens.clear();connection=null;peer?.destroy?.();
    peer=null;host=false;hostId=null;seat=null;connected=false;peerCount=0;message='未接続';notify();
  };
  function hostConn(conn){
    let joined=null;
    conn.on('data',msg=>{
      if(!msg || msg.v!==ONLINE_PROTOCOL)return;
      if(msg.type==='hello'){
        if(joined || !/^[a-f0-9]{32}$/.test(msg.token))return;
        let chosen=tokens.get(msg.token);
        if(!chosen)chosen=![...players.keys()].includes(1)?1:![...players.keys()].includes(2)?2:null;
        if(!chosen){send(conn,{type:'full'});conn.close?.();return;}
        joined={token:msg.token,seat:chosen};
        const previous=players.get(chosen);
        players.set(chosen,conn);tokens.set(msg.token,chosen);
        if(previous && previous!==conn)previous.close?.();
        send(conn,{type:'welcome',seat:chosen,room:hostId,record:getRecord(),players:players.size});
        message='接続人数 '+(players.size+1)+'/3';broadcast();return;
      }
      if(!joined || players.get(joined.seat)!==conn)return;
      if(msg.type==='move' && msg.action && Number.isSafeInteger(msg.expected)){
        if(players.size!==2){send(conn,{type:'error',message:'3人揃うまで開始できません'});return;}
        const res=applyMove(msg.action,joined.seat,msg.expected);
        if(!res.ok){send(conn,{type:'error',message:res.reason});sync(conn);}
      }else if(msg.type==='resync')sync(conn);
      else if(msg.type==='leave')conn.close?.();
    });
    conn.on('close',()=>{
      if(joined && players.get(joined.seat)===conn){
        players.delete(joined.seat);tokens.delete(joined.token);
        message='参加者が切断しました';broadcast();notify();
      }
    });
  }
  function createRoom(room=null){
    close();host=true;seat=0;hostId=room||'tgo-'+token();
    if(!validRoom(hostId))return Promise.reject(Error('Invalid room'));
    const p=peer=new Peer(hostId);p.on('connection',hostConn);
    return new Promise((resolve,reject)=>{
      let done=false;
      const timeout=setTimeout(()=>{if(!done){done=true;reject(Error('部屋作成がタイムアウトしました'));}},20000);
      p.on('open',()=>{if(done)return;done=true;clearTimeout(timeout);connected=true;message='招待リンクを共有してください';notify();resolve(status());});
      p.on('error',e=>{message='接続エラー: '+e.message;notify();if(!done){done=true;clearTimeout(timeout);reject(e);}});
    });
  }
  function joinRoom(room,providedToken=token()){
    if(!validRoom(room))return Promise.reject(Error('無効な部屋IDです'));
    if(!/^[a-f0-9]{32}$/.test(providedToken))return Promise.reject(Error('Invalid token'));
    close();hostId=room;message='接続しています';notify();
    const p=peer=new Peer();
    return new Promise((resolve,reject)=>{
      let done=false;
      const timeout=setTimeout(()=>{if(!done){done=true;reject(Error('ホストへの接続がタイムアウトしました'));}},20000);
      p.on('error',e=>{message='接続エラー: '+e.message;notify();if(!done){done=true;clearTimeout(timeout);reject(e);}});
      p.on('open',()=>{
        const conn=connection=p.connect(room,{reliable:true,serialization:'json'});
        conn.on('open',()=>send(conn,{type:'hello',token:providedToken}));
        conn.on('close',()=>{connected=false;message='接続が切れました';notify();if(!done){done=true;clearTimeout(timeout);reject(Error(message));}});
        conn.on('error',e=>{message=e.message;notify();if(!done){done=true;clearTimeout(timeout);reject(e);}});
        conn.on('data',msg=>{
          if(!msg || msg.v!==ONLINE_PROTOCOL)return;
          if(msg.type==='full'){message='満席です';notify();if(!done){done=true;clearTimeout(timeout);reject(Error(message));}}
          if(msg.type==='welcome'){
            seat=msg.seat;connected=true;peerCount=msg.players||0;
            receiveRecord(msg.record);message='接続しました';notify();
            if(!done){done=true;clearTimeout(timeout);resolve({status:status(),token:providedToken});}
          }else if(msg.type==='sync' && connected){
            peerCount=msg.players;receiveRecord(msg.record);notify();
          }else if(msg.type==='delta' && connected){
            peerCount=msg.players;
            if(!receiveDelta(msg.action,msg.expected))send(conn,{type:'resync'});
            notify();
          }else if(msg.type==='error'){message=String(msg.message).slice(0,120);notify();}
        });
      });
    });
  }
  const submit=(action,expected)=>{
    if(!connected)return {ok:false,reason:'未接続です'};
    if(!status().ready)return {ok:false,reason:'3人揃うまで開始できません'};
    if(!action || !['play','pass'].includes(action.type))return {ok:false,reason:'Invalid action'};
    if(host)return applyMove(action,0,expected);
    if(!connection?.open)return {ok:false,reason:'接続が切れています'};
    send(connection,{type:'move',action,expected});return {ok:true,pending:true};
  };
  return {status,createRoom,joinRoom,submit,broadcast,broadcastMove,close};
}
