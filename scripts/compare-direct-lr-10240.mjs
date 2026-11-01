#!/usr/bin/env node
/** Combine 0..5120 and 5120..10240 self-play checkpoints for all five LRs.
 * Compare held-out matchups; never use the symmetric self-play rewards as strength.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--history','--new-root','--out'].includes(process.argv[i])||
      !process.argv[i+1])throw Error('Invalid argument '+process.argv[i]);
  args[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!args.history||!args['new-root']||!args.out)
  throw Error('Expected --history, --new-root and --out');
const historical=JSON.parse(readFileSync(args.history,'utf8'));
if(historical.totalTrainingPerRate!==5120||
   historical.all.length!==5)throw Error('Incomplete 5120-game history');
const rates=[['lr001',.001],['lr0003',.0003],['lr0001',.0001],
             ['lr00003',.00003],['lr00001',.00001]];
const matchupNames=['hard-balanced','balanced-balanced',
                    'tactical-guarded','baseline-baseline'];
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const fmt=v=>(100*v).toFixed(2)+'%';
const all=[];
for(const [key,lr] of rates){
  const previous=historical.all.find(r=>r.key===key&&r.lr===lr);
  if(!previous||previous.points.length!==16||
     previous.points.at(-1).games!==5120)
    throw Error('Missing historical checkpoints: '+key);
  const root=join(args['new-root'],key);
  const report=JSON.parse(readFileSync(
    join(root,'extension-10240-summary.json'),'utf8'));
  if(report.startIteration!==640||report.iterations!==1280||
     report.trainingGames!==10240||report.checkpoints.length!==16||
     report.evalGamesPerMatch!==12||
     report.learning.length!==640)throw Error('Bad continuation '+key);
  const appended=report.checkpoints.map(c=>{
    if(c.evaluations.length!==8||c.gamesTrained!==c.iteration*8||
       c.evaluations.some(e=>e.games!==12||
         e.meanStoneShare===null||
         !Number.isFinite(e.meanStoneShare)))
      throw Error('Incomplete checkpoint benchmark '+key+' '+c.gamesTrained);
    const byGroup=(g)=>c.evaluations.filter(e=>e.opponents.join('-')===g);
    return {
      games:c.gamesTrained,
      meanStoneShare:avg(c.evaluations.map(e=>e.meanStoneShare)),
      hardBalancedShare:avg(byGroup('hard-balanced').map(e=>e.meanStoneShare)),
      baselineShare:avg(byGroup('baseline-baseline').map(e=>e.meanStoneShare)),
      winShareRate:avg(c.evaluations.map(e=>e.winShareRate)),
      meanStones:avg(c.evaluations.map(e=>e.meanStones))
    };
  });
  const points=[...previous.points,...appended];
  if(points.length!==32||points.some((p,i)=>p.games!==(i+1)*320||
     !Number.isFinite(p.meanStoneShare)||!Number.isFinite(p.winShareRate)))
    throw Error('Nonsequential/incomplete 10240-game trace '+key);
  const heldout=[];
  for(const radius of [3,4])for(const group of matchupNames){
    const path=join(root,'holdout-r'+radius+'-'+group+'.json');
    const value=JSON.parse(readFileSync(path,'utf8'));
    if(value.games!==24||value.finished!==24||value.truncated!==0||
       value.radius!==radius||value.opponents.join('-')!==group||
       !Number.isFinite(value.directMeanStoneShare)||
       !Number.isFinite(value.directWinShareRate))
      throw Error('Incomplete fresh holdout '+key+'/'+radius+'/'+group);
    heldout.push(value);
  }
  const old=points[15],last=points.at(-1);
  const best=points.reduce((b,p)=>p.meanStoneShare>b.meanStoneShare?p:b);
  const meanCapture=avg(report.learning.map(x=>
    x.meanCapturedStones.reduce((a,b)=>a+b,0)));
  const meanSurvivors=avg(report.learning.map(x=>x.meanTotalSurvivingStones));
  all.push({key,lr,points,bestCheckpoint:best,at5120:old,at10240:last,
    previousHoldout:previous.holdout,
    holdout:{
      games:heldout.reduce((n,x)=>n+x.games,0),
      meanStoneShare:avg(heldout.map(x=>x.directMeanStoneShare)),
      winShareRate:avg(heldout.map(x=>x.directWinShareRate)),
      hardBalancedShare:avg(heldout.filter(x=>
        x.opponents.join('-')==='hard-balanced').map(x=>x.directMeanStoneShare))
    },
    newSelfplayMeanCapturedStones:meanCapture,
    newSelfplayMeanSurvivors:meanSurvivors
  });
}
const lines=[
  '# 学習率5条件・10,240局までの継続学習比較',
  '',
  '各学習率で5,120局時点の重み・Adam・乱数状態を完全に引き継ぎ、',
  'さらに5,120局を学習。3人共有モデル、探索・教師なし、最終残石割合報酬。',
  '',
  '| 学習率 | 5,120局の途中評価 | 10,240局の途中評価 | 全32時点の最高成績 | 10,240局の未使用シード石数割合 | 未使用シード勝利配分率 |',
  '|---:|---:|---:|---:|---:|---:|',
  ...all.map(r=>'| '+r.lr+' | '+fmt(r.at5120.meanStoneShare)+
    ' | '+fmt(r.at10240.meanStoneShare)+
    ' | '+fmt(r.bestCheckpoint.meanStoneShare)+' @ '+r.bestCheckpoint.games+
    '局 | '+fmt(r.holdout.meanStoneShare)+' | '+fmt(r.holdout.winShareRate)+' |'),
  '',
  '## 学習局数別・固定CPUとの平均最終石数割合',
  '',
  '| 学習局数 | '+rates.map(([,r])=>r).join(' | ')+' |',
  '|---:|'+rates.map(()=>'---:').join('|')+'|',
  ...all[0].points.map((p,i)=>'| '+p.games+' | '+
    all.map(r=>fmt(r.points[i].meanStoneShare)).join(' | ')+' |'),
  '',
  '注：途中評価は同じ評価用シードを繰り返し使用。最終未使用シードは今回の10,240局時点のモデルだけを対象とする。',
  '古い5,120局の独立評価との横比較は評価シードが異なるため参考に留める。',
  '学習は半径2〜4、固定CPU評価は半径3〜4であり、大盤面の棋力は未検証。',
  '10,240局は比較地点であり収束・適切な学習終了の証明ではない。',
  '公開CPU・本番の重みは変更しない。'
];
const output={
  experiment:'five-lr-10240-games-resumed',
  totalTrainingPerRate:10240,
  continuationFrom:5120,
  trainingIterationsAdded:640,
  finalHoldoutGamesPerRate:192,
  rates:all,
  markdown:lines.join('\n')+'\n'
};
mkdirSync(dirname(args.out),{recursive:true});
writeFileSync(args.out,JSON.stringify(output,null,2)+'\n');
writeFileSync(args.out.replace(/\.json$/,'.md'),output.markdown);
console.log(output.markdown);
