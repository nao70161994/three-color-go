#!/usr/bin/env python3
"""Teacher-distill existing 512-game square GNN checkpoints without hiding weak results.

Policy imitation is a warm-start, not evidence of improved playing strength.
Hold out entire independently seeded games for cross-entropy and top-1 metrics.
Use independent games/seat rotation and genuine terminal outcomes for adoption.
"""
import argparse
import copy
import json
import random
import runpy
from collections import defaultdict
from pathlib import Path
import torch
from torch.nn import functional as F

ROOT=Path(__file__).resolve().parent.parent
source=runpy.run_path(str(ROOT/"scripts"/"train-architecture-comparison.py"))
ComparisonNet=source["ComparisonNet"]

def load_layers(model,raw):
    if raw["architecture"]!="tgo-comparison-v1" or raw["kind"]!=model.kind or raw["metadata"]["boardShape"]!="square":
        raise ValueError("Expected square pretrained comparison checkpoint")
    with torch.no_grad():
        for name,layer in model.layers.items():
            data=raw["layers"][name]
            if data["rows"]!=layer.out_features or data["cols"]!=layer.in_features:
                raise ValueError("Mismatched pretrained layer "+name)
            layer.weight.copy_(torch.tensor(data["weights"],dtype=torch.float32).view_as(layer.weight))
            if layer.bias is not None:
                layer.bias.copy_(torch.tensor(data["bias"],dtype=torch.float32))

def render(model,raw,records,seed,epoch,lr,valid_metrics):
    layers={}
    for name,layer in model.layers.items():
        weight=layer.weight.detach().reshape(-1)
        bias=layer.bias.detach() if layer.bias is not None else torch.zeros(layer.out_features)
        layers[name]={
            "rows":layer.out_features,"cols":layer.in_features,
            "weights":[round(float(x),7) for x in weight],
            "bias":[round(float(x),7) for x in bias]
        }
    data=copy.deepcopy(raw)
    data.update({
        "version":f"square-teacher-{model.kind}-seed{seed}-epoch{epoch}",
        "algorithm":"512-game-square-selfplay-then-supervised-teacher-distillation",
        "training":"Self-play 512 games, then supervised imitation of three-player balanced/tactical/guarded CPU with distinct heldout games",
        "layers":layers
    })
    previous=data["metadata"].get("teacherDistillationStages",[])
    if not isinstance(previous,list):raise ValueError("Invalid previous teacher stages")
    data["metadata"].update({
        "radii":sorted(set(data["metadata"].get("radii",[])+records["radii"])),
        "teacherTrainingRadii":records["radii"],
        "teacherDistillationStages":[*previous,{
          "source":raw["version"],"seed":seed,"games":records["teacherGames"],
          "positions":records["train"],"epochs":epoch}],
        "teacherDistillation":True,"teacherGames":records["teacherGames"],
        "teacherTrainingSamples":records["train"],"teacherValidationSamples":records["valid"],
        "teacherValidationCrossEntropy":round(valid_metrics["loss"],6),
        "teacherValidationTop1":round(valid_metrics["accuracy"],6),
        "teacherEpoch":epoch,"teacherLearningRate":lr,
        "teacherSeed":seed
    })
    return data

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--kind",required=True,choices=["gnn16","gnn64"])
    p.add_argument("--init",required=True,type=Path)
    p.add_argument("--data",required=True,type=Path)
    p.add_argument("--out",required=True,type=Path)
    p.add_argument("--epochs",type=int,default=22)
    p.add_argument("--batch-size",type=int,default=32)
    p.add_argument("--lr",type=float,default=0.0015)
    p.add_argument("--seed",type=int,default=20261115)
    args=p.parse_args()
    if not (1<=args.epochs<=100 and 1<=args.batch_size<=128 and 1e-6<=args.lr<=0.05 and 0<=args.seed<=0xffffffff):
        p.error("Invalid training settings")
    torch.set_num_threads(1)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    raw=json.loads(args.init.read_text())
    if raw["metadata"]["games"]!=512:raise ValueError("Expected exactly 512 real square selfplay games")
    model=ComparisonNet(args.kind)
    load_layers(model,raw)
    initial=copy.deepcopy(model.state_dict())
    grouped={split:defaultdict(list) for split in ["train","valid"]}
    game_ids={split:set() for split in ["train","valid"]}
    for line in args.data.read_text().splitlines():
        s=json.loads(line)
        split=s["split"]
        if split not in grouped or s["radius"] not in [-9,-13,-19]:
            raise ValueError("Bad teacher dataset split/geometry")
        if not (0<=s["selected"]<=s["radius"]**2):
            raise ValueError("Bad selected action")
        if len(s["features"])!=s["radius"]**2 or any(len(x)!=10 for x in s["features"]):
            raise ValueError("Wrong teacher features")
        if s["selected"] not in s["legal"] or not all(0<=a<=len(s["features"]) for a in s["legal"]):
            raise ValueError("Illegal labeled teacher action")
        grouped[split][s["radius"]].append(s)
        game_ids[split].add(s["gameId"])
    if game_ids["train"]&game_ids["valid"]:raise ValueError("Train/validation game leakage")
    sizes={split:sum(map(len,grouped[split].values())) for split in grouped}
    if min(sizes.values())<20:raise ValueError("Too little teacher data")
    summary={"teacherGames":len(game_ids["train"]),"validGames":len(game_ids["valid"]),
             "radii":sorted(grouped["train"].keys()),**sizes}
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=0.0001)
    best=None
    best_epoch=0
    results=[]
    rng=random.Random(args.seed)
    def batch_items(split,randomize):
        all_batches=[]
        for radius,samples in grouped[split].items():
            indices=list(range(len(samples)))
            if randomize:rng.shuffle(indices)
            for begin in range(0,len(indices),args.batch_size):
                all_batches.append((radius,[samples[i] for i in indices[begin:begin+args.batch_size]]))
        if randomize:rng.shuffle(all_batches)
        return all_batches
    def batch_loss(radius,items):
        features=torch.tensor([s["features"] for s in items],dtype=torch.float32)
        logits,_=model(features,radius)
        mask=torch.zeros_like(logits,dtype=torch.bool)
        for i,s in enumerate(items):mask[i,s["legal"]]=True
        target=torch.tensor([s["selected"] for s in items],dtype=torch.long)
        if not bool(mask.gather(1,target.unsqueeze(1)).all()):raise ValueError("Target masked")
        logits=logits.masked_fill(~mask,-1e9)
        ce=F.cross_entropy(logits,target)
        top1=(logits.argmax(dim=1)==target).sum().item()
        return ce,top1
    for epoch in range(1,args.epochs+1):
        model.train()
        total_loss,total_correct=0.0,0
        for radius,items in batch_items("train",True):
            optimizer.zero_grad()
            loss,correct=batch_loss(radius,items)
            if not bool(torch.isfinite(loss)):raise RuntimeError("Non-finite supervision loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(),2)
            optimizer.step()
            total_loss+=float(loss.detach())*len(items)
            total_correct+=correct
        model.eval()
        with torch.no_grad():
            valid_loss,valid_correct=0.0,0
            for radius,items in batch_items("valid",False):
                loss,correct=batch_loss(radius,items)
                valid_loss+=float(loss)*len(items)
                valid_correct+=correct
        metrics={
          "epoch":epoch,"trainLoss":round(total_loss/sizes["train"],5),
          "trainAccuracy":round(total_correct/sizes["train"],5),
          "validLoss":round(valid_loss/sizes["valid"],5),
          "validAccuracy":round(valid_correct/sizes["valid"],5)
        }
        results.append(metrics)
        print(json.dumps(metrics),flush=True)
        # Best heldout cross-entropy, rather than the last overfit epoch.
        if best is None or metrics["validLoss"]<best:
            best=metrics["validLoss"]
            best_epoch=epoch
            best_state=copy.deepcopy(model.state_dict())
    model.load_state_dict(best_state)
    model.eval()
    metrics={"loss":best,"accuracy":results[best_epoch-1]["validAccuracy"]}
    exported=render(model,raw,summary,args.seed,best_epoch,args.lr,metrics)
    args.out.parent.mkdir(exist_ok=True,parents=True)
    args.out.write_text(json.dumps(exported,separators=(",",":"))+"\n")
    report={
        "kind":args.kind,"initialGames":512,"dataset":summary,"bestEpoch":best_epoch,
        "initializationVersion":raw["version"],"heldoutMetrics":metrics,
        "epochs":results,"output":str(args.out)
    }
    args.out.with_suffix(".report.json").write_text(json.dumps(report,indent=2)+"\n")
    print("BEST",json.dumps({k:v for k,v in report.items() if k!="epochs"}),flush=True)

if __name__=="__main__":main()
