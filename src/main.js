import { COLORS, LABELS, pointsOnBoard, pointKey, createGame, play, pass, scores, winner } from './game.js';
import { chooseMove, chooseDifficultyMove, dangerGroups, legalMoves, seededRandom, snapshot } from './agent.js';
import { chooseStrongMove } from './strong-ai.js';
import { analyzeRecord, formatAnalysis, explainPosition } from './insights.js';
import { createOnlineSession, loadPeerJS, roomLink, validRoom, secureToken } from './online.js';
import { makeMatchmaker } from './matchmaking.js';

const boardSvg = document.getElementById('board');
const onlinePanelEl=document.getElementById('onlinePanel');
const onlineCreateEl=document.getElementById('onlineCreate');
const onlineRandomEl=document.getElementById('onlineRandom');
const onlineCancelEl=document.getElementById('onlineCancel');
const matchEndpointEl=document.getElementById('matchEndpoint');
const importRecordEl=document.getElementById('importRecord');
const matchListEl=document.getElementById('matchList');
const importFileEl=document.getElementById('importFile');
const loadMatchEl=document.getElementById('loadMatch');
const onlineJoinEl=document.getElementById('onlineJoin');
const onlineLeaveEl=document.getElementById('onlineLeave');
const onlineRoomEl=document.getElementById('onlineRoom');
const onlineCopyEl=document.getElementById('onlineCopy');
const onlineStatusEl=document.getElementById('onlineStatus');
const moveConfirmEl=document.getElementById('moveConfirm');
const moveCancelEl=document.getElementById('moveCancel');
const copyRecordEl=document.getElementById('copyRecord');
const copyAnalysisEl=document.getElementById('copyAnalysis');
const studyPanelEl=document.getElementById('studyPanel');
const studyTextEl=document.getElementById('studyText');
const lastMoveJumpEl=document.getElementById('lastMoveJump');
const boardPanelEl = document.getElementById('boardPanel');
const boardViewToolsEl = document.getElementById('boardViewTools');
const boardZoomEl = document.getElementById('boardZoom');
const spectatorControlsEl = document.getElementById('spectatorControls');
const spectatorToggleEl = document.getElementById('spectatorToggle');
const spectatorStepEl = document.getElementById('spectatorStep');
const spectatorSpeedEl = document.getElementById('spectatorSpeed');
const countsEl = document.getElementById('counts');
const turnStoneEl = document.getElementById('turnStone');
const turnTextEl = document.getElementById('turnText');
const turnLabelEl = document.getElementById('turnLabel');
const msgEl = document.getElementById('message');
const modeEl = document.getElementById('mode');
const boardSizeEl = document.getElementById('boardSize');
const replayOpenEl = document.getElementById('replayOpen');
const replayPanelEl = document.getElementById('replayPanel');
const replaySliderEl = document.getElementById('replaySlider');
const replayLabelEl = document.getElementById('replayLabel');
const replayStartEl = document.getElementById('replayStart');
const replayPrevEl = document.getElementById('replayPrev');
const replayNextEl = document.getElementById('replayNext');
const replayEndEl = document.getElementById('replayEnd');
const replayCloseEl = document.getElementById('replayClose');
const cpuLevelEl = document.getElementById('cpuLevel');
const cpuSettingEl = document.getElementById('cpuSetting');
const legalToggleEl = document.getElementById('legalToggle');
const dangerToggleEl = document.getElementById('dangerToggle');
const passBtn = document.getElementById('passBtn');
const undoBtn = document.getElementById('undoBtn');
const resetBtn = document.getElementById('resetBtn');

const SIZE = 29, ROOT3 = Math.sqrt(3);
let state = createGame(4);
let mode = 'cpu', past = [], actions = [], botTimer = null;
let cpuLevel = 'hard', showLegal = false, showDanger = true;
let spectatorPaused = false, spectatorSpeed = 600, zoomBoard = false, zoomBoardExplicit = false;
let replay = null, network = null, netMessage = '部屋を作るか招待URLで参加してください';
let pendingMove = null, pinchStart = null, zoomScale = 1;
let matchCancellation=null, matchTicket=null, currentMatchId=null;
let randomAttempt=null, keyboardFocusKey='0,0', suppressBoardClickUntil=0;
let aiWorker=null, aiGeneration=0;
let lastCpuDecision = null;
const MAX_ONLINE_ACTIONS=1800;
const STORAGE = 'three-color-go.v2';
const ONLINE_STORAGE = 'three-color-go.online.v1';
const MATCH_INDEX = 'three-color-go.matches.v1';
const MATCH_PREFIX='three-color-go.match.';
const MATCH_ENDPOINT_KEY='three-color-go.matchmaker-url';
const MATCH_TIMEOUT=150000;
let randomMatching=false, saveWarning=false;

function center(q,r) { return [SIZE*ROOT3*(q+r/2), SIZE*1.5*r]; }
function vertices(x,y) {
  return Array.from({length:6},(_,i)=>{
    const a = (Math.PI/180)*(60*i-90);
    return (x+SIZE*Math.cos(a)).toFixed(2)+','+(y+SIZE*Math.sin(a)).toFixed(2);
  }).join(' ');
}
function el(name,attrs={}) {
  const node=document.createElementNS('http://www.w3.org/2000/svg',name);
  Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,String(v)));
  return node;
}
function stopBots(){
  aiGeneration++;
  if(botTimer!==null)clearTimeout(botTimer);
  botTimer=null;
}
function visibleState() { return replay ? replay.frames[replay.index] : state; }
function visibleActions() { return replay ? actions.slice(0,replay.index) : actions; }
function getReplayState() {
  return replay ? {active:true,index:replay.index,total:actions.length,state:snapshot(visibleState())}
    : {active:false,index:actions.length,total:actions.length,state:snapshot(state)};
}
function openReplay() {
  if(mode==='online')return {ok:false,reason:'オンライン対局中は棋譜を再生できません'};
  if(replay) return {ok:true,...getReplayState()};
  if(!actions.length)return {ok:false,reason:'まだ棋譜がありません'};
  stopBots();
  replay={frames:[...past,state],index:actions.length};
  render();
  return {ok:true,...getReplayState()};
}
function seekReplay(index) {
  if(!replay) return {ok:false,reason:'再生を開始してください'};
  if(!Number.isInteger(index)||index<0||index>actions.length)
    return {ok:false,reason:'再生位置が不正です'};
  replay.index=index;render();
  return {ok:true,...getReplayState()};
}
function closeReplay() {
  if(!replay) return {ok:false,reason:'再生していません'};
  replay=null;render();scheduleBots();
  return {ok:true,...getReplayState()};
}
function record() {
  return {version:1,radius:state.radius,mode,cpuLevel,showLegal,showDanger,
    spectatorPaused,spectatorSpeed,zoomBoard,zoomBoardExplicit,
    zoomScale,actions:actions.map(a=>({...a}))};
}
function onlineStatus() {return network?network.status():{host:false,seat:null,room:null,connected:false,ready:false,message:netMessage};}
function isGuest() {return mode==='online' && !network?.status().host;}
function applyNetworkMove(action,seat,expected) {
  if(mode!=='online' || !network?.status().host || state.ended || replay)
    return {ok:false,reason:'オンライン対局を操作できません'};
  if(expected!==state.moveCount || state.turn!==seat)
    return {ok:false,reason:'手番が違うため、同期を待ってください'};
  if(!action||!['play','pass'].includes(action.type))
    return {ok:false,reason:'不明な着手'};
  if(action.type==='play')return place(action.q,action.r);
  return doPass();
}
function syncOnlineDelta(action,expected){
  if(mode!=='online'||network?.status().host||replay||expected!==state.moveCount)return false;
  if(!action||!['play','pass'].includes(action.type))return false;
  const result=action.type==='pass'?pass(state):play(state,action.q,action.r);
  if(!result.ok)return false;
  past.push(state);state=result.state;
  actions.push(action.type==='pass'?{type:'pass'}:{type:'play',q:action.q,r:action.r});
  pendingMove=null;save();render();return true;
}
function syncOnlineRecord(remote) {
  if(!remote||!Array.isArray(remote.actions)||remote.actions.length>MAX_ONLINE_ACTIONS)return;
  const result=loadRecord({...remote,mode:'online'},{networkSync:true});
  if(!result.ok)netMessage='同期に失敗しました: '+result.reason;
}
function networkChanged(status) {
  netMessage=status.message;
  onlineStatusEl.textContent=status.message+
    (status.host?' · 参加人数 '+(status.players+1)+'/3':'');
  if(mode==='online')render();
}
async function ensureNetwork() {
  if(network)return network;
  const Peer=await loadPeerJS();
  network=createOnlineSession({
    Peer,getRecord:record,applyMove:applyNetworkMove,
    receiveRecord:syncOnlineRecord,receiveDelta:syncOnlineDelta,onStatus:networkChanged
  });
  return network;
}
function sendOnlineAction(action) {
  if(!network)return {ok:false,reason:'部屋に接続していません'};
  return network.submit(action,state.moveCount);
}
async function copyString(value) {
  try {await navigator.clipboard.writeText(value);return true;}
  catch {
    // Clipboard can be denied on HTTP/file URLs; let the user copy manually.
    prompt('内容をコピーしてください',value);
    return false;
  }
}
function save(){
  try{
    const data=JSON.stringify(record());
    localStorage.setItem(mode==='online'?ONLINE_STORAGE:STORAGE,data);
    if(mode!=='online'&&actions.length){
      if(!currentMatchId)currentMatchId='m-'+Date.now().toString(36)+'-'+secureToken().slice(0,8);
      localStorage.setItem(MATCH_PREFIX+currentMatchId,data);
      const ids=JSON.parse(localStorage.getItem(MATCH_INDEX)||'[]').filter(id=>id!==currentMatchId);
      ids.unshift(currentMatchId);
      const old=ids.splice(30);
      old.forEach(id=>localStorage.removeItem(MATCH_PREFIX+id));
      localStorage.setItem(MATCH_INDEX,JSON.stringify(ids));
    }
    saveWarning=false;
  }catch{saveWarning=true;}
}
function commit(result,action, schedule=true) {
  if(replay)return {ok:false,reason:'棋譜再生を終了してから着手してください'};
  if (!result.ok) { msgEl.textContent=result.reason; return {ok:false,reason:result.reason}; }
  stopBots();
  const expected=state.moveCount;
  past.push(state); state=result.state; actions.push(action);pendingMove=null;
  save(); render();updateMatchList();
  if(mode==='online' && network?.status().host)network.broadcastMove(action,expected);
  if (schedule) scheduleBots();
  return {ok:true,captured:result.captured ?? [],state:snapshot(state)};
}
function place(q,r,schedule=true) {
  return commit(play(state,q,r),{type:'play',q,r},schedule);
}
function doPass(schedule=true) { return commit(pass(state),{type:'pass'},schedule); }
function permittedForHuman() {
  if(replay)return false;
  if(mode==='local')return true;
  if(mode==='cpu')return state.turn===0;
  if(mode==='online') {
    const info=onlineStatus();
    return info.connected && info.ready && info.seat===state.turn;
  }
  return false;
}
function botMove(random=Math.random) {
  if(cpuLevel!=='hard')return chooseDifficultyMove(state,random,cpuLevel);
  const candidates=[];
  const chosen=chooseStrongMove(state,random,candidates);
  lastCpuDecision={turn:state.moveCount+1,color:COLORS[state.turn],
    chosen,candidates,notes:'3手読みの相対評価値（勝率ではありません）'};
  return chosen;
}
function pauseBots() {
  if(mode!=='bots')return {ok:false,reason:'CPU3人の対局モードではありません'};
  spectatorPaused=true;stopBots();save();render();
  return {ok:true,paused:true};
}
function resumeBots() {
  if(mode!=='bots'||replay)return {ok:false,reason:'再開できません'};
  spectatorPaused=false;save();render();scheduleBots();
  return {ok:true,paused:false};
}
function stepBot() {
  if(mode!=='bots'||!spectatorPaused||replay||state.ended)
    return {ok:false,reason:'一時停止中のCPU3人対局だけ1手進められます'};
  const move=botMove();
  return move?place(move.q,move.r):doPass();
}
function setSpectatorSpeed(value) {
  const n=Number(value);
  if(![180,600,1200].includes(n))return {ok:false,reason:'不明な対局速度'};
  spectatorSpeed=n;save();render();scheduleBots();
  return {ok:true,speed:n};
}
function centerBoard() {
  boardPanelEl.scrollLeft=Math.max(0,(boardPanelEl.scrollWidth-boardPanelEl.clientWidth)/2);
  boardPanelEl.scrollTop=Math.max(0,(boardPanelEl.scrollHeight-boardPanelEl.clientHeight)/2);
}
function setBoardZoom(enabled) {
  if(typeof enabled!=='boolean')return {ok:false,reason:'拡大表示にはtrue/falseを指定してください'};
  zoomBoard=enabled;zoomBoardExplicit=true;zoomScale=1;save();render();
  if(zoomBoard)centerBoard();
  return {ok:true,zoom:zoomBoard};
}
function scheduleBots(){
  stopBots();
  if(replay||state.ended||!((mode==='cpu'&&state.turn!==0)||(mode==='bots'&&!spectatorPaused)))return;
  const generation=aiGeneration;
  botTimer=setTimeout(()=>{
    botTimer=null;
    if(cpuLevel!=='hard'||typeof Worker==='undefined'||location.protocol==='file:'){
      const move=botMove();if(move)place(move.q,move.r);else doPass();return;
    }
    try{
      if(!aiWorker){
        aiWorker=new Worker(new URL('./src/ai-worker.js',location.href),{type:'module'});
        aiWorker.onerror=()=>{
          aiWorker?.terminate();aiWorker=null;
          if(generation===aiGeneration) {
            const move=botMove();if(move)place(move.q,move.r);else doPass();
          }
        };
      }
      aiWorker.onmessage=e=>{
        if(generation!==aiGeneration||e.data?.generation!==aiGeneration)return;
        const {move,decision,error}=e.data||{};
        if(error){msgEl.textContent='CPUエラー: '+error;return;}
        if(decision)lastCpuDecision=decision;
        if(move)place(move.q,move.r);else doPass();
      };
      aiWorker.postMessage({state,level:cpuLevel,generation});
    }catch{
      const move=botMove();if(move)place(move.q,move.r);else doPass();
    }
  },mode==='bots'?spectatorSpeed:240);
}
function mostRecentMove(view=visibleState(),sequence=visibleActions()) {
  // A played stone can later be captured; never highlight an empty cell.
  for (let i=sequence.length-1; i>=0; i--) {
    const action=sequence[i];
    if (action.type!=='play') continue;
    return view.board[pointKey(action.q,action.r)]===COLORS[i%3]
      ? {q:action.q,r:action.r} : null;
  }
  return null;
}
function boardHints() {
  const view=visibleState();
  const threats=dangerGroups(view);
  const lastMove=mostRecentMove(view,visibleActions());
  return {
    lastMove,
    dangerGroups:threats,
    legal: showLegal && !view.ended && !replay ? legalMoves(view) : []
  };
}
function setHints(options={}) {
  if (typeof options!=='object' || !options ||
      ('legal' in options && typeof options.legal!=='boolean') ||
      ('danger' in options && typeof options.danger!=='boolean')) {
    return {ok:false,reason:'表示設定にはtrue/falseを指定してください'};
  }
  if('legal' in options)showLegal=options.legal;
  if('danger' in options)showDanger=options.danger;
  save();render();
  return {ok:true,legal:showLegal,danger:showDanger};
}
function setCpuLevel(value) {
  if (!['easy','normal','hard'].includes(value))
    return {ok:false,reason:'不明なCPU難易度'};
  cpuLevel=value;
  save();render();scheduleBots();
  return {ok:true,cpuLevel};
}
let renderedRadius=null;
const cellCache=new Map();
function drawBoard(){
  const view=visibleState();
  const xExtent=SIZE*ROOT3*view.radius+SIZE+4;
  const yExtent=SIZE*1.5*view.radius+SIZE+4;
  boardSvg.setAttribute('viewBox',[-xExtent,-yExtent,2*xExtent,2*yExtent].join(' '));
  boardSvg.style.width=zoomBoard?Math.round(Math.max(700,xExtent*1.7)*zoomScale)+'px':'100%';
  boardSvg.style.maxHeight=zoomBoard?'none':'65vh';
  if(renderedRadius!==view.radius){
    renderedRadius=view.radius;cellCache.clear();boardSvg.replaceChildren();
  }
  const hints=boardHints();
  const legal=new Set(hints.legal.map(p=>pointKey(p.q,p.r)));
  const danger=showDanger?new Set(hints.dangerGroups.flatMap(g=>g.stones)):new Set();
  const last=hints.lastMove?pointKey(hints.lastMove.q,hints.lastMove.r):null;
  for(const {q,r} of pointsOnBoard(view.radius)){
    const key=pointKey(q,r),color=view.board[key]||'';
    const selected=!!pendingMove&&pendingMove.q===q&&pendingMove.r===r;
    const signature=[color,legal.has(key),danger.has(key),last===key,selected,view.ended].join('|');
    let item=cellCache.get(key);
    if(!item){
      const g=el('g',{class:'cell',role:'button','data-q':q,'data-r':r,tabindex:0});
      const activate=()=>{
        if(Date.now()<suppressBoardClickUntil)return;
        if(!permittedForHuman()){
          msgEl.textContent=replay?'棋譜を再生中です':mode==='online'?'接続と自分の手番を確認してください':'CPUの手番です';
          return;
        }
        if(visibleState().radius>=8 && (!pendingMove||pendingMove.q!==q||pendingMove.r!==r)){
          pendingMove={q,r};moveConfirmEl.hidden=false;
          moveConfirmEl.firstChild.textContent=' ('+q+','+r+') をもう一度タップして着手 ';
          drawBoard();return;
        }
        pendingMove=null;moveConfirmEl.hidden=true;
        if(mode==='online'){
          const outcome=sendOnlineAction({type:'play',q,r});
          if(!outcome.ok)msgEl.textContent=outcome.reason;
        }else place(q,r);
      };
      g.addEventListener('click',activate);
      g.addEventListener('focus',()=>{
        keyboardFocusKey=key;
        for(const [name,cell] of cellCache)cell.g.setAttribute('tabindex',name===key?'0':'-1');
      });
      g.addEventListener('keydown',e=>{
        if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();return;}
        const dir={'ArrowRight':[1,0],'ArrowLeft':[-1,0],
          'ArrowUp':[0,-1],'ArrowDown':[0,1]}[e.key];
        if(dir){
          const next=cellCache.get(pointKey(q+dir[0],r+dir[1]))?.g;
          if(next){e.preventDefault();next.focus();}
        }
      });
      item={g,signature:null};cellCache.set(key,item);boardSvg.appendChild(g);
    }
    if(item.signature===signature)continue;
    item.signature=signature;
    const g=item.g,[x,y]=center(q,r);
    g.setAttribute('class','cell '+(color?'occupied':''));
    g.setAttribute('tabindex',view.ended||key!==keyboardFocusKey?'-1':'0');
    g.setAttribute('aria-label',q+','+r+' '+(color?LABELS[color]+'石':'空点')
      +(danger.has(key)?' 危険・呼吸点1':'')+(last===key?' 直前の着手':'')
      +(legal.has(key)?' 合法手':''));
    const children=[el('polygon',{points:vertices(x,y),class:'hex'})];
    if(color)children.push(el('circle',{cx:x,cy:y,r:SIZE*.64,class:'piece '+color}));
    if(legal.has(key))children.push(el('circle',{cx:x,cy:y,r:SIZE*.17,class:'hintLegal'}));
    if(danger.has(key))children.push(el('circle',{cx:x,cy:y,r:SIZE*.79,class:'hintDanger'}));
    if(last===key)children.push(el('circle',{cx:x,cy:y,r:SIZE*.91,class:'hintLast'}));
    if(selected)children.push(el('circle',{cx:x,cy:y,r:SIZE*.95,class:'hintSelected'}));
    g.replaceChildren(...children);
  }
}
function render() {
  const view=visibleState();
  const color=COLORS[view.turn],counts=scores(view);
  turnStoneEl.className='stone '+color;
  turnTextEl.textContent=view.ended?'対局終了':LABELS[color]+'の番'+((mode==='bots'||(mode==='cpu'&&view.turn!==0))?'（CPU）':'')+(mode==='online'?' · オンライン':'');
  turnLabelEl.textContent=replay?'棋譜再生 · '+replay.index+' / '+actions.length+'手':view.ended?'勝敗が決まりました':view.passes+'人連続パス · '+view.moveCount+'手';
  modeEl.value=mode;
  boardSizeEl.value=String(state.radius);
  cpuLevelEl.value=cpuLevel;
  modeEl.disabled=!!replay;
  boardSizeEl.disabled=!!replay;
  cpuLevelEl.disabled=!!replay;
  replayPanelEl.hidden=!replay;
  replayOpenEl.disabled=!!replay || !actions.length || mode==='online';
  if(replay) {
    replaySliderEl.max=String(actions.length);
    replaySliderEl.value=String(replay.index);
    const move=replay.index?actions[replay.index-1]:null;
    replayLabelEl.textContent=replay.index+' / '+actions.length+'手 · '+(
      !move?'開始局面':move.type==='pass'?'パス':COLORS[(replay.index-1)%3]+
      ' ('+move.q+','+move.r+')');
    replayStartEl.disabled=replay.index===0;
    replayPrevEl.disabled=replay.index===0;
    replayNextEl.disabled=replay.index===actions.length;
    replayEndEl.disabled=replay.index===actions.length;
  }
  cpuSettingEl.hidden=mode==='local'||mode==='online';
  onlinePanelEl.hidden=mode!=='online';
  const session=onlineStatus();
  onlineStatusEl.textContent=netMessage+(mode==='online'&&session.host?' · 参加人数 '+(session.players+1)+'/3':'');
  onlineCopyEl.disabled=!session.room||!session.host;
  onlineCreateEl.disabled=session.connected || !!replay || randomMatching;
  onlineRandomEl.disabled=session.connected || !!replay || randomMatching;
  onlineCancelEl.hidden=!randomMatching;
  matchEndpointEl.disabled=randomMatching;
  onlineJoinEl.disabled=session.connected || !!replay || randomMatching;
  onlineLeaveEl.disabled=mode!=='online'||(!network&&!randomMatching);
  boardSizeEl.disabled=!!replay || isGuest();
  spectatorControlsEl.hidden=mode!=='bots';
  spectatorToggleEl.textContent=spectatorPaused?'再開':'一時停止';
  spectatorToggleEl.disabled=!!replay||view.ended;
  spectatorStepEl.disabled=!!replay||!spectatorPaused||view.ended;
  spectatorSpeedEl.value=String(spectatorSpeed);
  spectatorSpeedEl.disabled=!!replay;
  boardViewToolsEl.hidden=view.radius<8 && !zoomBoard;
  boardZoomEl.textContent=zoomBoard?'全体表示にする':'拡大して操作';
  boardZoomEl.setAttribute('aria-pressed',String(zoomBoard));
  legalToggleEl.textContent='合法手を表示: '+(showLegal?'ON':'OFF');
  dangerToggleEl.textContent='危険な石を表示: '+(showDanger?'ON':'OFF');
  legalToggleEl.setAttribute('aria-pressed',String(showLegal));
  dangerToggleEl.setAttribute('aria-pressed',String(showDanger));
  countsEl.replaceChildren();
  for (const c of COLORS) {
    const item=document.createElement('div');item.className='count';
    const small=document.createElement('small');small.textContent=LABELS[c];
    const strong=document.createElement('strong');strong.textContent=counts[c];
    const dot=document.createElement('span');dot.className='stone tiny '+c;
    item.append(dot,small,strong);countsEl.append(item);
  }
  drawBoard();
  passBtn.disabled=view.ended || !permittedForHuman();
  moveConfirmEl.hidden=!pendingMove || view.ended;
  undoBtn.disabled=!!replay || mode==='online' || past.length===0;
  resetBtn.disabled=!!replay || isGuest();
  if (view.ended) {
    const winning=winner(view).map(c=>LABELS[c]).join('・');
    msgEl.textContent='終局！ '+winning+(winner(view).length>1?'が同点':'の勝利')+'。黒 '+counts.black+' / 白 '+counts.white+' / 赤 '+counts.red+' 石';
  } else {
    msgEl.textContent=replay?'棋譜を再生中です · 対局は一時停止しています':view.lastAction;
  }
  if(saveWarning)msgEl.textContent+=' · ⚠保存できません（ストレージ容量・権限を確認）';
}
function reset({radius=state.radius,nextMode=mode,nextLevel=cpuLevel}={}) {
  if (!['cpu','local','bots','online'].includes(nextMode)) return {ok:false,reason:'不明なモード'};
  if (!['easy','normal','hard'].includes(nextLevel)) return {ok:false,reason:'不明なCPU難易度'};
  let next;
  try {next=createGame(radius);} catch(e) {return {ok:false,reason:e.message};}
  stopBots();
  if(nextMode!=='online'){
    matchCancellation?.();releaseMatchTicket();
    if(mode==='online'){network?.close();network=null;}
  }
  replay=null;state=next;keyboardFocusKey='0,0';
  mode=nextMode;cpuLevel=nextLevel;spectatorPaused=false;zoomBoard=false;zoomBoardExplicit=false;
  past=[];actions=[];pendingMove=null;lastCpuDecision=null;currentMatchId=null;save();render();if(zoomBoard)centerBoard();scheduleBots();
  if(nextMode==='online'&&network?.status().host)network.broadcast();
  updateMatchList();
  return {ok:true,state:snapshot(state)};
}
function undo() {
  if(mode==='online')return {ok:false,reason:'オンライン対局のUndoは未対応です'};
  if(replay)return {ok:false,reason:'棋譜再生中は戻せません'};
  stopBots();
  if (!past.length) return {ok:false,reason:'戻せる手がありません'};
  do {
    state=past.pop();actions.pop();
  } while (mode==='cpu' && past.length && state.turn!==0);
  save();render();scheduleBots();
  return {ok:true,state:snapshot(state)};
}
function loadRecord(record,{resumeSavedBots=false,networkSync=false}={}) {
  if (!record || !Array.isArray(record.actions)) return {ok:false,reason:'actions配列がありません'};
  let next;
  try {next=createGame(record.radius ?? 4);} catch(e){return {ok:false,reason:e.message};}
  const states=[], normalized=[];
  if (record.actions.length>2000) return {ok:false,reason:'手数が多すぎます'};
  for (const action of record.actions) {
    if (!action || !['play','pass'].includes(action.type)) return {ok:false,reason:'未知の手です'};
    const result=action.type==='pass'?pass(next):play(next,action.q,action.r);
    if (!result.ok) return {ok:false,reason:'棋譜の'+(normalized.length+1)+'手目: '+result.reason};
    states.push(next);next=result.state;
    normalized.push(action.type==='pass'?{type:'pass'}:{type:'play',q:action.q,r:action.r});
  }
  const nextMode=networkSync?'online':(['cpu','local','bots'].includes(record.mode)?record.mode:'local');
  const nextLevel=['easy','normal','hard'].includes(record.cpuLevel)?record.cpuLevel:cpuLevel;
  const nextShowLegal=typeof record.showLegal==='boolean'?record.showLegal:showLegal;
  const nextShowDanger=typeof record.showDanger==='boolean'?record.showDanger:showDanger;
  stopBots();
  if(mode==='online' && !networkSync){network?.close();network=null;}
  replay=null;
  state=next;mode=nextMode;pendingMove=null;cpuLevel=nextLevel;
  if(!networkSync)currentMatchId=null;
  spectatorSpeed=[180,600,1200].includes(record.spectatorSpeed)?record.spectatorSpeed:600;
  spectatorPaused=nextMode==='bots' ? (!resumeSavedBots || record.spectatorPaused===true) : false;
  // Old saves were automatically zoomed, not necessarily by user choice.
  // Only honor zoom on restore when a v0.8.3+ user explicitly selected it.
  zoomBoardExplicit=record.zoomBoardExplicit===true;
  zoomBoard=zoomBoardExplicit && record.zoomBoard===true;
  zoomScale=typeof record.zoomScale==='number'&&record.zoomScale>=1&&record.zoomScale<=3.5?record.zoomScale:1;
  showLegal=nextShowLegal;showDanger=nextShowDanger;past=states;actions=normalized;
  save();render();if(zoomBoard)centerBoard();scheduleBots();
  return {ok:true,state:snapshot(state)};
}
function updateMatchList(){
  try{
    const ids=JSON.parse(localStorage.getItem(MATCH_INDEX)||'[]');
    const selected=matchListEl.value;
    matchListEl.replaceChildren();
    for(const id of ids){
      const raw=localStorage.getItem(MATCH_PREFIX+id);if(!raw)continue;
      let item;try{item=JSON.parse(raw);}catch{continue;}
      const option=document.createElement('option');
      option.value=id;option.textContent=(item.actions?.length||0)+'手 · '+(3*item.radius*(item.radius+1)+1)+'マス · '+id.slice(2,10);
      matchListEl.append(option);
    }
    if([...matchListEl.options].some(o=>o.value===selected))matchListEl.value=selected;
    loadMatchEl.disabled=!matchListEl.options.length;
  }catch{loadMatchEl.disabled=true;}
}
function restore() {
  try {
    const raw=localStorage.getItem(STORAGE);
    if (!raw) return;
    const record=JSON.parse(raw);
    if (!record || record.version!==1 || !Array.isArray(record.actions)) return;
    // Loading an invalid saved record must not prevent a new match.
    loadRecord(record,{resumeSavedBots:true});
  } catch { /* Ignore invalid / unavailable storage. */ }
}
passBtn.addEventListener('click',()=>{
  if(!permittedForHuman())return;
  if(mode==='online')sendOnlineAction({type:'pass'});else doPass();
});
moveCancelEl.addEventListener('click',()=>{pendingMove=null;moveConfirmEl.hidden=true;drawBoard();});
onlineCreateEl.addEventListener('click',async()=>{
  try{
    const net=await ensureNetwork();
    const info=await net.createRoom();
    reset({nextMode:'online'});
    onlineRoomEl.value=roomLink(location.href,info.room);
    netMessage='部屋を作成しました。2人にURLを共有してください';
    render();
  }catch(e){netMessage='部屋を作れません: '+e.message;onlineStatusEl.textContent=netMessage;}
});
onlineJoinEl.addEventListener('click',async()=>{
  try{
    const raw=onlineRoomEl.value.trim();
    let room=raw;
    if(raw.startsWith('http'))room=new URL(raw).searchParams.get('room')||'';
    if(!validRoom(room))throw Error('招待URLまたは部屋IDを入力してください');
    const net=await ensureNetwork();
    const key='three-color-go.room.'+room;
    let id;
    try {
      id=sessionStorage.getItem(key);
      if(!/^[0-9a-f]{32}$/.test(id||'')) {
        id=secureToken();sessionStorage.setItem(key,id);
      }
    }catch {id=secureToken();}
    await net.joinRoom(room,id);
    netMessage='参加しました。自分の色の手番で着手できます';
    render();
  }catch(e){netMessage='参加できません: '+e.message;onlineStatusEl.textContent=netMessage;}
});
function releaseMatchTicket(){
  if(!matchTicket)return;
  const active=matchTicket;matchTicket=null;
  active.service.leave(active.ticket).catch(()=>{});
}
onlineLeaveEl.addEventListener('click',()=>{
  matchCancellation?.();releaseMatchTicket();
  network?.close();network=null;reset({nextMode:'local'});
});
onlineCancelEl.addEventListener('click',()=>matchCancellation?.());
matchEndpointEl.value=(()=>{try{return localStorage.getItem(MATCH_ENDPOINT_KEY)||globalThis.THREE_COLOR_MATCH_URL||'';}catch{return globalThis.THREE_COLOR_MATCH_URL||'';}})();
matchEndpointEl.addEventListener('change',()=>{
  try{localStorage.setItem(MATCH_ENDPOINT_KEY,matchEndpointEl.value.trim());}catch{}
});
onlineRandomEl.addEventListener('click',async()=>{
  if(randomMatching || network?.status().connected)return;
  let service;
  try{service=makeMatchmaker(matchEndpointEl.value.trim());}
  catch(e){netMessage=e.message;render();return;}
  try{localStorage.setItem(MATCH_ENDPOINT_KEY,matchEndpointEl.value.trim());}catch{}
  releaseMatchTicket();
  const ticket=secureToken();
  const attempt={ticket,service,cancelled:false,network:null};
  randomAttempt=attempt;randomMatching=true;
  const isActive=()=>randomAttempt===attempt&&!attempt.cancelled;
  const cancel=()=>{
    if(!isActive())return;
    attempt.cancelled=true;randomAttempt=null;randomMatching=false;matchCancellation=null;
    if(network&&network===attempt.network){network.close();network=null;}
    service.leave(ticket).catch(()=>{});
    netMessage='ランダムマッチを中止しました';render();
  };
  matchCancellation=cancel;
  render();
  try{
    let match=await service.join(ticket);
    const start=Date.now();
    while(isActive()&&Date.now()-start<MATCH_TIMEOUT){
      if(match.status==='matched'&&match.room){
        const net=await ensureNetwork();
        attempt.network=net;
        if(!isActive())break;
        if(match.seat===0){
          await net.createRoom(match.room);
          if(!isActive())break;
          reset({nextMode:'online'});
          await service.ready(ticket);
          if(!isActive())break;
          netMessage='3人が見つかりました。オンライン接続を待っています';
          onlineRoomEl.value=roomLink(location.href,match.room);
        }else{
          const id=secureToken();
          await net.joinRoom(match.room,id);
          if(!isActive())break;
          netMessage='ランダムマッチの対局に参加しました';
        }
        matchTicket={ticket,service};
        randomMatching=false;randomAttempt=null;matchCancellation=null;render();return;
      }
      netMessage='対戦相手を探しています…';
      render();
      await new Promise(resolve=>setTimeout(resolve,1600));
      if(!isActive())break;
      match=await service.status(ticket);
    }
    if(isActive())throw Error('時間内に3人揃いませんでした');
  }catch(e){
    if(isActive()){
      netMessage='マッチング失敗: '+e.message;
      if(network&&network===attempt.network){network.close();network=null;}
      randomMatching=false;randomAttempt=null;matchCancellation=null;render();
    }
  }finally{
    if(!matchTicket || matchTicket.ticket!==ticket)
      service.leave(ticket).catch(()=>{});
  }
});
window.addEventListener('pagehide',()=>{
  // sendBeacon remains usable while a tab is being closed.
  const active=matchTicket||randomAttempt;
  if(active && navigator.sendBeacon){
    navigator.sendBeacon(matchEndpointEl.value.trim().replace(/\/$/,'')+'/leave',
      new Blob([JSON.stringify({ticket:active.ticket})],{type:'application/json'}));
  }
});
loadMatchEl.addEventListener('click',()=>{
  try{
    const data=JSON.parse(localStorage.getItem(MATCH_PREFIX+matchListEl.value));
    const result=loadRecord(data);
    if(!result.ok)msgEl.textContent=result.reason;
  }catch(e){msgEl.textContent='対局を読み込めません: '+e.message;}
});
importFileEl.addEventListener('click',()=>importRecordEl.click());
importRecordEl.addEventListener('change',async()=>{
  const file=importRecordEl.files?.[0];if(!file)return;
  try{
    if(file.size>1_000_000)throw Error('ファイルが大きすぎます');
    const data=JSON.parse(await file.text());
    const result=loadRecord(data);
    if(!result.ok)throw Error(result.reason);
    msgEl.textContent='棋譜を復元しました';
  }catch(e){msgEl.textContent='棋譜を読み込めません: '+e.message;}
  importRecordEl.value='';
});
onlineCopyEl.addEventListener('click',async()=>{
  if(network?.status().room && network.status().host)
    await copyString(roomLink(location.href,network.status().room));
});
copyRecordEl.addEventListener('click',async()=>{await copyString(JSON.stringify(record(),null,2));});
document.getElementById('downloadRecord').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(record(),null,2)],{type:'application/json'});
  const uri=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=uri;link.download='three-color-go-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(uri),1000);
});
copyAnalysisEl.addEventListener('click',async()=>{
  try{
    const report=formatAnalysis(analyzeRecord(record()))+
      (lastCpuDecision?'\n\n直近のCPU候補分析:\n'+JSON.stringify(lastCpuDecision,null,2):'');
    studyPanelEl.hidden=false;studyTextEl.textContent=report;
    await copyString(report);
  }catch(e){msgEl.textContent='分析エラー: '+e.message;}
});
lastMoveJumpEl.addEventListener('click',()=>{
  const a=[...actions].reverse().find(x=>x.type==='play');
  if(!a)return;
  if(!zoomBoard)setBoardZoom(true);
  const [x,y]=center(a.q,a.r);
  const bounds=boardSvg.viewBox.baseVal,scale=boardSvg.clientWidth/bounds.width;
  boardPanelEl.scrollLeft=(x-bounds.x)*scale-boardPanelEl.clientWidth/2;
  boardPanelEl.scrollTop=(y-bounds.y)*scale-boardPanelEl.clientHeight/2;
});
boardSvg.addEventListener('touchstart',e=>{
  if(e.touches.length===2){
    const a=e.touches[0],b=e.touches[1];
    pinchStart=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  }
},{passive:true});
boardSvg.addEventListener('touchmove',e=>{
  if(e.touches.length!==2 || !pinchStart)return;
  suppressBoardClickUntil=Date.now()+400;
  e.preventDefault();
  const a=e.touches[0],b=e.touches[1];
  const length=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  const factor=length/pinchStart;pinchStart=length;
  zoomBoard=true;zoomBoardExplicit=true;
  zoomScale=Math.min(3.5,Math.max(1,zoomScale*factor));
  const xExtent=SIZE*ROOT3*state.radius+SIZE+4;
  boardSvg.style.width=Math.round(Math.max(700,xExtent*1.7)*zoomScale)+'px';
  boardSvg.style.maxHeight='none';
  boardViewToolsEl.hidden=false;
  boardZoomEl.textContent='全体表示にする';
  boardZoomEl.setAttribute('aria-pressed','true');
  save();
},{passive:false});
boardSvg.addEventListener('touchend',e=>{if(e.touches.length<2)pinchStart=null;},{passive:true});
spectatorToggleEl.addEventListener('click',()=>spectatorPaused?resumeBots():pauseBots());
spectatorStepEl.addEventListener('click',stepBot);
spectatorSpeedEl.addEventListener('change',()=>setSpectatorSpeed(spectatorSpeedEl.value));
boardZoomEl.addEventListener('click',()=>setBoardZoom(!zoomBoard));
replayOpenEl.addEventListener('click',openReplay);
replayCloseEl.addEventListener('click',closeReplay);
replaySliderEl.addEventListener('input',()=>seekReplay(Number(replaySliderEl.value)));
replayStartEl.addEventListener('click',()=>seekReplay(0));
replayPrevEl.addEventListener('click',()=>seekReplay(replay.index-1));
replayNextEl.addEventListener('click',()=>seekReplay(replay.index+1));
replayEndEl.addEventListener('click',()=>seekReplay(actions.length));
boardSizeEl.addEventListener('change',()=>{
  const radius=Number(boardSizeEl.value);
  if(state.moveCount>0 && !confirm('盤面サイズを変えると対局が最初からになります。よろしいですか？')) {
    boardSizeEl.value=String(state.radius);return;
  }
  const result=reset({radius});
  if(!result.ok){boardSizeEl.value=String(state.radius);msgEl.textContent=result.reason;}
});
undoBtn.addEventListener('click',undo);
resetBtn.addEventListener('click',()=>{
  if (state.moveCount===0 || confirm('対局を最初からやり直しますか？')) reset();
});
cpuLevelEl.addEventListener('change',()=>setCpuLevel(cpuLevelEl.value));
legalToggleEl.addEventListener('click',()=>setHints({legal:!showLegal}));
dangerToggleEl.addEventListener('click',()=>setHints({danger:!showDanger}));
modeEl.addEventListener('change',()=>{
  const chosen=modeEl.value;
  if (state.moveCount>0 && !confirm('モードを変えると対局を最初からやり直します。続けますか？')) {
    modeEl.value=mode;return;
  }
  reset({nextMode:chosen});
});

/** Public browser automation interface. All actions use the same validated game engine as human moves. */
window.threeColorGo = Object.freeze({
  version: '1.4.0',
  getState: ()=>snapshot(state),
  analyze: ()=>analyzeRecord(record()),
  explainPosition: ()=>explainPosition(state),
  getCpuDecision: ()=>lastCpuDecision?structuredClone(lastCpuDecision):null,
  getOnlineStatus: onlineStatus,
  getReplayState,
  openReplay,
  seekReplay,
  closeReplay,
  legalMoves: ()=>legalMoves(state),
  getPresentation: ()=>({
    mode,cpuLevel,showLegal,showDanger,replay:!!replay,
    spectatorPaused,spectatorSpeed,zoomBoard,
    lastCpuDecision,
    ...boardHints()
  }),
  setHints,
  setCpuLevel,
  pauseBots,
  resumeBots,
  stepBot,
  setSpectatorSpeed,
  setBoardZoom,
  play: (q,r)=>mode==='online'?sendOnlineAction({type:'play',q,r}):place(q,r),
  pass: ()=>mode==='online'?sendOnlineAction({type:'pass'}):doPass(),
  undo,
  reset: (options={})=>reset({radius:options.radius??state.radius,nextMode:options.mode??'local',nextLevel:options.cpuLevel??cpuLevel}),
  setMode: (next)=>reset({radius:state.radius,nextMode:next}),
  exportRecord: record,
  importRecord: (value)=>loadRecord(value),
  autoPlay: (limit=100,seed=1)=>{
    if(mode==='online')return {ok:false,reason:'オンライン対局では自動着手できません'};
    if(replay)return {ok:false,reason:'棋譜再生を終了してください'};
    stopBots();
    const rand=seededRandom(seed);
    const count=Math.max(0,Math.min(500,Math.trunc(limit)||0));
    let moves=0;
    while (!state.ended && moves<count) {
      const move=botMove(rand);
      const result=move?place(move.q,move.r,false):doPass(false);
      if (!result.ok) return {ok:false,reason:result.reason,moves};
      moves++;
    }
    scheduleBots();
    return {ok:true,moves,state:snapshot(state)};
  }
});

render();restore();updateMatchList();scheduleBots();
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1')){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
const inviteRoom=new URL(location.href).searchParams.get('room');
if(validRoom(inviteRoom)){
  stopBots();
  mode='online';onlineRoomEl.value=inviteRoom;
  netMessage='招待を受け取りました。「部屋に参加する」を押してください';
  render();
}
