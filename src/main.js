import { COLORS, LABELS, pointsOnBoard, pointKey, createGame, play, pass, scores, winner } from './game.js';
import { chooseMove, chooseDifficultyMove, dangerGroups, legalMoves, seededRandom, snapshot } from './agent.js';
import { chooseStrongMove } from './strong-ai.js';

const boardSvg = document.getElementById('board');
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
let spectatorPaused = false, spectatorSpeed = 600, zoomBoard = false;
let replay = null;
const STORAGE = 'three-color-go.v2';

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
function stopBots() { if (botTimer !== null) clearTimeout(botTimer); botTimer=null; }
function visibleState() { return replay ? replay.frames[replay.index] : state; }
function visibleActions() { return replay ? actions.slice(0,replay.index) : actions; }
function getReplayState() {
  return replay ? {active:true,index:replay.index,total:actions.length,state:snapshot(visibleState())}
    : {active:false,index:actions.length,total:actions.length,state:snapshot(state)};
}
function openReplay() {
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
function save() {
  try { localStorage.setItem(STORAGE,JSON.stringify({version:1,mode,radius:state.radius,cpuLevel,showLegal,showDanger,spectatorPaused,spectatorSpeed,zoomBoard,actions})); }
  catch { /* Storage may be blocked in private mode. */ }
}
function commit(result,action, schedule=true) {
  if(replay)return {ok:false,reason:'棋譜再生を終了してから着手してください'};
  if (!result.ok) { msgEl.textContent=result.reason; return {ok:false,reason:result.reason}; }
  stopBots();
  past.push(state); state=result.state; actions.push(action);
  save(); render();
  if (schedule) scheduleBots();
  return {ok:true,captured:result.captured ?? [],state:snapshot(state)};
}
function place(q,r,schedule=true) {
  return commit(play(state,q,r),{type:'play',q,r},schedule);
}
function doPass(schedule=true) { return commit(pass(state),{type:'pass'},schedule); }
function permittedForHuman() { return !replay && (mode==='local' || (mode==='cpu' && state.turn===0)); }
function botMove(random=Math.random) {
  return cpuLevel==='hard' ? chooseStrongMove(state,random) : chooseDifficultyMove(state,random,cpuLevel);
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
function setBoardZoom(enabled) {
  if(typeof enabled!=='boolean')return {ok:false,reason:'拡大表示にはtrue/falseを指定してください'};
  zoomBoard=enabled;save();render();
  if(zoomBoard) {
    boardPanelEl.scrollLeft=(boardPanelEl.scrollWidth-boardPanelEl.clientWidth)/2;
    boardPanelEl.scrollTop=(boardPanelEl.scrollHeight-boardPanelEl.clientHeight)/2;
  }
  return {ok:true,zoom:zoomBoard};
}
function scheduleBots() {
  stopBots();
  if (replay || state.ended || !((mode==='cpu'&&state.turn!==0)||
      (mode==='bots'&&!spectatorPaused))) return;
  botTimer=setTimeout(()=>{
    botTimer=null;
    const move=botMove();
    if (move) place(move.q,move.r); else doPass();
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
function drawBoard() {
  const view=visibleState();
  const xExtent=SIZE*ROOT3*view.radius+SIZE+4;
  const yExtent=SIZE*1.5*view.radius+SIZE+4;
  boardSvg.setAttribute('viewBox',[-xExtent,-yExtent,2*xExtent,2*yExtent].join(' '));
  const enlarged=zoomBoard && view.radius>=8;
  boardSvg.style.width=enlarged ? Math.max(700,Math.round(xExtent*1.7))+'px' : '100%';
  boardSvg.style.maxHeight=enlarged ? 'none' : '65vh';
  boardSvg.replaceChildren();
  const hints=boardHints();
  const legalKeys=new Set(hints.legal.map(p=>pointKey(p.q,p.r)));
  const dangerKeys=showDanger ? new Set(hints.dangerGroups.flatMap(g=>g.stones)) : new Set();
  const lastKey=hints.lastMove ? pointKey(hints.lastMove.q,hints.lastMove.r) : null;
  for (const {q,r} of pointsOnBoard(view.radius)) {
    const [x,y]=center(q,r), key=pointKey(q,r),color=view.board[key];
    const g=el('g',{
      class:'cell '+(color?'occupied':''),
      role:'button', tabindex:state.ended?-1:0,
      'data-q':q,'data-r':r,
      'aria-label':q+','+r+' '+(color?LABELS[color]+'石':'空点')
        +(dangerKeys.has(key)?' 危険・呼吸点1':'')
        +(lastKey===key?' 直前の着手':'')
        +(legalKeys.has(key)?' 合法手':'')
    });
    g.appendChild(el('polygon',{points:vertices(x,y),class:'hex'}));
    if (color) g.appendChild(el('circle',{cx:x,cy:y,r:SIZE*.64,class:'piece '+color}));
    if (legalKeys.has(key)) g.appendChild(el('circle',{cx:x,cy:y,r:SIZE*.17,class:'hintLegal'}));
    if (dangerKeys.has(key)) g.appendChild(el('circle',{cx:x,cy:y,r:SIZE*.79,class:'hintDanger'}));
    if (lastKey===key) g.appendChild(el('circle',{cx:x,cy:y,r:SIZE*.91,class:'hintLast'}));
    function activate() {
      if (!permittedForHuman()) {msgEl.textContent=replay?'棋譜を再生中です':'CPUが考えています';return;}
      place(q,r);
    }
    g.addEventListener('click',activate);
    g.addEventListener('keydown',e=>{
      if (e.key==='Enter'||e.key===' ') {e.preventDefault();activate();}
    });
    boardSvg.appendChild(g);
  }
}
function render() {
  const view=visibleState();
  const color=COLORS[view.turn],counts=scores(view);
  turnStoneEl.className='stone '+color;
  turnTextEl.textContent=view.ended?'対局終了':LABELS[color]+'の番'+((mode==='bots'||(mode==='cpu'&&view.turn!==0))?'（CPU）':'');
  turnLabelEl.textContent=replay?'棋譜再生 · '+replay.index+' / '+actions.length+'手':view.ended?'勝敗が決まりました':view.passes+'人連続パス · '+view.moveCount+'手';
  modeEl.value=mode;
  boardSizeEl.value=String(state.radius);
  cpuLevelEl.value=cpuLevel;
  modeEl.disabled=!!replay;
  boardSizeEl.disabled=!!replay;
  cpuLevelEl.disabled=!!replay;
  replayPanelEl.hidden=!replay;
  replayOpenEl.disabled=!!replay || !actions.length;
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
  cpuSettingEl.hidden=mode==='local';
  spectatorControlsEl.hidden=mode!=='bots';
  spectatorToggleEl.textContent=spectatorPaused?'再開':'一時停止';
  spectatorToggleEl.disabled=!!replay||view.ended;
  spectatorStepEl.disabled=!!replay||!spectatorPaused||view.ended;
  spectatorSpeedEl.value=String(spectatorSpeed);
  spectatorSpeedEl.disabled=!!replay;
  boardViewToolsEl.hidden=view.radius<8;
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
  undoBtn.disabled=!!replay || past.length===0;
  resetBtn.disabled=!!replay;
  if (view.ended) {
    const winning=winner(view).map(c=>LABELS[c]).join('・');
    msgEl.textContent='終局！ '+winning+(winner(view).length>1?'が同点':'の勝利')+'。黒 '+counts.black+' / 白 '+counts.white+' / 赤 '+counts.red+' 石';
  } else {
    msgEl.textContent=replay?'棋譜を再生中です · 対局は一時停止しています':view.lastAction;
  }
}
function reset({radius=state.radius,nextMode=mode,nextLevel=cpuLevel}={}) {
  if (!['cpu','local','bots'].includes(nextMode)) return {ok:false,reason:'不明なモード'};
  if (!['easy','normal','hard'].includes(nextLevel)) return {ok:false,reason:'不明なCPU難易度'};
  let next;
  try {next=createGame(radius);} catch(e) {return {ok:false,reason:e.message};}
  stopBots();
  replay=null;state=next;
  mode=nextMode;cpuLevel=nextLevel;spectatorPaused=false;zoomBoard=radius>=8;
  past=[];actions=[];save();render();scheduleBots();
  return {ok:true,state:snapshot(state)};
}
function undo() {
  if(replay)return {ok:false,reason:'棋譜再生中は戻せません'};
  stopBots();
  if (!past.length) return {ok:false,reason:'戻せる手がありません'};
  do {
    state=past.pop();actions.pop();
  } while (mode==='cpu' && past.length && state.turn!==0);
  save();render();scheduleBots();
  return {ok:true,state:snapshot(state)};
}
function loadRecord(record,{resumeSavedBots=false}={}) {
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
  const nextMode=['cpu','local','bots'].includes(record.mode)?record.mode:'local';
  const nextLevel=['easy','normal','hard'].includes(record.cpuLevel)?record.cpuLevel:cpuLevel;
  const nextShowLegal=typeof record.showLegal==='boolean'?record.showLegal:showLegal;
  const nextShowDanger=typeof record.showDanger==='boolean'?record.showDanger:showDanger;
  stopBots();
  replay=null;
  state=next;mode=nextMode;cpuLevel=nextLevel;
  spectatorSpeed=[180,600,1200].includes(record.spectatorSpeed)?record.spectatorSpeed:600;
  spectatorPaused=nextMode==='bots' ? (!resumeSavedBots || record.spectatorPaused===true) : false;
  zoomBoard=typeof record.zoomBoard==='boolean'?record.zoomBoard:state.radius>=8;
  showLegal=nextShowLegal;showDanger=nextShowDanger;past=states;actions=normalized;
  save();render();scheduleBots();
  return {ok:true,state:snapshot(state)};
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
passBtn.addEventListener('click',()=>{if (permittedForHuman()) doPass();});
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
  version: '0.8',
  getState: ()=>snapshot(state),
  getReplayState,
  openReplay,
  seekReplay,
  closeReplay,
  legalMoves: ()=>legalMoves(state),
  getPresentation: ()=>({
    mode,cpuLevel,showLegal,showDanger,replay:!!replay,
    spectatorPaused,spectatorSpeed,zoomBoard,
    ...boardHints()
  }),
  setHints,
  setCpuLevel,
  pauseBots,
  resumeBots,
  stepBot,
  setSpectatorSpeed,
  setBoardZoom,
  play: (q,r)=>place(q,r),
  pass: ()=>doPass(),
  undo,
  reset: (options={})=>reset({radius:options.radius??state.radius,nextMode:options.mode??'local',nextLevel:options.cpuLevel??cpuLevel}),
  setMode: (next)=>reset({radius:state.radius,nextMode:next}),
  exportRecord: ()=>({version:1,radius:state.radius,mode,cpuLevel,showLegal,showDanger,spectatorPaused,spectatorSpeed,zoomBoard,actions:actions.map(a=>({...a}))}),
  importRecord: loadRecord,
  autoPlay: (limit=100,seed=1)=>{
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

render();restore();scheduleBots();
