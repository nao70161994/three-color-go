#!/usr/bin/env python3
"""Summarize 2k-checkpoint learning curves from *both* verified workflow runs.

The old run supplies 2k..20k (30 artifacts); continuation supplies
22k..60k (60 artifacts). All statistics are observed holdout outcomes.
"""
import csv
import json
import re
import sys
from pathlib import Path

if len(sys.argv)!=4:
    raise SystemExit("Usage: summarize-architecture-60k.py artifact-dir summary.md summary.csv")
root,md_path,csv_path=map(Path,sys.argv[1:])
rows=[]
for folder in sorted(root.glob("architecture-milestone-*-*")):
    match=re.fullmatch(r"architecture-milestone-(\d+)-(gnn16|gnn64|attn64)",folder.name)
    if not match:continue
    iteration,kind=int(match.group(1)),match.group(2)
    model=json.loads((folder/"model.json").read_text(encoding="utf-8"))
    games=iteration*8
    meta=model["metadata"]
    if (model["kind"]!=kind or meta["games"]!=games or
            meta["naturallyEndedGames"]+meta["truncatedGames"]!=games):
        raise ValueError("Model / training count mismatch at "+folder.name)
    for radius in (3,4):
        evaluation=json.loads((folder/f"eval-r{radius}.json").read_text(encoding="utf-8"))
        if (evaluation["kind"]!=kind or evaluation["radius"]!=radius or
                evaluation["trainingGames"]!=games or
                evaluation["finished"]+evaluation["truncated"]!=evaluation["games"]):
            raise ValueError("Evaluation / training mismatch at "+folder.name)
        rows.append({
            "kind":kind,"gamesTrained":games,"radius":radius,
            "naturalTraining":meta["naturallyEndedGames"],
            "truncatedTraining":meta["truncatedGames"],
            "testGames":evaluation["games"],
            "naturalTest":evaluation["finished"],
            "truncatedTest":evaluation["truncated"],
            "naturalEndRate":evaluation["naturalEndRate"],
            "finishedWinShare":evaluation["finishedWinShare"],
            "meanObservedStoneShare":evaluation["meanObservedStoneShare"],
            "meanFinishedTurns":evaluation["meanFinishedTurns"],
            "earlyPassCount":evaluation["earlyPassCount"],
        })

expected={(kind,games,radius) for kind in ("gnn16","gnn64","attn64")
          for games in range(2000,60001,2000) for radius in (3,4)}
got={(row["kind"],row["gamesTrained"],row["radius"]) for row in rows}
if got!=expected or len(rows)!=len(expected):
    raise ValueError(f"Expected all {len(expected)} distinct heldout records, missing {sorted(expected-got)}")
csv_path.parent.mkdir(parents=True,exist_ok=True)
with csv_path.open("w",newline="",encoding="utf-8") as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]))
    writer.writeheader();writer.writerows(sorted(rows,key=lambda r:(r["gamesTrained"],r["kind"],r["radius"])))

lines=[
    "# 三色囲碁AI：20,000局→60,000局への継続学習結果",
    "",
    "同じcheckpointから各40,000局追加学習（gnn16/gnn64/attn64）。最適化器・乱数状態を継続。"
    "元の20,000局と合わせて各60,000局。各2,000局で同一CPU対局による途中評価。",
    "",
    "評価：半径3/4をそれぞれ18局、balanced/tactical CPU、固定heldout seed、"
    "自然終局した対局のみ勝利配分率の分母に含める。",
    "",
    "| 局数 | モデル | 半径3 勝利配分率 | 半径4 勝利配分率 | 2盤面総合 | 自然終局 | 平均観測石数割合 |",
    "|---:|---|---:|---:|---:|---:|---:|",
]
for games in range(2000,60001,2000):
    for kind in ("gnn16","gnn64","attn64"):
        pair=sorted((r for r in rows if r["kind"]==kind and r["gamesTrained"]==games),
                    key=lambda r:r["radius"])
        count=sum(r["naturalTest"] for r in pair)
        wins=sum(r["finishedWinShare"]*r["naturalTest"] for r in pair
                 if r["finishedWinShare"] is not None)
        overall=f"{wins/count:.1%}" if count else "—"
        wins_by_radius=[
            "—" if r["finishedWinShare"] is None else f"{r['finishedWinShare']:.1%}"
            for r in pair
        ]
        observed=sum(r["meanObservedStoneShare"]*r["testGames"] for r in pair)
        denominator=sum(r["testGames"] for r in pair)
        lines.append(f"| {games:,} | {kind} | {wins_by_radius[0]} | {wins_by_radius[1]} "
                     f"| {overall} | {count}/{denominator} | {observed/denominator:.1%} |")
lines.extend([
    "",
    "**制限事項**：同じ小規模の固定CPU相手を繰り返し評価している。"
    "この数値は3モデル間の直接対戦の勝率でも、人間対戦の強さでもない。",
    "未終局の対局は打ち切りとして勝敗不明にする。"
    "長期学習による収束判定には、複数seed・追加対戦相手との検証が必要。",
    "",
])
md_path.parent.mkdir(parents=True,exist_ok=True)
md_path.write_text("\n".join(lines),encoding="utf-8")
print("\n".join(lines))
