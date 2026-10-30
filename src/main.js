import { COLORS, LABELS, pointsOnBoard, pointKey, createGame, play, pass, scores, winner } from './game.js';

const boardSvg = document.getElementById('board');
const countsEl = document.getElementById('counts');
const turnStoneEl = document.getElementById('turnStone');
const turnTextEl = document.getElementById('turnText');
const turnLabelEl = document.getElementById('turnLabel');
const msgEl = document.getElementById('message');
const passBtn = document.getElementById('passBtn');
const undoBtn = document.getElementById('undoBtn');
const resetBtn = document.getElementById('resetBtn');

const SIZE = 29;
const ROOT3 = Math.sqrt(3);
let state = createGame(4);
let past = [];

function center(q,r) {return [SIZE*ROOT3*(q+r/2), SIZE*1.5*r];}
function vertices(x,y) {
  return Array.from({length:6},(_,i)=>{
    const a = (Math.PI/180)*(60*i-90);
    return `${(x+SIZE*Math.cos(a)).toFixed(2)},${(y+SIZE*Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}
function el(name, attrs={}) {
  const result = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([k,v])=>result.setAttribute(k,String(v)));
  return result;
}
function takeTurn(q,r) {
  const result = play(state,q,r);
  if (!result.ok) { msgEl.textContent=result.reason; return; }
  past.push(state);
  state = result.state;
  render();
}
function drawBoard() {
  boardSvg.replaceChildren();
  for (const {q,r} of pointsOnBoard(state.radius)) {
    const [x,y] = center(q,r), key=pointKey(q,r), color=state.board[key];
    const g=el('g',{class:`cell ${color?'occupied':''}`,role:'button',tabindex:state.ended?-1:0,
      'aria-label':`${q},${r} ${color?LABELS[color]+'石':'空点'}`});
    g.appendChild(el('polygon',{points:vertices(x,y),class:'hex'}));
    if (color) g.appendChild(el('circle',{cx:x,cy:y,r:SIZE*.64,class:`piece ${color}`}));
    g.addEventListener('click',()=>takeTurn(q,r));
    g.addEventListener('keydown',e=>{
      if (e.key==='Enter'||e.key===' ') {e.preventDefault();takeTurn(q,r);}
    });
    boardSvg.appendChild(g);
  }
}
function render() {
  const color=COLORS[state.turn], counts=scores(state);
  turnStoneEl.className=`stone ${color}`;
  turnTextEl.textContent = state.ended?'対局終了':`${LABELS[color]}の番`;
  turnLabelEl.textContent = state.ended?'勝敗が決まりました':`${state.passes}人連続パス · ${state.moveCount}手`; 
  countsEl.replaceChildren();
  for (const c of COLORS) {
    const item=document.createElement('div');
    item.className='count';
    const small=document.createElement('small'); small.textContent=LABELS[c];
    const strong=document.createElement('strong'); strong.textContent=counts[c];
    const dot=document.createElement('span');dot.className=`stone tiny ${c}`;
    item.append(dot,small,strong);
    countsEl.append(item);
  }
  drawBoard();
  passBtn.disabled=state.ended;
  undoBtn.disabled=past.length===0;
  if (state.ended) {
    const winning = winner(state).map(c=>LABELS[c]).join('・');
    msgEl.textContent = `終局！ ${winning}${winner(state).length>1?'が同点':'の勝利'}。${Object.values(counts).join(' / ')}石（黒 / 白 / 赤）`;
  } else {msgEl.textContent=state.lastAction;}
}
passBtn.addEventListener('click',()=>{const result=pass(state); if (!result.ok)return; past.push(state);state=result.state;render();});
undoBtn.addEventListener('click',()=>{if (!past.length)return;state=past.pop();render();});
resetBtn.addEventListener('click',()=>{if (past.length===0&&state.moveCount===0)return;
  if (!confirm('対局を最初からやり直しますか？'))return;
  state=createGame(4);past=[];render();
});
render();
