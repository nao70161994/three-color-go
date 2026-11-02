#!/usr/bin/env node
/** Assemble comparable results from fully and partially finished board-size CPU experiments. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw Error('Usage: compare-board-sizes.mjs REPORT_ROOT OUTPUT.json');
const runs=[
 ['r2-base',2,'baseline,baseline',24],['r3-base',3,'baseline,baseline',24],
 ['r4-base',4,'baseline,baseline',24],['r5-base',5,'baseline,baseline',12],
 ['r6-base',6,'baseline,baseline',6],['r8-base',8,'baseline,baseline',6],
 ['r12-base',12,'baseline,baseline',6],
 ['r2-mixed',2,'balanced,baseline',12],['r3-mixed',3,'balanced,baseline',12],
 ['r4-mixed',4,'balanced,baseline',12],['r5-mixed',5,'balanced,baseline',6],
 ['r6-mixed',6,'balanced,baseline',6]
];
const results=runs.map(([id,radius,pair,games])=>{
 const d=JSON.parse(readFileSync(join(input,id,'result.json'),'utf8'));
 if(d.radius!==radius||d.points!==1+3*radius*(radius+1)||
    d.gamesRequested!==games||d.opponents.join(',')!==pair||
    d.trainingGames!==102400||Math.abs(d.learningRate-.001)>1e-9||
    d.gamesRecorded!==d.results.length||
    d.gamesFinished!==d.results.filter(r=>r.finished).length||
    d.gamesRecorded>games||
    (d.status==='complete'&&d.gamesFinished!==games))
   throw Error('Incorrect source '+id);
 return {id,radius,points:d.points,opponents:pair,gamesRequested:games,
   gamesFinished:d.gamesFinished,status:d.status,meanStoneShare:d.meanStoneShare,
   winShareRate:d.winShareRate,avgGameSeconds:d.averageGameMs===null?null:d.averageGameMs/1000,
   maxGameSeconds:d.maxGameMs===null?null:d.maxGameMs/1000,
   elapsedSeconds:d.elapsedMs/1000};
});
const fmt=x=>x===null?'未測定':(100*x).toFixed(2)+'%';
const lines=[
 '# 三色囲碁：半径2・3・4・5・6・8・12への盤面サイズ外挿テスト',
 '',
 '評価モデルは学習率0.001／累計102,400局の凍結済み直接方策AI。追加学習なし。',
 'AIは探索なしgreedy。相手は従来CPUのbaseline+baseline、またはbalanced+baseline。',
 '全ゲームで黒白赤の色・手番を6パターン循環。評価は半径2〜4の学習済み範囲と、半径5〜12の未学習サイズ。',
 '大盤面は実行時間の都合で試合数が少ない。勝率や石数割合をサイズ間で単純比較して一般化性能を断言しない。',
 '',
 '| 評価 | 半径 | 盤面マス | 相手CPU | 完了局数/予定 | 石数割合 | 勝利配分率 | 平均対局秒 | 状態 |',
 '|---|---:|---:|---|---:|---:|---:|---:|---|',
 ...results.map(r=>['| '+r.id,r.radius,r.points,r.opponents,
  r.gamesFinished+'/'+r.gamesRequested,fmt(r.meanStoneShare),
  fmt(r.winShareRate),r.avgGameSeconds===null?'未測定':r.avgGameSeconds.toFixed(2),
  r.status+' |'].join(' | ')),
 '',
 '終了局数が6局未満の条件は全6色配置の均等比較ができないため特に参考値。',
 'すべての局が実際に終局した場合だけ完成とする。制限時間・手数上限で途切れた局は勝敗に算入しない。',
 '強さと処理速度は区別。現在の盤面半径2〜12で推論が可能かと、そのモデルが強いかは別の検証。',
 '固定CPUとの対戦は同じアルゴリズムでも盤面によって難易度が変わる。未学習サイズでの追加学習が必要かはこれらの傾向を踏まえて判断する。',
 'モデルを本番CPUには反映していない。'
];
const report={version:1,candidate:'lr001-final-102400',trainingRadii:[2,3,4],
 radii:[2,3,4,5,6,8,12],runs:results,markdown:lines.join('\n')+'\n'};
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
writeFileSync(output.replace(/\.json$/,'.md'),report.markdown);
process.stdout.write(report.markdown);
