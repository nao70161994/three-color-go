#!/usr/bin/env node
/** Compare equal-budget, no-search 3-player selfplay across 5 learning rates.
 * All comparisons are descriptive: common evaluation seeds reused at every
 * checkpoint can select a lucky model, and are not a final held-out proof.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';

const keys=[
  ['lr001',0.001],['lr0003',0.0003],['lr0001',0.0001],
  ['lr00003',0.00003],['lr00001',0.00001]
];
const opts={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--root','--out'].includes(process.argv[i])||!process.argv[i+1])
    throw Error('Bad arg '+process.argv[i]);
  opts[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!opts.root||!opts.out)throw Error('--root and --out required');
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const records=[];
for(const [key,rate] of keys){
  const file=join(opts.root,'reports',key,'learning-curve-summary.json');
  const report=JSON.parse(readFileSync(file,'utf8'));
  if(report.trainingGames!==2560||report.checkpoints.length!==8||
     report.evalGamesPerMatch!==12)throw Error('Incomplete '+key);
  const summary=report.checkpoints.map(c=>{
    if(c.evaluations.length!==8||c.gamesTrained!==c.iteration*8)
      throw Error('Unexpected evaluation at '+key+' iteration '+c.iteration);
    const subset=c.evaluations.filter(e=>e.opponents.join(',')==='hard,balanced');
    if(subset.length!==2)throw Error('Missing hard+balanced');
    return {
      games:c.gamesTrained,
      allCpuStoneShare:avg(c.evaluations.map(e=>e.meanStoneShare)),
      hardBalancedStoneShare:avg(subset.map(e=>e.meanStoneShare)),
      baselineStoneShare:avg(c.evaluations.filter(
        e=>e.opponents.join(',')==='baseline,baseline').map(e=>e.meanStoneShare)),
      winShare:avg(c.evaluations.map(e=>e.winShareRate)),
      meanStones:avg(c.evaluations.map(e=>e.meanStones))
    };
  });
  const holdout=[];
  for(const radius of [3,4])for(const group of [
    'hard-balanced','balanced-balanced','tactical-guarded','baseline-baseline'
  ]){
    const data=JSON.parse(readFileSync(join(opts.root,'reports',key,
      'holdout-r'+radius+'-'+group+'.json'),'utf8'));
    if(data.finished!==24||data.truncated!==0||
       data.radius!==radius||data.games!==24)
      throw Error('Missing/incomplete fresh-seed holdout: '+key+' '+group);
    holdout.push(data);
  }
  const p=report.learning;
  const first=p.slice(0,40),last=p.slice(-40);
  records.push({
    holdoutMeanStoneShare:avg(holdout.map(h=>h.directMeanStoneShare)),
    holdoutHardBalancedStoneShare:avg(holdout.filter(h=>
      h.opponents.join(',')==='hard,balanced').map(h=>h.directMeanStoneShare)),
    holdoutWinShareRate:avg(holdout.map(h=>h.directWinShareRate)),
    key,rate,trainingGames:report.trainingGames,checkpoints:summary,
    earlyCaptures:avg(first.map(x=>x.meanCapturedStones.reduce((a,b)=>a+b,0))),
    lateCaptures:avg(last.map(x=>x.meanCapturedStones.reduce((a,b)=>a+b,0))),
    earlySurvivors:avg(first.map(x=>x.meanTotalSurvivingStones)),
    lateSurvivors:avg(last.map(x=>x.meanTotalSurvivingStones)),
    finalValueMse:p.at(-1).valueMse,
    finalPolicyKl:p.at(-1).policyKlOldToNew
  });
}
const round=(v,d=3)=>Number(v.toFixed(d));
const checkpoints=records[0].checkpoints.map((x,i)=>x.games);
const lines=[
  '## Five-rate long-horizon self-play study (2560 games per rate)',
  'No search/teacher; same seed, 3-agent reward, 320 updates, 8 games each.',
  'Independent fixed CPU evaluations (6 seating permutations x 2 replicates) at every 320 games.',
  '',
  '| Rate | Best checkpoint (exploratory) | Best mean stones share | Final mean share | Fresh-seed mean share | Fresh-seed hard+balanced | Fresh-seed win share |',
  '|---:|---:|---:|---:|---:|---:|---:|',
  ...records.map(r=>{
    const best=r.checkpoints.reduce((a,b)=>b.allCpuStoneShare>a.allCpuStoneShare?b:a);
    const final=r.checkpoints.at(-1);
    return '| '+r.rate+' | '+best.games+' | '+round(best.allCpuStoneShare*100,2)+
      '% | '+round(final.allCpuStoneShare*100,2)+'% | '+
      round(r.holdoutMeanStoneShare*100,2)+'% | '+
      round(r.holdoutHardBalancedStoneShare*100,2)+'% | '+
      round(r.holdoutWinShareRate*100,2)+'% |';
  }),
  '',
  '| Games trained | '+records.map(r=>r.rate).join(' | ')+' |',
  '|---:|'+records.map(()=>'---:').join('|')+'|',
  ...checkpoints.map((g,i)=>'| '+g+' | '+
    records.map(r=>round(r.checkpoints[i].allCpuStoneShare*100,2)+'%').join(' | ')+' |'),
  '',
  'Caution: Self-play mean fractional stone reward is exactly 1/3 by construction. '+
  'These are fixed-opponent evaluation means, not selfplay reward. Model selection '+
  'over re-used seeds is optimistic; the final 2560-game weights have a separate fresh-seed 24-game-per-match holdout. '+
  'No cutoff proves convergence, and actual board radius >4 has not been studied.'
];
const output={
  experiment:'five-learning-rates-2560-games-each',
  budget:'fixed computational budget per rate; no statistical convergence claim',
  records,markdown:lines.join('\n')+'\n'
};
mkdirSync(dirname(opts.out),{recursive:true});
writeFileSync(opts.out,JSON.stringify(output,null,2)+'\n');
writeFileSync(opts.out.replace(/\.json$/,'.md'),output.markdown);
process.stdout.write(output.markdown);
