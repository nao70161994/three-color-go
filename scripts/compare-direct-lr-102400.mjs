#!/usr/bin/env node
/** Summarize 320 checkpoint measurements (320..102400 training games) per rate.
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
if(history.totalTrainingPerRate!==81920||history.rates?.length!==5)
  throw Error('Missing or incomplete prior 81920-game results');

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
  if(!prior||prior.points?.length!==256||
     prior.points.at(-1).games!==81920)
    throw Error('Missing first 81920-game learning curve: '+key);
  const folder=join(opt['new-root'],key);
  const report=JSON.parse(readFileSync(join(folder,'extension-102400-summary.json'),'utf8'));
  if(report.startIteration!==10240||report.iterations!==12800||
     report.trainingGames!==102400||report.checkpoints?.length!==64||
     report.learning?.length!==2560||report.evalGamesPerMatch!==12)
    throw Error('Incomplete 81920→102400 continuation: '+key);
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
  if(points.length!==320||points.some((p,i)=>p.games!==(i+1)*320||
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
    key,lr,points,at81920:points[255],at102400:final,bestCheckpoint:best,
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
  '# 5学習率・累計102,400局の長期自己対戦比較',
  '',
  '81,920局のモデル・Adam・乱数状態から全5モデルをそれぞれ20,480局継続。',
  '評価は半径3/4、各チェックポイントで4組のCPU×12局、最終重みは完全に別シードで計192局／モデル。',
  '',
  '| 学習率 | 81,920局（定点評価） | 102,400局（定点評価） | 定点評価の最高値 | 102,400局別シード石数割合 | 別シード勝利配分率 | 難しい＋バランス相手の石数割合 |',
  '|---:|---:|---:|---:|---:|---:|---:|',
  ...all.map(r=>'| '+r.lr+' | '+pct(r.at81920.meanStoneShare)+
    ' | '+pct(r.at102400.meanStoneShare)+
    ' | '+pct(r.bestCheckpoint.meanStoneShare)+' @ '+r.bestCheckpoint.games+
    '局 | '+pct(r.holdout.meanStoneShare)+' | '+pct(r.holdout.winShareRate)+
    ' | '+pct(r.holdout.hardBalancedShare)+' |'),
  '',
  '## 全320チェックポイントの固定CPUへの最終石数割合',
  '',
  '| 累計学習局数 | '+rates.map(([,v])=>v).join(' | ')+' |',
  '|---:|'+rates.map(()=>'---:').join('|')+'|',
  ...all[0].points.map((p,i)=>'| '+p.games+' | '+
    all.map(r=>pct(r.points[i].meanStoneShare)).join(' | ')+' |'),
  '',
  '同じ評価用シードを繰り返し使うチェックポイント最高値は、選択バイアスがあるため最良モデルの証拠にはならない。',
  '81,920局の未使用シードと102,400局の未使用シードは異なるため、別シード欄の直接差分は強さの改善量を意味しない。',
  '自己対戦での3色平均報酬（石数割合）は常に約33.3%であり、棋力指標ではない。',
  '学習は半径2〜4、CPU評価は半径3・4のみ。半径8〜12の性能と収束は未検証。',
  '公開CPUは変更していない。'
];
const out={experiment:'five-lr-102400-games-resumed',
  totalTrainingPerRate:102400,continuationFrom:81920,
  trainingIterationsAdded:2560,finalHoldoutGamesPerRate:192,
  rates:all,markdown:lines.join('\n')+'\n'};
mkdirSync(dirname(opt.out),{recursive:true});
writeFileSync(opt.out,JSON.stringify(out,null,2)+'\n');
writeFileSync(opt.out.replace(/\.json$/,'.md'),out.markdown);
process.stdout.write(out.markdown);
