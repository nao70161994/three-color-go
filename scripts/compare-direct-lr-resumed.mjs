#!/usr/bin/env node
/** 2,560→5,120 cumulative training: compare LR curves, captures and fixed-CPU scores. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';

const args={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--root','--out'].includes(process.argv[i])||!process.argv[i+1])throw Error('Bad arg');
  args[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!args.root||!args.out)throw Error('--root/--out required');
const rates=[['lr001',.001],['lr0003',.0003],['lr0001',.0001],['lr00003',.00003],['lr00001',.00001]];
const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
const fmt=x=>(x*100).toFixed(2)+'%';
const all=[];
for(const [key,lr] of rates){
  const old=JSON.parse(readFileSync(join(args.root,'original',key,'learning-curve-summary.json'),'utf8'));
  const ext=JSON.parse(readFileSync(join(args.root,'extended',key,'learning-curve-summary.json'),'utf8'));
  if(old.trainingGames!==2560||ext.trainingGames!==5120||
     ext.startIteration!==320||old.checkpoints.length!==8||ext.checkpoints.length!==8||
     old.evalGamesPerMatch!==12||ext.evalGamesPerMatch!==12)
    throw Error('Incomplete training / checkpoint data: '+key);
  const points=[...old.checkpoints,...ext.checkpoints].map(x=>{
    if(x.evaluations.length!==8||x.gamesTrained!==x.iteration*8||
       x.evaluations.some(e=>e.games!==12))throw Error('Bad matchup in '+key);
    const pick=(a,b)=>x.evaluations.filter(e=>e.opponents.join(',')===a+','+b);
    return {
      games:x.gamesTrained,
      meanStoneShare:mean(x.evaluations.map(e=>e.meanStoneShare)),
      hardBalancedShare:mean(pick('hard','balanced').map(e=>e.meanStoneShare)),
      baselineShare:mean(pick('baseline','baseline').map(e=>e.meanStoneShare)),
      winShareRate:mean(x.evaluations.map(e=>e.winShareRate)),
      meanStones:mean(x.evaluations.map(e=>e.meanStones))
    };
  });
  for(let i=0;i<points.length;i++)
    if(points[i].games!==(i+1)*320)throw Error('Nonconsecutive checkpoint '+key);
  const heldout=[];
  for(const radius of [3,4])for(const group of [
    'hard-balanced','balanced-balanced','tactical-guarded','baseline-baseline'
  ]){
    const h=JSON.parse(readFileSync(join(args.root,'extended',key,
      'holdout-r'+radius+'-'+group+'.json'),'utf8'));
    if(h.games!==24||h.finished!==24||h.truncated!==0||h.radius!==radius)
      throw Error('Missing holdout '+key+radius+group);
    heldout.push(h);
  }
  const end=points.at(-1),best=points.reduce(
    (b,p)=>p.meanStoneShare>b.meanStoneShare?p:b);
  const capture=(r)=>mean(r.learning.map(x=>x.meanCapturedStones.reduce((a,b)=>a+b,0)));
  const survivors=(r)=>mean(r.learning.map(x=>x.meanTotalSurvivingStones));
  all.push({key,lr,points,final:end,bestCheckpoint:best,
    holdout:{games:heldout.reduce((n,x)=>n+x.games,0),
      winShareRate:mean(heldout.map(x=>x.directWinShareRate)),
      meanStoneShare:mean(heldout.map(x=>x.directMeanStoneShare)),
      hardBalancedShare:mean(heldout.filter(x=>
        x.opponents.join(',')==='hard,balanced').map(x=>x.directMeanStoneShare))},
    selfplay:{
      earlierMeanCapturedStones:capture(old),
      laterMeanCapturedStones:capture(ext),
      earlierMeanSurvivors:survivors(old),laterMeanSurvivors:survivors(ext)}
  });
}
const lines=[
  '# 学習率5条件・2,560→5,120局の追加学習結果',
  '',
  '全5条件とも元のAdam/乱数状態を引き継いで追加2,560局。教師・先読みなし。最終独立評価は未使用の別シード、半径3/4×4 CPU構成×24局。',
  '',
  '| 学習率 | 2,560局 | 5,120局 | 最高平均石数割合（途中評価） | 別シード平均石数割合 | 別シード勝利配分率 |',
  '|---:|---:|---:|---:|---:|---:|',
  ...all.map(r=>'| '+r.lr+' | '+fmt(r.points[7].meanStoneShare)+
    ' | '+fmt(r.final.meanStoneShare)+' | '+fmt(r.bestCheckpoint.meanStoneShare)+
    ' @ '+r.bestCheckpoint.games+'局 | '+fmt(r.holdout.meanStoneShare)+
    ' | '+fmt(r.holdout.winShareRate)+' |'),
  '',
  '## 固定相手への平均石数割合・学習曲線',
  '',
  '| 累計自己対戦局数 | '+rates.map(([,r])=>r).join(' | ')+' |',
  '|---:|'+rates.map(()=>'---:').join('|')+'|',
  ...all[0].points.map((p,i)=>'| '+p.games+' | '+
    all.map(a=>fmt(a.points[i].meanStoneShare)).join(' | ')+' |'),
  '',
  '自己対戦の3人の平均石数割合は常に約33.3%のため、棋力には使わない。',
  '固定CPUチェックポイントの対戦結果も評価シード再利用によるばらつきがある。',
  '別シードの最終評価も各レート192局の探索的実測であり、統計的な収束・盤面8〜12への一般化を証明しない。',
  'これは学習率比較であって本番モデルを自動採用するものではない。'
];
const out={summary:'five-lr-resumed-5120-games',totalTrainingPerRate:5120,
  continuationFrom:2560,all,markdown:lines.join('\n')+'\n'};
mkdirSync(dirname(args.out),{recursive:true});
writeFileSync(args.out,JSON.stringify(out,null,2)+'\n');
writeFileSync(args.out.replace(/\.json$/,'.md'),out.markdown);
console.log(out.markdown);
