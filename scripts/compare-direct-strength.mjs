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
    if(r.radius!==radius||r.games!==48||r.finished+r.truncated!==48||
       r.opponents.join('-')!==group||
       Math.abs(r.learningRate-learningRate)>1e-9||
       r.trainingGames!==trainingGames||
       !Number.isFinite(r.observedMeanStoneShare)||r.records?.length!==48)
      throw Error('Unexpected or incomplete independent CPU result: '+id+', r'+radius+','+group);
    matches.push(r);
  }
  const hard=matches.filter(x=>x.opponents.join('-')==='hard-balanced');
  const finished=matches.reduce((n,r)=>n+r.finished,0);
  const winsNumerator=matches.reduce((n,r)=>n+(r.directWinShareRate??0)*r.finished,0);
  return {id,learningRate,trainingGames,games:matches.reduce((n,r)=>n+r.games,0),
    finished,truncated:matches.reduce((n,r)=>n+r.truncated,0),
    finishedByOriginalCap:matches.reduce((n,r)=>n+r.finishedByOriginalCap,0),
    finishedAfterOriginalCap:matches.reduce((n,r)=>n+r.finishedAfterOriginalCap,0),
    maxFinishedTurns:Math.max(...matches.map(x=>x.maxFinishedTurns??0)),
    stoneShare:mean(matches.map(x=>x.observedMeanStoneShare)),
    finalStoneShare:finished?matches.reduce((n,r)=>n+(r.directMeanStoneShare??0)*r.finished,0)/finished:null,
    winShare:finished?winsNumerator/finished:null,
    hardBalancedShare:mean(hard.map(x=>x.observedMeanStoneShare)),
    radius3Share:mean(matches.filter(x=>x.radius===3).map(x=>x.observedMeanStoneShare)),
    radius4Share:mean(matches.filter(x=>x.radius===4).map(x=>x.observedMeanStoneShare)),
    matchups:matches.map(x=>({radius:x.radius,opponents:x.opponents,
      horizonMultiplier:x.horizonMultiplier,
      finishedByOriginalCap:x.finishedByOriginalCap,
      finishedAfterOriginalCap:x.finishedAfterOriginalCap,
      finished:x.finished,truncated:x.truncated,
      finishedByOriginalCap:x.finishedByOriginalCap,
      finishedAfterOriginalCap:x.finishedAfterOriginalCap,
      observedStoneShare:x.observedMeanStoneShare,
      finalStoneShare:x.directMeanStoneShare,winShareRate:x.directWinShareRate}))
  };
}).sort((a,b)=>b.stoneShare-a.stoneShare);
const prng=(seed)=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
const h2hResults=pairs.map(([a,b],index)=>{
  const cells=[];
  for(const radius of [3,4])for(const opponent of opponentTypes){
    const r=load(join(duelRoot,a+'--'+b,'r'+radius+'-'+opponent+'.json'));
    if(r.radius!==radius||r.opponent!==opponent||r.games!==48||
       r.results?.length!==48||r.rotationsPerBlock!==6||
       r.finished+r.truncated!==48||
       !Number.isFinite(r.meanStoneShare.a)||!Number.isFinite(r.meanStoneShare.b)||
       r.wins.a+r.wins.b+r.wins.tied!==48||
       r.finishedWins.a+r.finishedWins.b+r.finishedWins.tied!==r.finished)
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
  const finished=cells.reduce((n,r)=>n+r.finished,0);
  const truncated=games-finished;
  const finishedByOriginalCap=cells.reduce((n,r)=>n+r.finishedByOriginalCap,0);
  const finishedAfterOriginalCap=cells.reduce((n,r)=>n+r.finishedAfterOriginalCap,0);
  const awins=cells.reduce((n,r)=>n+r.wins.a,0);
  const bwins=cells.reduce((n,r)=>n+r.wins.b,0);
  const ties=cells.reduce((n,r)=>n+r.wins.tied,0);
  const avgStoneDiff=mean(cells.map(r=>r.meanStoneShare.a-r.meanStoneShare.b));
  const winShareDiff=finished?cells.reduce((n,r)=>n+
    ((r.winShareRate.a??0)-(r.winShareRate.b??0))*r.finished,0)/finished:null;
  const rand=prng(412300+index*10001),bootstrap=[];
  for(let i=0;i<1500;i++){
    bootstrap.push(mean(cells.map(cell=>mean(Array.from({length:8},()=>{
      const n=Math.floor(rand()*8);
      return cell.blocks[n];
    })))));
  }
  bootstrap.sort((x,y)=>x-y);
  const ci95=[bootstrap[Math.floor(bootstrap.length*.025)],bootstrap[Math.floor(bootstrap.length*.975)]];
  return {a,b,games,finished,truncated,finishedByOriginalCap,finishedAfterOriginalCap,
    maxFinishedTurns:Math.max(...cells.map(x=>x.maxFinishedTurns??0)),
    awins,bwins,ties,avgStoneDiff,winShareDiff,ci95,
    observedStoneEdge:ci95[0]>0?a:ci95[1]<0?b:'undetermined',
    finishedWins:{
      a:cells.reduce((n,r)=>n+r.finishedWins.a,0),
      b:cells.reduce((n,r)=>n+r.finishedWins.b,0),
      tied:cells.reduce((n,r)=>n+r.finishedWins.tied,0)
    },
    cells:cells.map(x=>({radius:x.radius,opponent:x.opponent,games:x.games,
      finished:x.finished,truncated:x.truncated,
      awins:x.wins.a,bwins:x.wins.b,ties:x.wins.tied,
      aStoneShare:x.meanStoneShare.a,bStoneShare:x.meanStoneShare.b}))};
});
const present=v=>v===null||!Number.isFinite(v)?'-':(v*100).toFixed(2)+'%';
const lines=[
  '# パス込み追加学習後の5モデル：独立3人対局ベンチマーク',
  '',
  '102,400局の元重みから各20,000局追加（累計122,400局）。合法着手とパスを同じネットワークで直接評価。',
  '学習未使用seed：CPU比較 20471103/20471104、AI同士 20471203/20471204。半径3/4。',
  'CPU比較：各モデル384局（4種のCPU組×2盤面×各48局）。全5モデルで1,920局。',
  'モデル同士：10組×2盤面×第三CPU hard/balanced×48局＝1,920局。6座席ローテーション。',
  '',
  '**重要：旧検証は3×マス数＋3手で打ち切ったが、今回は20×マス数＋3手まで自然終局を観測。上限は安全用であり、ゲームルールではない。**',
  '以下の「観測石数割合」と「石数多」は、未終局の途中盤面も含み、最終勝率ではない。',
  '',
  '## 既存CPUとの比較（観測石数での暫定順位）',
  '',
  '| モデル | 全評価 | 旧上限内で終局 | 旧上限後に終局 | なお未終局 | 観測石数割合 | 自然終局のみの勝利配分率 | hard+balanced相手の観測石数割合 |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...cpuResults.map(x=>'| '+x.id+' | '+x.games+' | '+x.finished+' | '+x.truncated+' | '+
    x.finishedByOriginalCap+' | '+x.finishedAfterOriginalCap+' | '+x.truncated+' | '+
    percent(x.stoneShare)+' | '+present(x.winShare)+' | '+percent(x.hardBalancedShare)+' |'),
  '',
  '## 5モデル同士の直接対戦（各組192局）',
  '',
  '| A | B | 自然終局/192 | 旧上限後に終局 | AがBより多石 | BがAより多石 | 同石 | A-B観測石数差 | ブロックbootstrap95%区間 | 観測上の優位 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---|---|',
  ...h2hResults.map(x=>'| '+x.a+' | '+x.b+' | '+x.finished+'/'+x.games+' | '+
    x.finishedAfterOriginalCap+' | '+x.awins+' | '+x.bwins+' | '+x.ties+' | '+(100*x.avgStoneDiff).toFixed(2)+'pt | ['+
    x.ci95.map(q=>(100*q).toFixed(2)).join(', ')+']pt | '+x.observedStoneEdge+' |'),
  '',
  'bootstrapは4条件ごと8ブロック（各ブロックは6色順）を層化再標本化。区間が0を跨ぐ場合、観測石数の優劣は未確定。',
  '区間が0を跨がなくても、自然終局率が低い場合は「強い」とは断定できない。',
  '推論はgreedy、探索・自己眼の戦略的手フィルターなし。第三プレイヤーの相互作用と盤面サイズ依存に注意。',
  '旧上限を超えて自然に終局する局の数が、旧打ち切り条件による評価の歪みを測る。20倍でも未終局の試合は勝敗不明のまま扱う。',
];

const report={experiment:'pass-five-strength-122400',cpuGamesPerCandidate:384,
 h2hGamesPerPair:192,candidates:cpuResults,pairs:h2hResults,markdown:lines.join('\n')+'\n'};
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
writeFileSync(out.replace(/\.json$/,'.md'),report.markdown);
process.stdout.write(report.markdown);
