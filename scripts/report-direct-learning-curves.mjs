#!/usr/bin/env node
/** Learning curves: self-play capture/stone metrics and FIXED held-out CPU games.
 * Never treat symmetric self-play mean reward (~1/3) as evidence of strength.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  const k=process.argv[i],v=process.argv[i+1];
  if(!['--training-log','--eval-prefix','--out','--checkpoint-every','--iterations','--start-iteration','--groups','--games'].includes(k)||
      v===undefined)throw Error('Unknown/missing '+k);
  args[k.slice(2)]=v;
}
if(!args['training-log']||!args['eval-prefix'])throw Error('Missing inputs');
const iterations=Number(args.iterations??120),step=Number(args['checkpoint-every']??20);
const startIteration=Number(args['start-iteration']??0);
if(!Number.isInteger(iterations)||iterations<1||
   !Number.isInteger(startIteration)||startIteration<0||startIteration>=iterations||
   !Number.isInteger(step)||step<1||(iterations-startIteration)%step!==0)
  throw Error('Invalid checkpoint study configuration');
const rows=readFileSync(args['training-log'],'utf8').split('\n')
  .filter(s=>s.startsWith('{')).map(JSON.parse);
if(rows.length!==iterations-startIteration||rows.some((x,i)=>x.iteration!==startIteration+i+1))
  throw Error('Incomplete/nonsequential training trace');
for(const row of rows){
  if(![row.meanSurvivingStones,row.meanCapturedStones,row.meanCapturedLosses,
       row.meanFinalStoneShares].every(x=>Array.isArray(x)&&x.length===3))
    throw Error('Missing three-seat stone/capture metrics');
  if(Math.abs(row.meanFinalStoneShares.reduce((a,b)=>a+b,0)-1)>1e-4)
    throw Error('Bad normalized terminal reward');
}
const groups=(args.groups??'baseline-baseline,hard-balanced').split(',');
const gamesPerMatch=Number(args.games??6);
if(!groups.length||groups.some(g=>!['hard-balanced','balanced-balanced',
    'tactical-guarded','baseline-baseline'].includes(g))||
   !Number.isInteger(gamesPerMatch)||gamesPerMatch<6||gamesPerMatch>300||
   gamesPerMatch%6!==0)throw Error('Invalid matchup groups/games');
const radii=[3,4],checkpoints=[];
for(let iteration=startIteration+step;iteration<=iterations;iteration+=step){
  const parts=[];
  for(const radius of radii)for(const group of groups){
    const path=`${args['eval-prefix']}-iter${String(iteration).padStart(4,'0')}-r${radius}-${group}.json`;
    const result=JSON.parse(readFileSync(path,'utf8'));
    if(result.finished!==result.games||result.truncated!==0||
       result.radius!==radius||result.games!==gamesPerMatch)
      throw Error('Incomplete held-out evaluation '+path);
    parts.push({
      radius,opponents:result.opponents,
      games:result.games,
      winShareRate:result.directWinShareRate,
      meanStones:result.directMeanStones,
      meanStoneShare:result.directMeanStoneShare,
      marginVsFirst:result.vsOp1.meanStoneMargin,
      marginVsSecond:result.vsOp2.meanStoneMargin
    });
  }
  checkpoints.push({iteration,gamesTrained:rows[iteration-startIteration-1].trainingGamesTotal,
    evaluations:parts});
}
const mean=(xs)=>+(xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(4);
const byRadius=[...new Set(rows.map(r=>r.radius))].map(radius=>{
  const subset=rows.filter(r=>r.radius===radius);
  const n=Math.min(5,Math.floor(subset.length/2));
  const summary=(slice)=>({
    meanFinalSurvivingStonesPerSeat:
      [0,1,2].map(i=>mean(slice.map(r=>r.meanSurvivingStones[i]))),
    meanCapturedStonesPerSeat:
      [0,1,2].map(i=>mean(slice.map(r=>r.meanCapturedStones[i]))),
    meanFinalTotalStones:mean(slice.map(r=>r.meanTotalSurvivingStones)),
    meanTurns:mean(slice.map(r=>r.meanTurns))
  });
  return {radius,iterations:subset.length,
    first:summary(subset.slice(0,n)),last:summary(subset.slice(-n))};
});
const report={
  matchupGroups:groups,evalGamesPerMatch:gamesPerMatch,
  experiment:'no-search three-player terminal stone shares',
  caveat:'Selfplay mean stone share across 3 seats is mathematically 1/3 and not a strength metric. Independent fixed-opponent checkpoint matches are small (per group/size), not proof of convergence.',
  iterations,startIteration,trainingGames:rows.at(-1).trainingGamesTotal,
  byRadius,checkpoints,learning:rows
};
const json=JSON.stringify(report,null,2)+'\n';
if(args.out){mkdirSync(dirname(args.out),{recursive:true});writeFileSync(args.out,json);}
process.stdout.write(json);
