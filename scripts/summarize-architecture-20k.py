#!/usr/bin/env python3
"""Combine all heldout 2k-game milestones with natural-finish caveats."""
import csv
import json
import re
import sys
from pathlib import Path

if len(sys.argv)!=4:
    raise SystemExit("Usage: summarize-architecture-20k.py artifact-dir summary.md summary.csv")
root,output_md,output_csv=map(Path,sys.argv[1:])
rows=[]
for directory in sorted(root.glob("architecture-milestone-*-*")):
    match=re.fullmatch(r"architecture-milestone-(\d+)-(gnn16|gnn64|attn64)",directory.name)
    if not match:continue
    iteration,kind=int(match.group(1)),match.group(2)
    model=json.loads((directory/"model.json").read_text())
    if model["kind"]!=kind or model["metadata"]["games"]!=iteration*8:
        raise ValueError("Mismatched model at "+directory.name)
    for radius in (3,4):
        record=json.loads((directory/f"eval-r{radius}.json").read_text())
        if record["kind"]!=kind or record["trainingGames"]!=iteration*8:
            raise ValueError("Mismatched evaluation at "+directory.name)
        rows.append({
            "kind":kind,"gamesTrained":iteration*8,"radius":radius,
            "naturalTraining":model["metadata"]["naturallyEndedGames"],
            "truncatedTraining":model["metadata"]["truncatedGames"],
            "testGames":record["games"],"naturalTest":record["finished"],
            "truncatedTest":record["truncated"],
            "naturalEndRate":record["naturalEndRate"],
            "finishedWinShare":record["finishedWinShare"],
            "meanObservedStoneShare":record["meanObservedStoneShare"],
            "meanFinishedTurns":record["meanFinishedTurns"],
            "earlyPassCount":record["earlyPassCount"],
        })
expected={(kind,games,radius)
          for kind in ("gnn16","gnn64","attn64")
          for games in range(2000,20001,2000)
          for radius in (3,4)}
got={(r["kind"],r["gamesTrained"],r["radius"]) for r in rows}
if got!=expected:
    raise ValueError(f"Expected 60 independent benchmark records, missing {sorted(expected-got)}")
output_md.parent.mkdir(parents=True,exist_ok=True)
output_csv.parent.mkdir(parents=True,exist_ok=True)
with output_csv.open('w',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]))
    writer.writeheader();writer.writerows(rows)
lines=[
    "# 三色囲碁 20,000局×3モデル比較",
    "",
    "全モデルで同じ盤面半径2,3,4、10特徴量、報酬（石数割合−上限到達時0.3）、seed、temperature1.5、Adam LR0.001、8局/反復、100×の自己対戦安全上限。",
    "途中評価は各2,000局でradius3/4それぞれ18局、同じ未使用seed、相手はbalanced+tactical CPU、評価上限20×。3座席を循環。",
    "",
    "| 学習局数 | モデル | 半径 | 自然終局 | 終局局の勝利配分率 | 観測石数割合 | 序盤パス局 |",
    "|---:|---|---:|---:|---:|---:|---:|",
]
for row in sorted(rows,key=lambda r:(r["gamesTrained"],r["radius"],r["kind"])):
    win='—' if row["finishedWinShare"] is None else f"{row['finishedWinShare']:.1%}"
    lines.append(
        f"| {row['gamesTrained']:,} | {row['kind']} | {row['radius']} | "
        f"{row['naturalTest']}/{row['testGames']} | {win} | "
        f"{row['meanObservedStoneShare']:.1%} | {row['earlyPassCount']} |"
    )
lines.extend([
    "",
    "**解釈上の制限：** 自然終局しなかった対局は勝敗不明（censored）で、勝利配分率の分母から除く。観測石数割合は未終局の局面も含むため勝率とは異なる。",
    "同じベンチマーク種目を繰り返し確認するので、比較先に過適合して最良checkpointを選ばない。学習曲線と別seedの最終評価を併記する。",
    "",
])
output_md.write_text("\n".join(lines),encoding="utf-8")
print("\n".join(lines))
