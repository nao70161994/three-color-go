import {COLORS,createGame,pass,play,pointKey,scores,winner} from './game.js';
import {dangerGroups,isOwnEye,isUnsafeCpuMove,groupInfo} from './agent.js';

export function explainPosition(state) {
  const threats=dangerGroups(state);
  const counts=scores(state);
  const risky=threats.map(g=>({color:g.color,size:g.stones.length,
    liberties:g.liberties}));
  const riskCount=Object.fromEntries(COLORS.map(c=>[c,risky.filter(g=>g.color===c).length]));
  return {moveCount:state.moveCount,turn:COLORS[state.turn],scores:counts,
    riskCount,atariGroups:risky,winners:winner(state)};
}

/** Explain only facts validated by the engine, never claim that an atari
 * automatically leads to capture in a three-player position. */
export function analyzeRecord(record) {
  if(!record||!Array.isArray(record.actions)||record.actions.length>2000)
    throw Error('Invalid game record');
  let state=createGame(record.radius);
  const stats={moves:0,passes:0,capturedStones:0,jointCaptures:0,eyeFills:0,
    selfAtari:0,leadChanges:0,turns:0};
  const incidents=[];
  let lastLeader=null;
  for(let i=0;i<record.actions.length;i++){
    const a=record.actions[i],player=COLORS[state.turn];
    if(!a||!['play','pass'].includes(a.type))throw Error('Invalid action '+i);
    let eye=false,unsafe=false;
    if(a.type==='play'){
      eye=isOwnEye(state,a.q,a.r,player);
      const tryMove=play(state,a.q,a.r);
      if(!tryMove.ok)throw Error('Illegal move '+i+': '+tryMove.reason);
      unsafe=isUnsafeCpuMove(state,a.q,a.r,tryMove);
    }
    const result=a.type==='pass'?pass(state):play(state,a.q,a.r);
    if(!result.ok)throw Error('Illegal record at '+i);
    const captured=result.captured||[];
    if(a.type==='pass')stats.passes++;else stats.moves++;
    if(captured.length)stats.capturedStones+=captured.length;
    if(eye)stats.eyeFills++;
    if(unsafe&&!eye)stats.selfAtari++;
    if(captured.length||eye||unsafe){
      if(incidents.length<30)incidents.push({turn:i+1,player,
        action:a.type==='pass'?'pass':pointKey(a.q,a.r),
        captured:captured.length,ownEye:eye,selfAtari:unsafe&&!eye});
    }
    state=result.state;stats.turns++;
    const sc=scores(state),m=Math.max(...Object.values(sc));
    const leaders=COLORS.filter(c=>sc[c]===m);
    if(leaders.length===1){
      if(lastLeader && lastLeader!==leaders[0])stats.leadChanges++;
      lastLeader=leaders[0];
    }
  }
  return {version:1,radius:state.radius,ended:state.ended,
    scores:scores(state),winners:winner(state),stats,incidents,
    atariGroups:dangerGroups(state).map(g=>({color:g.color,size:g.stones.length,liberties:g.liberties}))};
}
export function formatAnalysis(analysis) {
  const a=analysis,s=a.stats;
  return [
    '三色六角碁 対局分析',
    '盤面: '+(3*a.radius*(a.radius+1)+1)+'マス / '+s.turns+'手 / '+(a.ended?'終局':'対局中'),
    '黒 '+a.scores.black+' / 白 '+a.scores.white+' / 赤 '+a.scores.red,
    '勝者: '+(a.winners.length?a.winners.join('・'):'未確定'),
    '捕獲石数: '+s.capturedStones+' / パス: '+s.passes,
    '首位交代: '+s.leadChanges+'回',
    '眼埋めの疑い: '+s.eyeFills+'手 / 自アタリの疑い: '+s.selfAtari+'手',
    '呼吸点1の集団: '+a.atariGroups.length,
    ...a.incidents.slice(0,8).map(v=>v.turn+'手目 '+v.player+' '+v.action+
      (v.captured?' 捕獲'+v.captured:'')+(v.ownEye?' 眼埋め疑い':'')+(v.selfAtari?' 自アタリ疑い':'')),
    '※棋力・勝率の保証ではなく、再現可能な局面の特徴です。'
  ].join('\n');
}
