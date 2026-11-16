#!/usr/bin/env python3
"""Run genuine 3-color league RL from a teacher-distilled square GNN.

Use a FROZEN teacher-distilled policy as a regularization anchor. Compare each
milestone against its source checkpoint in independent completed games. Do NOT
automatically promote a checkpoint based on training reward or sample count.
"""
import argparse
import copy
import hashlib
import json
import math
import random
import runpy
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

ROOT=Path(__file__).resolve().parent.parent
teacher=runpy.run_path(str(ROOT/"scripts"/"train-square-teacher.py"))
ComparisonNet=teacher["ComparisonNet"]
load_layers=teacher["load_layers"]

def serialize(net,base,config,iteration,games,finished,samples):
    result=copy.deepcopy(base)
    result["version"]=f"square-league-{net.kind}-r{abs(config['radius'])}-g{games}-seed{config['seed']}"
    result["algorithm"]="teacher-anchored-on-policy-three-player-league-actor-critic"
    result["training"]="Model versus a frozen teacher-distilled GNN and varied tactical CPUs; real legal moves, terminal wins and stone share"
    layers={}
    for name,layer in net.layers.items():
        w=layer.weight.detach().cpu().reshape(-1)
        b=layer.bias.detach().cpu() if layer.bias is not None else torch.zeros(layer.out_features)
        layers[name]={"rows":layer.out_features,"cols":layer.in_features,
                      "weights":[round(float(v),7) for v in w],
                      "bias":[round(float(v),7) for v in b]}
    result["layers"]=layers
    result["metadata"]["league"]={
        "iteration":iteration,"games":games,"finished":finished,
        "truncated":games-finished,"sampledPositions":samples,
        "seed":config["seed"],"radius":config["radius"],
        "temperature":config["temperature"],"learningRate":config["lr"],
        "anchorKlCoefficient":config["kl"],"criticCoefficient":config["critic"],
        "entropyCoefficient":config["entropy"],
        "horizonMultiplier":config["horizonMultiplier"],
        "sourceVersion":base["version"],
        "sourceSha256":config["sourceSha256"],
        "opponents":["same-kind frozen teacher GNN","balanced","tactical","guarded"],
    }
    return result

def loss_batch(model,anchor,samples,radius,config):
    f=torch.tensor(np.asarray([s["features"] for s in samples],dtype=np.float32))
    logits,values=model(f,radius)
    with torch.no_grad():
        oldlog,_=anchor(f,radius)
    legal=torch.zeros_like(logits,dtype=torch.bool)
    for i,s in enumerate(samples):
        legal[i,s["legal"]]=True
        if s["selected"] not in s["legal"]:raise ValueError("Illegal RL action")
    selection=torch.tensor([s["selected"] for s in samples],dtype=torch.long)
    targets=torch.tensor([s["value"] for s in samples],dtype=torch.float32)
    if not bool(torch.isfinite(targets).all()) or not bool((targets>=-0.31).all()) or not bool((targets<=1.01).all()):
        raise ValueError("Bad terminal rewards")
    mask=~legal
    logits=(logits/config["temperature"]).masked_fill(mask,-1e9)
    oldlog=(oldlog/config["temperature"]).masked_fill(mask,-1e9)
    logp=F.log_softmax(logits,dim=1)
    probs=logp.exp()
    logold=F.log_softmax(oldlog,dim=1)
    advantage=(targets[:,0]-values[:,0].detach())
    actor=-(advantage*logp.gather(1,selection.unsqueeze(1)).squeeze(1)).mean()
    critic=F.mse_loss(values,targets)
    kl=(probs*(logp-logold)).sum(dim=1).mean()
    entropy=-(probs*logp).sum(dim=1).mean()
    full=actor+config["critic"]*critic+config["kl"]*kl-config["entropy"]*entropy
    return full,{"actor":actor.item(),"critic":critic.item(),"kl":kl.item(),"entropy":entropy.item()}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",required=True,type=Path)
    p.add_argument("--radius",type=int,required=True,choices=[-9,-13])
    p.add_argument("--iterations",type=int,default=12)
    p.add_argument("--games",type=int,default=3)
    p.add_argument("--seed",type=int,default=20261116)
    p.add_argument("--temperature",type=float,default=1)
    p.add_argument("--lr",type=float,default=0.00015)
    p.add_argument("--kl",type=float,default=0.12)
    p.add_argument("--entropy",type=float,default=0.002)
    p.add_argument("--critic",type=float,default=0.30)
    p.add_argument("--batch-size",type=int,default=24)
    p.add_argument("--sample-stride",type=int,default=2)
    p.add_argument("--horizon-multiplier",type=int,default=3)
    p.add_argument("--checkpoint-every",type=int,default=4)
    p.add_argument("--out",required=True,type=Path)
    args=p.parse_args()
    if not (1<=args.iterations<=200 and 1<=args.games<=24 and 0<=args.seed<=0xffffffff and
        0<args.temperature<=5 and 1e-7<=args.lr<=0.01 and 0<=args.kl<=2 and
        0<=args.entropy<=.05 and 0<args.critic<=2 and 1<=args.batch_size<=128 and
        1<=args.sample_stride<=8 and 2<=args.horizon_multiplier<=10 and
        1<=args.checkpoint_every<=args.iterations and
        all(map(math.isfinite,(args.temperature,args.lr,args.kl,args.entropy,args.critic)))):
        p.error("Invalid RL parameters")
    raw_bytes=args.source.read_bytes()
    base=json.loads(raw_bytes)
    if base.get("kind")!="gnn64" or base.get("metadata",{}).get("boardShape")!="square" or not base["metadata"].get("teacherDistillation"):
        raise ValueError("Expected an actual teacher-distilled GNN64 source")
    config={"radius":args.radius,"seed":args.seed,"temperature":args.temperature,
        "lr":args.lr,"kl":args.kl,"entropy":args.entropy,"critic":args.critic,
        "sampleStride":args.sample_stride,"horizonMultiplier":args.horizon_multiplier,
        "sourceSha256":hashlib.sha256(raw_bytes).hexdigest()}
    torch.set_num_threads(1)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    random.seed(args.seed)
    model=ComparisonNet("gnn64")
    anchor=ComparisonNet("gnn64")
    load_layers(model,base)
    load_layers(anchor,base)
    anchor.eval()
    for param in anchor.parameters():param.requires_grad_(False)
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr,weight_decay=0.00005)
    shuffle=random.Random(args.seed)
    games=finished=positions=0
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="square-league-") as d:
        temp=Path(d)/"candidate.json"
        for iteration in range(1,args.iterations+1):
            temp.write_text(json.dumps(serialize(model,base,config,iteration-1,games,finished,positions)))
            seed=(args.seed+(iteration-1)*7919)&0xffffffff
            command=["node",str(ROOT/"scripts"/"square-league-selfplay.mjs"),
               "--model",str(temp),"--anchor",str(args.source.resolve()),
               "--radius",str(args.radius),"--games",str(args.games),
               "--seed",str(seed),"--temperature",str(args.temperature),
               "--horizon-multiplier",str(args.horizon_multiplier),
               "--sample-stride",str(args.sample_stride)]
            episodes=[json.loads(s) for s in subprocess.run(
                command,cwd=ROOT,check=True,capture_output=True,text=True).stdout.splitlines()]
            if len(episodes)!=args.games:raise RuntimeError("Wrong number of league games")
            for e in episodes:
                if e["finished"]==e["truncated"]:raise RuntimeError("Incomplete end annotation")
                if e["truncated"] and e["turns"]!=e["horizon"]:
                    raise RuntimeError("Truncation not at horizon")
                if not e["samples"]:raise RuntimeError("No model-controlled decisions")
            samples=[sample for e in episodes for sample in e["samples"]]
            shuffle.shuffle(samples)
            sums={k:0.0 for k in ("actor","critic","kl","entropy")}
            num=0
            model.train()
            for i in range(0,len(samples),args.batch_size):
                batch=samples[i:i+args.batch_size]
                optimizer.zero_grad()
                loss,metrics=loss_batch(model,anchor,batch,args.radius,config)
                if not bool(torch.isfinite(loss)):raise RuntimeError("Nonfinite RL loss")
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(),1)
                optimizer.step()
                for k,v in metrics.items():sums[k]+=v*len(batch)
                num+=len(batch)
            games+=len(episodes)
            finished+=sum(e["finished"] for e in episodes)
            positions+=len(samples)
            row={"iteration":iteration,"games":games,"finished":finished,
                 "samples":len(samples),
                 "candidateStoneShare":round(sum(e["shares"][e["candidateSeat"]] for e in episodes)/len(episodes),4),
                 "candidateWinShare":round(sum(e["wins"][e["candidateSeat"]] for e in episodes)/len(episodes),4),
                 "earlyPasses":sum(e["earlyPasses"] for e in episodes)}
            row.update({k:round(v/max(1,num),6) for k,v in sums.items()})
            print(json.dumps(row),flush=True)
            if iteration%args.checkpoint_every==0 or iteration==args.iterations:
                snapshot=args.out.with_name(f"{args.out.stem}-iter{iteration:04d}.json")
                snapshot.write_text(json.dumps(serialize(model,base,config,iteration,games,finished,positions),separators=(",",":"))+"\n")
    args.out.write_text(json.dumps(serialize(model,base,config,args.iterations,games,finished,positions),separators=(",",":"))+"\n")
    print("LEAGUE",json.dumps({"out":str(args.out),"games":games,"finished":finished,"sampledPositions":positions}),flush=True)

if __name__=="__main__":main()
