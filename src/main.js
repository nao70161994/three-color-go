import { COLORS, LABELS, pointsOnBoard, pointKey, createGame, play, pass, scores, winner } from './game.js';
import { chooseMove, legalMoves, seededRandom, snapshot } from './agent.js';

const boardSvg = document.getElementById('board');
const countsEl = document.getElementById('counts');
const turnStoneEl = document.getElementById('turnStone');
const turnTextEl = document.getElementById('turnText');
const turnLabelEl = document.getElementById('turnLabel');
const msgEl = document.getElementById('message');
const modeEl = document.getElementById('mode');
const passBtn = document.getElementById('passBtn');
const undoBtn = document.getElementById('undoBtn');
const resetBtn = document.getElementById('resetBtn');

const SIZE = 29, ROOT3 = Math.sqrt(3);
let state = createGame(4);
let mode = 'cpu', past = [], actions = [], botTimer = null;
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
function save() {
  try { localStorage.setItem(STORAGE,JSON.stringify({version:1,mode,radius:state.radius,actions})); }
  catch { /* Storage may be blocked in private mode. */ }
}
function commit(result,action, schedule=true) {
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
function permittedForHuman() { return mode==='local' || state.turn===0; }
function scheduleBots() {
  stopBots();
  if (mode!=='cpu' || state.ended || state.turn===0) return;
  botTimer=setTimeout(()=>{
    botTimer=null;
    const move=chooseMove(state);
    if (move) place(move.q,move.r); else doPass();
  },240);
}
function drawBoard() {
  const xExtent=SIZE*ROOT3*state.radius+SIZE+4;
  const yExtent=SIZE*1.5*state.radius+SIZE+4;
  boardSvg.setAttribute('viewBox',[-xExtent,-yExtent,2*xExtent,2*yExtent].join(' '));
  boardSvg.replaceChildren();
  for (const {q,r} of pointsOnBoard(state.radius)) {
    const [x,y]=center(q,r), key=pointKey(q,r),color=state.board[key];
    const g=el('g',{
      class:'cell '+(color?'occupied':''),
      role:'button', tabindex:state.ended?-1:0,
      'data-q':q,'data-r':r,
      'aria-label':q+','+r+' '+(color?LABELS[color]+'石':'空点')
    });
    g.appendChild(el('polygon',{points:vertices(x,y),class:'hex'}));
    if (color) g.appendChild(el('circle',{cx:x,cy:y,r:SIZE*.64,class:'piece '+color}));
    function activate() {
      if (!permittedForHuman()) {msgEl.textContent='CPUが考えています';return;}
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
  const color=COLORS[state.turn],counts=scores(state);
  turnStoneEl.className='stone '+color;
  turnTextEl.textContent=state.ended?'対局終了':LABELS[color]+'の番'+(mode==='cpu'&&state.turn!==0?'（CPU）':'');
  turnLabelEl.textContent=state.ended?'勝敗が決まりました':state.passes+'人連続パス · '+state.moveCount+'手';
  modeEl.value=mode;
  countsEl.replaceChildren();
  for (const c of COLORS) {
    const item=document.createElement('div');item.className='count';
    const small=document.createElement('small');small.textContent=LABELS[c];
    const strong=document.createElement('strong');strong.textContent=counts[c];
    const dot=document.createElement('span');dot.className='stone tiny '+c;
    item.append(dot,small,strong);countsEl.append(item);
  }
  drawBoard();
  passBtn.disabled=state.ended || !permittedForHuman();
  undoBtn.disabled=past.length===0;
  if (state.ended) {
    const winning=winner(state).map(c=>LABELS[c]).join('・');
    msgEl.textContent='終局！ '+winning+(winner(state).length>1?'が同点':'の勝利')+'。黒 '+counts.black+' / 白 '+counts.white+' / 赤 '+counts.red+' 石';
  } else {
    msgEl.textContent=state.lastAction;
  }
}
function reset({radius=4,nextMode=mode}={}) {
  if (!['cpu','local'].includes(nextMode)) return {ok:false,reason:'不明なモード'};
  stopBots();
  try {state=createGame(radius);} catch(e) {return {ok:false,reason:e.message};}
  mode=nextMode;past=[];actions=[];save();render();scheduleBots();
  return {ok:true,state:snapshot(state)};
}
function undo() {
  stopBots();
  if (!past.length) return {ok:false,reason:'戻せる手がありません'};
  do {
    state=past.pop();actions.pop();
  } while (mode==='cpu' && past.length && state.turn!==0);
  save();render();scheduleBots();
  return {ok:true,state:snapshot(state)};
}
function loadRecord(record) {
  stopBots();
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
  const nextMode=['cpu','local'].includes(record.mode)?record.mode:'local';
  state=next;mode=nextMode;past=states;actions=normalized;
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
    loadRecord(record);
  } catch { /* Ignore invalid / unavailable storage. */ }
}
passBtn.addEventListener('click',()=>{if (permittedForHuman()) doPass();});
undoBtn.addEventListener('click',undo);
resetBtn.addEventListener('click',()=>{
  if (state.moveCount===0 || confirm('対局を最初からやり直しますか？')) reset();
});
modeEl.addEventListener('change',()=>{
  const chosen=modeEl.value;
  if (state.moveCount>0 && !confirm('モードを変えると対局を最初からやり直します。続けますか？')) {
    modeEl.value=mode;return;
  }
  reset({nextMode:chosen});
});

/** Public browser automation interface. All actions use the same validated game engine as human moves. */
window.threeColorGo = Object.freeze({
  version: '0.3',
  getState: ()=>snapshot(state),
  legalMoves: ()=>legalMoves(state),
  play: (q,r)=>place(q,r),
  pass: ()=>doPass(),
  undo,
  reset: (options={})=>reset({radius:options.radius??4,nextMode:options.mode??'local'}),
  setMode: (next)=>reset({radius:state.radius,nextMode:next}),
  exportRecord: ()=>({version:1,radius:state.radius,mode,actions:actions.map(a=>({...a}))}),
  importRecord: loadRecord,
  autoPlay: (limit=100,seed=1)=>{
    stopBots();
    const rand=seededRandom(seed);
    const count=Math.max(0,Math.min(500,Math.trunc(limit)||0));
    let moves=0;
    while (!state.ended && moves<count) {
      const move=chooseMove(state,rand);
      const result=move?place(move.q,move.r,false):doPass(false);
      if (!result.ok) return {ok:false,reason:result.reason,moves};
      moves++;
    }
    scheduleBots();
    return {ok:true,moves,state:snapshot(state)};
  }
});

render();restore();scheduleBots();
