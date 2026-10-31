#!/usr/bin/env node
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {strongMatch} from '../src/strong-ai.js';

const args={};
const keys=new Set(['games','seed','radius','out']);
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(!key.startsWith('--')||!keys.has(key.slice(2))||!process.argv[i+1]){
    console.error('Invalid argument '+key);process.exit(2);
  }
  args[key.slice(2)]=process.argv[++i];
}
const games=args.games===undefined?9:Number(args.games);
const seed=args.seed===undefined?2026:Number(args.seed);
const radius=args.radius===undefined?3:Number(args.radius);
if(!Number.isSafeInteger(games)||games<3||games>90||games%3!==0||
   !Number.isSafeInteger(seed)||seed<0||seed>4294967295||
   !Number.isInteger(radius)||radius<2||radius>4){
  console.error('Require games 3..90 (multiple of three), seed 0..2^32-1, radius 2..4');
  process.exit(2);
}
try{
  const seats=[0,1,2].map(index=>({seat:index,played:0,wins:0,winShare:0}));
  const samples=[];
  let finished=0,truncated=0,ties=0,moves=0;
  for(let i=0;i<games;i++){
    const seat=i%3;
    const match=strongMatch({radius,seed:seed+i,strongSeat:seat});
    seats[seat].played++; moves+=match.history.length;
    if(!match.ended){truncated++;continue;}
    finished++;
    if(match.winners.length>1)ties++;
    if(match.winners.includes(['black','white','red'][seat])){
      seats[seat].winShare+=1/match.winners.length;
      if(match.winners.length===1)seats[seat].wins++;
    }
    if(samples.length<3){
      samples.push({version:1,radius,mode:'local',seed:seed+i,
        strongSeat:seat,actions:match.history,scores:match.state.ended?{
          black:Object.values(match.state.board).filter(v=>v==='black').length,
          white:Object.values(match.state.board).filter(v=>v==='white').length,
          red:Object.values(match.state.board).filter(v=>v==='red').length
        }:null,winners:match.winners});
    }
  }
  const winShare=seats.reduce((n,s)=>n+s.winShare,0);
  const result={version:1,kind:'strong-vs-2-balanced',games,seed,radius,
    finished,truncated,ties,winShare:+winShare.toFixed(4),
    winRate:finished?+(winShare/finished).toFixed(4):null,
    averageTurns:+(moves/games).toFixed(2),
    seats:seats.map(s=>({...s,winShare:+s.winShare.toFixed(4),
      winRate:s.played?+(s.winShare/s.played).toFixed(4):null})),
    samples,
    caveat:'A limited seeded bot matchup, not a guarantee of superior play or human win rate.'};
  const json=JSON.stringify(result,null,2)+'\n';
  if(args.out){await mkdir(dirname(args.out),{recursive:true});await writeFile(args.out,json);}
  process.stdout.write(json);
}catch(e){console.error(e.stack);process.exitCode=1;}
