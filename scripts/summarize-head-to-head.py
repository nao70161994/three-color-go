#!/usr/bin/env python3
"""Summarize all 30 checkpoints of 3-player head-to-head tournaments."""
import csv,json,sys
from pathlib import Path
if len(sys.argv)!=4: raise SystemExit('Usage: summarize-head-to-head.py ARTIFACT_DIR OUT.md OUT.csv')
root,md,csvout=map(Path,sys.argv[1:])
kinds=('gnn16','gnn64','attn64')
pairs=(('gnn16','gnn64'),('gnn16','attn64'),('gnn64','attn64'))
rows=[]
pairrows=[]
def pct(x): return '—' if x is None else f'{x:.1%}'
for games in range(2000,60001,2000):
    path=root/f'h2h-{games}'/'report.json'
    if not path.is_file(): raise RuntimeError('Missing '+str(path))
    data=json.loads(path.read_text())
    if data['gamesTrained']!=games or data['version']!=1 or set(data['models'])!=set(kinds):
        raise ValueError('Wrong checkpoint metadata '+str(path))
    if data['forcedPasses'] or not data['passIsLegal'] or len(data['results'])!=2:
        raise ValueError('Invalid game controls '+str(path))
    triple_wins={k:0. for k in kinds}
    triple_exposures={k:0 for k in kinds}
    greedy_wins={k:0. for k in kinds}
    greedy_exposures={k:0 for k in kinds}
    natural=total=0
    for radiusdata in data['results']:
        radius=radiusdata['radius']
        if radius not in (3,4):raise ValueError('Unexpected radius')
        t=radiusdata['triple'];g=radiusdata['greedyTriple']
        natural+=t['finished'];total+=t['games']
        for k in kinds:
            s=t['byKind'][k]
            if s['winSharePerFinishedSeat'] is not None:
                triple_wins[k]+=s['winSharePerFinishedSeat']*s['finishedSeatExposures']
            triple_exposures[k]+=s['finishedSeatExposures']
            gs=g['byKind'][k]
            if gs['winSharePerFinishedSeat'] is not None:
                greedy_wins[k]+=gs['winSharePerFinishedSeat']*gs['finishedSeatExposures']
            greedy_exposures[k]+=gs['finishedSeatExposures']
        for a,b in pairs:
            z=radiusdata['pairwise'][a+'_vs_'+b]
            sa,sb=z['byKind'][a],z['byKind'][b]
            if sa['seatExposures']!=sb['seatExposures']:
                raise ValueError('Unbalanced seat exposures')
            pairrows.append({
                'gamesTrained':games,'radius':radius,'a':a,'b':b,
                'games':z['games'],'finished':z['finished'],'seatsEach':sa['seatExposures'],
                'aWin':sa['winSharePerFinishedSeat'],'bWin':sb['winSharePerFinishedSeat'],
                'aStone':sa['observedStoneSharePerSeat'],
                'bStone':sb['observedStoneSharePerSeat'],
            })
    if total!=data['rounds']*12:
        raise ValueError('Incomplete three-way benchmark')
    row={'gamesTrained':games,'games':total,'natural':natural}
    for k in kinds:
        row[k+'Win']=triple_wins[k]/triple_exposures[k] if triple_exposures[k] else None
        row[k+'GreedyWin']=greedy_wins[k]/greedy_exposures[k] if greedy_exposures[k] else None
    rows.append(row)
md.parent.mkdir(parents=True,exist_ok=True)
csvout.parent.mkdir(parents=True,exist_ok=True)
with csvout.open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
with csvout.with_name(csvout.stem+'-pairwise.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(pairrows[0]));w.writeheader();w.writerows(pairrows)
lines=[
    '# 三色囲碁：全30チェックポイントで3モデル直接対戦',
    '',
    '各学習局数、半径3・4それぞれで6座席順×2乱数反復の確率方策による三者同時対戦。',
    '勝利配分率は自然終局局のみ。人工パスはなし。',
    '',
    '## 3モデル同時対戦：確率方策',
    '| 学習局数 | GNN16 | GNN64 | Attention64 | 自然終局 |',
    '|---:|---:|---:|---:|---:|',
]
for r in rows:
    lines.append(f"| {r['gamesTrained']:,} | {pct(r['gnn16Win'])} | {pct(r['gnn64Win'])} | {pct(r['attn64Win'])} | {r['natural']}/{r['games']} |")
lines+=['','## 3モデル同時対戦：最大logitを選ぶ貪欲方策',
        '| 学習局数 | GNN16 | GNN64 | Attention64 |',
        '|---:|---:|---:|---:|']
for r in rows:
    lines.append(f"| {r['gamesTrained']:,} | {pct(r['gnn16GreedyWin'])} | {pct(r['gnn64GreedyWin'])} | {pct(r['attn64GreedyWin'])} |")
lines+=['','## 2モデル比較：AABとABBを公平に交互に配置',
        '| 学習局数 | 半径 | 対戦カード | A勝利配分率/席 | B勝利配分率/席 | 自然終局 |',
        '|---:|---:|---|---:|---:|---:|']
for r in pairrows:
    lines.append(f"| {r['gamesTrained']:,} | {r['radius']} | {r['a']} vs {r['b']} | {pct(r['aWin'])} | {pct(r['bWin'])} | {r['finished']}/{r['games']} |")
lines+=['','注意：2モデル比較は厳密な1対1ではなく三人ゲームのAAB/ABB対戦。',
        'AとBが二つの席を交互に担当するため、合計勝利回数ではなく「1席あたり」で比較する。',
        '近接した学習チェックポイントと同じ評価seedは独立したサンプルでない。',
        'また、各構造の学習seedは1つだけなので結論は暫定的。']
md.write_text('\n'.join(lines)+'\n')
print('\n'.join(lines))
