#!/usr/bin/env node
/** Summarize 64 checkpoint measurements (320..20480 training games) per rate.
 * Keep held-out results separate from reused-seed checkpoint selection.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

const opt={};
for(let i=2;i<process.argv.length;i+=2){
  if(!['--history','--new-root','--out'].includes(process.argv[i])||!process.argv[i+1])
    throw Error('Unknown/missing comparison argument '+process.argv[i]);
  opt[process.argv[i].slice(2)]=process.argv[i+1];
}
if(!opt.history||!opt['new-root']||!opt.out)
  throw Error('Provide --history --new-root --out');
const history=JSON.parse(readFileSync(opt.history,'utf8'));
if(history.totalTrainingPerRate!==10240||history.rates?.length!==5)
  throw Error('Missing or incomplete prior 10240-game results');

const rates=[['lr001',0.001],['lr0003',0.0003],
  ['lr0001',0.0001],['lr00003',0.00003],['lr00001',0.00001]];
const groups=['hard-balanced','balanced-balanced',
  'tactical-guarded','baseline-baseline'];
const mean=xs=>{
  if(!xs.length||xs.some(x=>!Number.isFinite(x)))throw Error('Missing/invalid values');
  return xs.reduce((a,b)=>a+b,0)/xs.length;
};
const pct=x=>(100*x).toFixed(2)+'%';
const all=[];
for(const [key,lr] of rates){
  const prior=history.rates.find(x=>x.key===key&&x.lr===lr);
  if(!prior||prior.points?.length!==32||
     prior.points.at(-1).games!==10240)
    throw Error('Missing first 10240-game learning curve: '+key);
  const folder=join(opt['new-root'],key);
  const report=JSON.parse(readFileSync(join(folder,'extension-20480-summary.json'),'utf8'));
  if(report.startIteration!==1280||report.iterations!==2560||
     report.trainingGames!==20480||report.checkpoints?.length!==32||
     report.learning?.length!==1280||report.evalGamesPerMatch!==12)
    throw Error('Incomplete 10240→20480 continuation: '+key);
  const appended=report.checkpoints.map(c=>{
    if(c.evaluations.length!==8||c.gamesTrained!==c.iteration*8||
       c.evaluations.some(e=>e.games!==12))
      throw Error('Incomplete CPU checkpoint at '+key+' '+c.iteration);
    const pick=g=>c.evaluations.filter(e=>e.opponents.join('-')===g);
    if(groups.some(g=>pick(g).length!==2))
      throw Error('Incorrect opponent matchup mix '+key);
    return {
      games:c.gamesTrained,
      meanStoneShare:mean(c.evaluations.map(e=>e.meanStoneShare)),
      hardBalancedShare:mean(pick('hard-balanced').map(e=>e.meanStoneShare)),
      baselineShare:mean(pick('baseline-baseline').map(e=>e.meanStoneShare)),
      winShareRate:mean(c.evaluations.map(e=>e.winShareRate)),
      meanStones:mean(c.evaluations.map(e=>e.meanStones))
    };
  });
  const points=[...prior.points,...appended];
  if(points.length!==64||points.some((p,i)=>p.games!==(i+1)*320||
     !Number.isFinite(p.meanStoneShare)||!Number.isFinite(p.winShareRate)))
    throw Error('Nonsequential or invalid full learning curve '+key);
  const heldout=[];
  for(const radius of [3,4])for(const group of groups){
    const h=JSON.parse(readFileSync(
      join(folder,'holdout-r'+radius+'-'+group+'.json'),'utf8'));
    if(h.radius!==radius||h.games!==24||h.finished!==24||
       h.truncated!==0||h.opponents.join('-')!==group||
       !Number.isFinite(h.directMeanStoneShare)||
       !Number.isFinite(h.directWinShareRate))
      throw Error('Incomplete independent CPU evaluation '+key+'/'+radius+'/'+group);
    heldout.push(h);
  }
  const final=points.at(-1);
  const best=points.reduce((b,x)=>x.meanStoneShare>b.meanStoneShare?x:b);
  const trainingByRadius=Array.from(new Set(report.learning.map(r=>r.radius))).map(radius=>{
    const rows=report.learning.filter(r=>r.radius===radius);
    return {radius,meanTotalStones:mean(rows.map(r=>r.meanTotalSurvivingStones)),
      meanCaptures:mean(rows.map(r=>mean(r.meanCapturedStones)*3)),
      meanTurns:mean(rows.map(r=>r.meanTurns))};
  });
  all.push({
    key,lr,points,at10240:points[31],at20480:final,bestCheckpoint:best,
    previousHoldout:prior.holdout,
    holdout:{games:heldout.reduce((a,b)=>a+b.games,0),
      meanStoneShare:mean(heldout.map(h=>h.directMeanStoneShare)),
      winShareRate:mean(heldout.map(h=>h.directWinShareRate)),
      hardBalancedShare:mean(heldout.filter(h=>
        h.opponents.join('-')==='hard-balanced').map(h=>h.directMeanStoneShare))
    },
    trainingByRadius
  });
}
const lines=[
  '# 5学習率・累計20,480局の長期自己対戦比較',
  '',
  '10,240局のモデル・Adam・乱数状態から全5モデルをそれぞれ10,240局継続。',
  '評価は半径3/4、各チェックポイントで4組のCPU×12局、最終重みは完全に別シードで計192局／モデル。',
  '',
  '| 学習率 | 10,240局（定点評価） | 20,480局（定点評価） | 定点評価の最高値 | 20,480局別シード石数割合 | 別シード勝利配分率 | 難しい＋バランス相手の石数割合 |',
  '|---:|---:|---:|---:|---:|---:|---:|',
  ...all.map(r=>'| '+r.lr+' | '+pct(r.at10240.meanStoneShare)+
    ' | '+pct(r.at20480.meanStoneShare)+
    ' | '+pct(r.bestCheckpoint.meanStoneShare)+' @ '+r.bestCheckpoint.games+
    '局 | '+pct(r.holdout.meanStoneShare)+' | '+pct(r.holdout.winShareRate)+
    ' | '+pct(r.holdout.hardBalancedShare)+' |'),
  '',
  '## 全64チェックポイントの固定CPUへの最終石数割合',
  '',
  '| 累計学習局数 | '+rates.map(([,v])=>v).join(' | ')+' |',
  '|---:|'+rates.map(()=>'---:').join('|')+'|',
  ...all[0].points.map((p,i)=>'| '+p.games+' | '+
    all.map(r=>pct(r.points[i].meanStoneShare)).join(' | ')+' |'),
  '',
  '同じ評価用シードを繰り返し使うチェックポイント最高値は、選択バイアスがあるため最良モデルの証拠にはならない。',
  '10,240局の未使用シードと20,480局の未使用シードは異なるため、別シード欄の直接差分は強さの改善量を意味しない。',
  '自己対戦での3色平均報酬（石数割合）は常に約33.3%であり、棋力指標ではない。',
  '学習は半径2〜4、CPU評価は半径3・4のみ。半径8〜12の性能と収束は未検証。',
  '公開CPUは変更していない。'
];
const out={experiment:'five-lr-20480-games-resumed',
  totalTrainingPerRate:20480,continuationFrom:10240,
  trainingIterationsAdded:1280,finalHoldoutGamesPerRate:192,
  rates:all,markdown:lines.join('\n')+'\n'};
mkdirSync(dirname(opt.out),{recursive:true});
writeFileSync(opt.out,JSON.stringify(out,null,2)+'\n');
writeFileSync(opt.out.replace(/\.json$/,'.md'),out.markdown);
process.stdout.write(out.markdown);
