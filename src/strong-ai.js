import { COLORS, adjacentKeys, createGame, pass, play, pointKey, pointsOnBoard, scores, winner } from './game.js';
import { chooseMove, groupInfo, seededRandom } from './agent.js';

/**
 * Strong CPU: 3-ply, three-player adversarial candidate search.
 * The actual game engine remains the sole legal-move authority.
 * Opponents prefer their own board advantage; worst-case among their
 * two most promising replies protects against cooperative captures.
 * Branching is bounded by board size for mobile use.
 */
function positionValue(state, player) {
  const count=scores(state);
  const opponents=COLORS.filter(c=>c!==player);
  const oppCount=opponents.map(c=>count[c]).sort((a,b)=>b-a);
  let value=count[player]*8 - oppCount[0]*3.6 - oppCount[1]*1.4;
  const visited=new Set();
  const frontier=new Set();
  for(const [key,color] of Object.entries(state.board)) {
    if(visited.has(key))continue;
    const g=groupInfo(state.board,key,state.radius);
    for(const stone of g.stones)visited.add(stone);
    const size=g.stones.length;
    const libs=g.liberties.length;
    if(color===player) {
      if(libs===1)value-=Math.min(size,18)*9;
      else if(libs===2)value-=Math.min(size,18)*2.8;
      else value+=Math.min(size,12)*.2;
      for(const liberty of g.liberties)frontier.add(liberty);
    } else {
      const threat=size*(libs===1 ? 3.3 : libs===2 ? .7 : 0);
      value+=Math.min(30,threat);
    }
  }
  value+=frontier.size*.26;
  return value;
}

function candidates(state, player, width, random) {
  if(state.ended)return [];
  const options=[];
  // On 217+ cell boards, avoid evaluating every empty point at every
  // search ply. Consider locally relevant moves and a few central openings.
  // All shortlisted moves still pass through the exact rules engine.
  const points=pointsOnBoard(state.radius);
  let shortlist=points;
  if(state.radius>=8) {
    const board=state.board;
    shortlist=points.filter(({q,r})=>!board[pointKey(q,r)]).map(({q,r})=>{
      const key=pointKey(q,r);
      const neighbors=adjacentKeys(key,state.radius);
      const friends=neighbors.filter(n=>board[n]===player).length;
      const enemies=neighbors.filter(n=>board[n]&&board[n]!==player).length;
      const distance=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r));
      return {q,r,priority:friends*1.7+enemies*2.2-distance*.07+random()*.15};
    }).sort((a,b)=>b.priority-a.priority).slice(0,24);
  }
  const evaluate=(selected)=>{
    for(const {q,r} of selected) {
      if(state.board[pointKey(q,r)])continue;
      const next=play(state,q,r);
      if(!next.ok)continue;
      const edge=Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))/state.radius;
      const rank=positionValue(next.state,player)+next.captured.length*5
        + (1-edge)*.38 + random()*.04;
      options.push({q,r,state:next.state,rank});
    }
  };
  evaluate(shortlist);
  // Avoid false passes if the top shortlist consists only of illegal eyes,
  // even though legal moves remain in a different part of a large board.
  if(!options.length && shortlist!==points)evaluate(points);
  options.sort((a,b)=>b.rank-a.rank);
  return options.slice(0,width);
}

function fallback(state) {
  const result=pass(state);
  return result.ok?result.state:state;
}

function replies(state,player,width,random) {
  // CPU passing at this point is a bot policy, not a rule change.
  const cells=pointsOnBoard(state.radius).length;
  if(state.moveCount>=cells*2)return [{state:fallback(state),rank:0}];
  const ranked=candidates(state,player,width,random);
  return ranked.length?ranked:[{state:fallback(state),rank:0}];
}

export function chooseStrongMove(state,random=Math.random) {
  if(state.ended)return null;
  const cells=pointsOnBoard(state.radius).length;
  if(state.moveCount>=cells*2)return null;
  const width=state.radius<=3?6:state.radius===4?5:state.radius===5?3:2;
  const opponentWidth=state.radius<=3?2:1;
  const me=COLORS[state.turn];
  const roots=candidates(state,me,width,random);
  if(!roots.length)return null;
  let best=roots[0],bestValue=-Infinity;
  for(const root of roots) {
    let worst=Infinity;
    for(const first of replies(root.state,COLORS[root.state.turn],opponentWidth,random)) {
      for(const second of replies(first.state,COLORS[first.state.turn],opponentWidth,random)) {
        worst=Math.min(worst,positionValue(second.state,me));
      }
    }
    const value=root.rank*.2+worst*.8;
    if(value>bestValue) {bestValue=value;best=root;}
  }
  return {q:best.q,r:best.r};
}

/** Full game with strong CPU rotated into an arbitrary seat. */
export function strongMatch({radius=3,seed=1,strongSeat=0,maxTurns=350}={}) {
  if(!Number.isInteger(strongSeat)||strongSeat<0||strongSeat>2)
    throw Error('strongSeat must be 0..2');
  if(!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>3000)
    throw Error('maxTurns must be 1..3000');
  const random=seededRandom(seed);
  let state=createGame(radius),moves=0;
  const history=[];
  while(!state.ended&&moves<maxTurns){
    const color=COLORS[state.turn];
    const move=state.turn===strongSeat
      ?chooseStrongMove(state,random)
      :chooseMove(state,random,'balanced');
    const result=move?play(state,move.q,move.r):pass(state);
    if(!result.ok)throw Error(result.reason);
    history.push(move?{type:'play',q:move.q,r:move.r}:{type:'pass'});
    state=result.state;
    moves++;
  }
  return {state,history,ended:state.ended,winners:winner(state),strongSeat,seed};
}
