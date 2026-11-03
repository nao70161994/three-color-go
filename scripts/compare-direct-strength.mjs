#!/usr/bin/env node
/** Summarize COMMON-SEED, seat-rotated CPU and head-to-head evaluations.
 * CPU scores and model-vs-model results are distinct evidence; never combine
 * incomparable seeds or select winners based on earlier reused-seed peaks.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

const [cpuRoot,duelRoot,out]=process.argv.slice(2);
if(!cpuRoot||!duelRoot||!out)throw Error('Usage: compare-direct-strength.mjs CPU_DIR DUEL_DIR OUT.json');
const load=(p)=>JSON.parse(readFileSync(p,'utf8'));
const candidates=[
  ['lr001-pass20k',0.001,20000],['lr0003-pass20k',0.0003,20000],
  ['lr0001-pass20k',0.0001,20000],['lr00003-pass20k',0.00003,20000],
  ['lr00001-pass20k',0.00001,20000]
];
const pairs=[
  ['lr001-pass20k','lr0003-pass20k'],
  ['lr001-pass20k','lr0001-pass20k'],
  ['lr001-pass20k','lr00003-pass20k'],
  ['lr001-pass20k','lr00001-pass20k'],
  ['lr0003-pass20k','lr0001-pass20k'],
  ['lr0003-pass20k','lr00003-pass20k'],
  ['lr0003-pass20k','lr00001-pass20k'],
  ['lr0001-pass20k','lr00003-pass20k'],
  ['lr0001-pass20k','lr00001-pass20k'],
  ['lr00003-pass20k','lr00001-pass20k']
];
const groups=['hard-balanced','balanced-balanced','tactical-guarded','baseline-baseline'];
const opponentTypes=['hard','balanced'];
const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
const percent=v=>(v*100).toFixed(2)+'%';
const cpuResults=candidates.map(([id,learningRate,trainingGames])=>{
  const matches=[];
  for(const radius of [3,4])for(const group of groups){
    const r=load(join(cpuRoot,id,'r'+radius+'-'+group+'.json'));
    if(r.radius!==radius||r.games!==48||r.finished!==48||r.truncated!==0||
       r.opponents.join('-')!==group||
       Math.abs(r.learningRate-learningRate)>1e-9||
       r.trainingGames!==trainingGames||
       !Number.isFinite(r.directMeanStoneShare)||!Number.isFinite(r.directWinShareRate))
      throw Error('Unexpected or incomplete independent CPU result: '+id+', r'+radius+','+group);
    matches.push(r);
  }
  const hard=matches.filter(x=>x.opponents.join('-')==='hard-balanced');
  return {id,learningRate,trainingGames,games:matches.reduce((n,r)=>n+r.games,0),
    stoneShare:mean(matches.map(x=>x.directMeanStoneShare)),
    winShare:mean(matches.map(x=>x.directWinShareRate)),
    hardBalancedShare:mean(hard.map(x=>x.directMeanStoneShare)),
    radius3Share:mean(matches.filter(x=>x.radius===3).map(x=>x.directMeanStoneShare)),
    radius4Share:mean(matches.filter(x=>x.radius===4).map(x=>x.directMeanStoneShare)),
    matchups:matches.map(x=>({radius:x.radius,opponents:x.opponents,
      meanStoneShare:x.directMeanStoneShare,winShareRate:x.directWinShareRate}))
  };
}).sort((a,b)=>b.stoneShare-a.stoneShare);
const prng=(seed)=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
const h2hResults=pairs.map(([a,b],index)=>{
  const cells=[];
  for(const radius of [3,4])for(const opponent of opponentTypes){
    const r=load(join(duelRoot,a+'--'+b,'r'+radius+'-'+opponent+'.json'));
    if(r.radius!==radius||r.opponent!==opponent||r.games!==48||
       r.results?.length!==48||r.rotationsPerBlock!==6||
       !Number.isFinite(r.meanStoneShare.a)||!Number.isFinite(r.meanStoneShare.b)||
       !Number.isFinite(r.winShareRate.a)||!Number.isFinite(r.winShareRate.b)||
       r.wins.a+r.wins.b+r.wins.tied!==48)
      throw Error('Incomplete head-to-head: '+a+' '+b+' r'+radius+' '+opponent);
    const blocks=[];
    for(let k=0;k<8;k++){
      const rows=r.results.filter(x=>x.block===k);
      if(rows.length!==6||new Set(rows.map(x=>x.order.join(','))).size!==6)
        throw Error('Missing six-seat block: '+a+'/'+b+'/'+radius+'/'+opponent+'/'+k);
      blocks.push(mean(rows.map(x=>x.stoneShares.a-x.stoneShares.b)));
    }
    cells.push({radius,opponent,...r,blocks});
  }
  const games=cells.reduce((n,r)=>n+r.games,0);
  const awins=cells.reduce((n,r)=>n+r.wins.a,0);
  const bwins=cells.reduce((n,r)=>n+r.wins.b,0);
  const ties=cells.reduce((n,r)=>n+r.wins.tied,0);
  const avgStoneDiff=mean(cells.map(r=>r.meanStoneShare.a-r.meanStoneShare.b));
  const winShareDiff=mean(cells.map(r=>r.winShareRate.a-r.winShareRate.b));
  const rand=prng(412300+index*10001),bootstrap=[];
  for(let i=0;i<1500;i++){
    bootstrap.push(mean(cells.map(cell=>mean(Array.from({length:8},()=>{
      const n=Math.floor(rand()*8);
      return cell.blocks[n];
    })))));
  }
  bootstrap.sort((x,y)=>x-y);
  const ci95=[bootstrap[Math.floor(bootstrap.length*.025)],bootstrap[Math.floor(bootstrap.length*.975)]];
  return {a,b,games,awins,bwins,ties,avgStoneDiff,winShareDiff,ci95,
    relativeWinner:ci95[0]>0?a:ci95[1]<0?b:'undetermined',
    cells:cells.map(x=>({radius:x.radius,opponent:x.opponent,games:x.games,
      awins:x.wins.a,bwins:x.wins.b,ties:x.wins.tied,
      aStoneShare:x.meanStoneShare.a,bStoneShare:x.meanStoneShare.b}))};
});
const lines=[
 '# パス込み追加学習の5モデル・累計122,400局の独立棋力検証',
 '',
 '学習には使っていない新規評価seedで、半径3/4×CPU4組×各48局（各候補384局）、',
 '直接対戦は3人目をhard/balancedとし、半径3/4×各48局（各組合せ192局）。',
 '直接対戦は色・手番を6通りローテーション。CPU評価と直接対戦は別々に集計。',
 '',
 '## 共通条件の独立CPU評価',
 '',
 '| モデル | 追加学習局数 | 評価局数 | 最終石数割合 | 勝利配分率 | hard+balanced相手 |',
 '|---|---:|---:|---:|---:|---:|',
 ...cpuResults.map(x=>['| '+x.id,x.trainingGames,x.games,
   percent(x.stoneShare),percent(x.winShare),percent(x.hardBalancedShare)+' |'].join(' | ')),
 '',
 '## AI同士の直接対戦（各192局・座席6通り）',
 '',
 '| AI A | AI B | AがBより多石 | BがAより多石 | 同石 | A-B残石割合差 | 差の95%ブロックbootstrap区間 | 判定 |',
 '|---|---|---:|---:|---:|---:|---:|---|',
 ...h2hResults.map(x=>[x.a,x.b,x.awins,x.bwins,x.ties,
   ((x.avgStoneDiff)*100).toFixed(2)+'pt',
   '['+x.ci95.map(q=>(100*q).toFixed(2)).join(', ')+']pt',
   x.relativeWinner].join(' | ')).map(x=>'| '+x+' |'),
 '',
 'bootstrap区間は6色座席ローテーションをまとめた8ブロック×4条件で層化リサンプリングした探索的指標。',
 '独立seedの一般的な母集団への厳密な確率保証ではない。対戦はどちらもgreedy/no-searchで、第三プレイヤーによる相互作用が残る。',
 '候補は事前指定した5学習率の最終状態のみを使用し、評価後に都合の良い途中checkpointを選んでいない。',
 '追加の20,000局にはパスが常時合法行動として含まれ、学習半径2〜4であり、実用的大盤面の強さや収束、公開CPUへの採用可否は未検証。公開CPUは変更していない。',
];
const report={experiment:'direct-strength-crossplay-122400',cpuGamesPerCandidate:384,
 h2hGamesPerPair:192,candidates:cpuResults,pairs:h2hResults,markdown:lines.join('\n')+'\n'};
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
writeFileSync(out.replace(/\.json$/,'.md'),report.markdown);
process.stdout.write(report.markdown);
