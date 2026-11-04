#!/usr/bin/env python3
"""Estimate cross-era strength from genuine finished multi-player games.

Pairwise observation: which of A/B has more FINAL stones while BOTH face a
common third baseline in the same 3-player game. This is not a 2-player win
percentage. Apply a regularized Bradley-Terry log-odds model to natural
finishes; keep censored games out of wins and report separately.

Checkpoint selection: broad cross-era stage1 determines stage2 finalists.
Stage2 uses separate seeds, same frozen models, and is reported separately.
"""
import argparse
import csv
import json
import math
from pathlib import Path
from itertools import combinations

def fit_ratings(entries,pairs):
    """Regularized Bradley-Terry maximum log-likelihood, zero-mean gauge."""
    n=len(entries);ids=[e["id"] for e in entries];lookup={k:i for i,k in enumerate(ids)}
    rating=[0.0]*n
    ridge=1.5
    complete=[p for p in pairs if p["finished"]>0]
    for step in range(1500):
        grad=[-ridge*x for x in rating]
        curvature=[ridge for x in rating]
        for pair in complete:
            i,j=lookup[pair["a"]],lookup[pair["b"]]
            observed=pair["aOutranksB"]+.5*pair["ties"]
            denom=pair["finished"]
            diff=max(-40.0,min(40.0,rating[i]-rating[j]))
            probability=1/(1+math.exp(-diff))
            residual=observed-denom*probability
            grad[i]+=residual;grad[j]-=residual
            information=denom*probability*(1-probability)
            curvature[i]+=information;curvature[j]+=information
        changed=max(abs(g/max(c,1e-5)) for g,c in zip(grad,curvature))
        rate=0.35
        updated=[x+rate*g/c for x,g,c in zip(rating,grad,curvature)]
        center=sum(updated)/n
        rating=[x-center for x in updated]
        if changed<1e-8:break
    summary=[]
    for i,e in enumerate(entries):
        seen=sum(p["finished"] for p in complete if e["id"] in (p["a"],p["b"]))
        censored=sum(p["truncated"] for p in pairs if e["id"] in (p["a"],p["b"]))
        games=sum(p["games"] for p in pairs if e["id"] in (p["a"],p["b"]))
        score=rating[i]*400/math.log(10)
        # Diagonal curvature is NOT a valid independent-sample CI, as seat
        # rotations within the same seed share setup and training path.
        summary.append({
            "id":e["id"],"type":e["type"],"architecture":e["architecture"],
            "modelVersion":e["version"],"trainingGames":e.get("games",e.get("historicalTrainingGames")),
            "rating":round(score,1),"games":games,"finished":seen,
            "truncated":censored,"naturalEndRate":round(seen/games,5) if games else None,
            "approxInformation":round(curvature[i],1)
        })
    summary.sort(key=lambda x:x["rating"],reverse=True)
    return summary

def shortlist(ratings,ids):
    # Select highest 7 across models plus the strongest candidate for each
    # architecture (and historical PV2 group). Keep benchmark CPU as anchor
    # if it is among the top 7; otherwise final stage does not need it.
    ranks=[r for r in ratings if r["type"]!="cpu" and r["naturalEndRate"] is not None
           and r["naturalEndRate"]>=0.80]
    chosen=[r["id"] for r in ranks[:7]]
    for prefix in ("gnn16-","gnn64-","attn64-","old"):
        row=next((r for r in ranks if r["id"].startswith(prefix)),None)
        if row and row["id"] not in chosen:chosen.append(row["id"])
    # At least one historical model participates even if its win rate was
    # clearly below the new models.
    if not any(i.startswith("old") for i in chosen):
        old=next((r for r in ratings if r["id"].startswith("old")),None)
        if old:chosen.append(old["id"])
    if len(chosen)>10:chosen=chosen[:10]
    return chosen

def read_chunks(root,tag,expected_chunks,manifest):
    all_pairs=[]
    for chunk in range(expected_chunks):
        file=root/(f"{tag}-chunk-{chunk}")/"report.json"
        if not file.exists():raise RuntimeError(f"Missing tournament chunk {file}")
        r=json.loads(file.read_text(encoding="utf8"))
        if r["version"]!=1 or r["chunk"]!=chunk or r["chunks"]!=expected_chunks:
            raise ValueError(f"Wrong chunk metadata {file}")
        all_pairs.extend(r["pairs"])
    seen=set()
    universe={x["id"] for x in manifest["entries"]}
    for row in all_pairs:
        a,b=row["a"],row["b"]
        if a not in universe or b not in universe or a==b:
            raise ValueError("Unknown or self match")
        pair=tuple(sorted((a,b)))
        if pair in seen:raise ValueError("Repeated candidate pair")
        seen.add(pair)
        if row["finished"]+row["truncated"]!=row["games"]:
            raise ValueError("Finish/censor totals inconsistent")
        if row["aOutranksB"]+row["bOutranksA"]+row["ties"]!=row["finished"]:
            raise ValueError("Incorrect rank totals")
        if row["games"]%12!=0:raise ValueError("Expected six permutations per radius")
    return all_pairs

def output(prefix,entries,pairs,ratings,selection=None):
    prefix.parent.mkdir(parents=True,exist_ok=True)
    csvfile=prefix.with_suffix(".csv")
    with csvfile.open("w",newline="",encoding="utf8") as f:
        writer=csv.DictWriter(f,fieldnames=list(ratings[0].keys()))
        writer.writeheader();writer.writerows(ratings)
    pairfile=prefix.with_name(prefix.name+"-pairs.csv")
    keys=["a","b","bridge","games","finished","truncated","aOutranksB","ties","bOutranksA",
          "winShareA","winShareB","meanObservedStoneA","meanObservedStoneB"]
    with pairfile.open("w",newline="",encoding="utf8") as f:
        writer=csv.DictWriter(f,fieldnames=keys)
        writer.writeheader()
        for row in pairs:writer.writerow({k:row.get(k) for k in keys})
    lines=[
        "# 三色囲碁・異なる学習局数と旧モデルを含む実力推定",
        "",
        f"候補 {len(entries)}種類、対戦組 {len(pairs)}組、実試合 {sum(p['games'] for p in pairs):,}局。",
        "黒・白・赤の6席順を公平に入れ替え、2候補と第三者の従来型CPUを対戦させた。",
        "各自然終局対局についてAとBの最終石数の多寡を比較し、同石は0.5ずつ。",
        "正則化Bradley-Terryで相手の強さも考慮してレーティングを推定（全候補の平均を0）。",
        "**レーティングはこの評価条件での相対スコアであり、Chess Eloや人間の囲碁段位ではない。**",
        "",
        "| 順位 | モデル | 学習局数 | 相対レート | 自然終局/対戦数 |",
        "|---:|---|---:|---:|---:|",
    ]
    for i,row in enumerate(ratings,1):
        games=row["trainingGames"]
        games="—" if games is None else f"{games:,}"
        lines.append(f"| {i} | {row['id']} | {games} | {row['rating']:+.1f} | "
                     f"{row['finished']}/{row['games']} |")
    if selection:
        lines+=["","## 別乱数で再対戦する最終候補","",
                ", ".join(selection),""]
    lines+=["","**解釈と限界：** 本表の勝敗指標は『相手モデルより石が多かったか』であり、"
            "3人対局全体の1位率ではない。勝敗は自然終局対局のみ集計、未終局は打ち切りとして"
            "勝敗を推定しない。"
            "第三CPUの種類、盤面半径3/4、ゲームの乱数、ゲームごとに動く従来CPUの性質に依存する。"
            "6色順は独立試行ではない。各モデル系列の学習seedは各1種類で、"
            "強さの因果差や真の絶対棋力を断定しない。",
            "旧モデルは石数割合報酬など学習条件が異なるため、同じ『学習局数』を同じ計算量とはみなさない。",
            ""]
    md=prefix.with_suffix(".md")
    md.write_text("\n".join(lines),encoding="utf8")
    print("\n".join(lines))
    return md,csvfile,pairfile

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--manifest",type=Path,required=True)
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--tag",required=True)
    p.add_argument("--chunks",type=int,required=True)
    p.add_argument("--prefix",type=Path,required=True)
    p.add_argument("--select-out",type=Path)
    p.add_argument("--selection-input",type=Path)
    args=p.parse_args()
    manifest=json.loads(args.manifest.read_text(encoding="utf8"))
    pairs=read_chunks(args.root,args.tag,args.chunks,manifest)
    ids={x["id"] for x in manifest["entries"]}
    if args.selection_input:
        allowed=json.loads(args.selection_input.read_text(encoding="utf8"))["finalists"]
        if len(pairs)!=len(allowed)*(len(allowed)-1)//2:
            raise ValueError("Missing playoff pair")
        if any(p["a"] not in allowed or p["b"] not in allowed for p in pairs):
            raise ValueError("Playoff pair not in finalists")
        entries=[e for e in manifest["entries"] if e["id"] in allowed]
        selected=None
    else:
        if len(pairs)!=len(ids)*(len(ids)-1)//2:
            raise ValueError(f"Stage1 expected every pair of {len(ids)} contestants")
        entries=manifest["entries"]
        selected=None
    ratings=fit_ratings(entries,pairs)
    if args.select_out:
        selected=shortlist(ratings,ids)
        if len(selected)<6:raise ValueError("Not enough finalists")
        args.select_out.parent.mkdir(parents=True,exist_ok=True)
        args.select_out.write_text(json.dumps({"version":1,"finalists":selected,
            "pairs":[list(v) for v in combinations(selected,2)],
            "origin":"stage1 rank with >=80% natural finish; plus architecture/history coverage",
            "selectionWasIndependentOfPlayoffSeed":True},indent=2)+"\n",encoding="utf8")
    output(args.prefix,entries,pairs,ratings,selected)

if __name__=="__main__":main()
