#!/usr/bin/env python3
"""Fair 3-architecture comparison for no-phase three-player selfplay.

gnn16: 16-channel, 3 graph-neighbor layers
gnn64: 64-channel, 3 graph-neighbor layers
attn64: gnn64 + 2 full-board attention blocks (4 heads, learned hex distances)
All use the same independent stone-share minus timeout targets.
"""
import argparse
import json
import math
import random
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parent.parent
KINDS = {"gnn16": (16, 0), "gnn64": (64, 0), "attn64": (64, 2)}
FORMAT = "three-color-architecture-compare-resume-v1"


def points(radius):
    return [(q, r) for r in range(-radius, radius + 1)
            for q in range(-radius, radius + 1) if abs(q + r) <= radius]


def topology(radius):
    pts=points(radius)
    lookup={point: index for index,point in enumerate(pts)}
    directions=((1,0),(1,-1),(0,-1),(-1,0),(-1,1),(0,1))
    n=len(pts)
    matrix=torch.zeros((n,n),dtype=torch.float32)
    distance=torch.zeros((n,n),dtype=torch.long)
    for i,(q,r) in enumerate(pts):
        neighbors=[lookup[(q+dq,r+dr)] for dq,dr in directions
                   if (q+dq,r+dr) in lookup]
        for j in neighbors:
            matrix[i,j]=1/len(neighbors)
        for j,(x,y) in enumerate(pts):
            dq,dr=q-x,r-y
            distance[i,j]=max(abs(dq),abs(dr),abs(dq+dr))
    return matrix,distance


class ComparisonNet(nn.Module):
    def __init__(self,kind):
        super().__init__()
        if kind not in KINDS:raise ValueError("Unknown comparison model")
        self.kind=kind
        self.width,self.attention_layers=KINDS[kind]
        d=self.width
        self.layers=nn.ModuleDict({
            "embed":nn.Linear(10,d),
            "mix1":nn.Linear(2*d,d),
            "mix2":nn.Linear(2*d,d),
            "mix3":nn.Linear(2*d,d),
            "policy":nn.Linear(d,1),
            "pass":nn.Linear(d,1),
            "valueHidden":nn.Linear(d,d),
            "value":nn.Linear(d,3),
        })
        for layer in range(1,self.attention_layers+1):
            for name in ("Q","K","V","Out"):
                self.layers[f"attn{layer}{name}"]=nn.Linear(d,d)
            self.layers[f"attn{layer}Ff1"]=nn.Linear(d,d*2)
            self.layers[f"attn{layer}Ff2"]=nn.Linear(d*2,d)
            self.layers[f"attn{layer}Bias"]=nn.Linear(11,4,bias=False)
            nn.init.zeros_(self.layers[f"attn{layer}Bias"].weight)
        self.topologies={}

    def forward(self,features,radius):
        x=torch.as_tensor(features,dtype=torch.float32)
        if x.ndim==2:x=x.unsqueeze(0)
        if x.ndim!=3 or x.shape[-1]!=10 or x.shape[1]!=len(points(radius)):
            raise ValueError("Expected [batch,boardCells,10] no-phase features")
        if radius not in self.topologies:self.topologies[radius]=topology(radius)
        adjacency,distance=self.topologies[radius]
        h=F.relu(self.layers["embed"](x))
        for a in range(1,4):
            avg=torch.matmul(adjacency,h)
            h=F.relu(self.layers[f"mix{a}"](torch.cat((h,avg),dim=-1)))
        b,n,d=h.shape
        for a in range(1,self.attention_layers+1):
            prefix=f"attn{a}"
            q=self.layers[prefix+"Q"](h).reshape(b,n,4,d//4).transpose(1,2)
            k=self.layers[prefix+"K"](h).reshape(b,n,4,d//4).transpose(1,2)
            v=self.layers[prefix+"V"](h).reshape(b,n,4,d//4).transpose(1,2)
            bias=self.layers[prefix+"Bias"].weight[:,distance]
            scores=torch.matmul(q,k.transpose(-2,-1))/math.sqrt(d//4)+bias
            weights=F.softmax(scores,dim=-1)
            context=torch.matmul(weights,v).transpose(1,2).reshape(b,n,d)
            z=F.relu(h+self.layers[prefix+"Out"](context))
            h=F.relu(z+self.layers[prefix+"Ff2"](F.relu(self.layers[prefix+"Ff1"](z))))
        pool=h.mean(dim=1)
        logits=torch.cat((self.layers["policy"](h).squeeze(-1),
                          self.layers["pass"](pool)),dim=1)
        value=self.layers["value"](F.relu(self.layers["valueHidden"](pool)))
        return logits,value


def exported(model,config,total_games,iteration,positions,finished,truncated):
    layers={}
    for name,layer in model.layers.items():
        weight=layer.weight.detach().cpu().reshape(-1)
        bias=layer.bias.detach().cpu() if layer.bias is not None else torch.zeros(layer.out_features)
        layers[name]={
            "rows":layer.out_features,"cols":layer.in_features,
            "weights":[round(float(v),7) for v in weight],
            "bias":[round(float(v),7) for v in bias],
        }
    return {
        "architecture":"tgo-comparison-v1","kind":model.kind,
        "version":f"comparison-{model.kind}-g{total_games}-seed{config['seed']}",
        "algorithm":"shared-three-player-direct-actor-critic",
        "training":"no-phase 3p stone share minus timeout; pass fully legal; no search",
        "metadata":{
            "games":total_games,"iterations":iteration,"positions":positions,
            "features":10,"phaseFeature":False,"valueOutput":"independent",
            "timeoutPenalty":config["timeoutPenalty"],
            "horizonMultiplier":config["horizonMultiplier"],
            "sampleStride":config["sampleStride"],
            "learningRate":config["learningRate"],"temperature":config["temperature"],
            "naturallyEndedGames":finished,"truncatedGames":truncated,
            "radii":config["radii"],"seed":config["seed"],
        },"layers":layers,
    }


def batch_loss(model,samples,entropy_coefficient,temperature,penalty,radius):
    features=torch.tensor([s["features"] for s in samples],dtype=torch.float32)
    logits,pred=model(features,radius)
    legal_mask=torch.zeros_like(logits,dtype=torch.bool)
    chosen=[]
    for i,sample in enumerate(samples):
        legal=sample["legal"]
        if not legal or sample["selected"] not in legal:
            raise ValueError("Illegal sampled action")
        legal_mask[i,legal]=True
        chosen.append(sample["selected"])
    target=torch.tensor([s["value"] for s in samples],dtype=torch.float32)
    if not bool(torch.isfinite(target).all()) or not bool(
        torch.all(target>=-penalty-1e-5)) or not bool(torch.all(target<=1+1e-5)):
        raise ValueError("Invalid signed return")
    logp=F.log_softmax((logits/temperature).masked_fill(~legal_mask,-1e9),dim=1)
    probability=logp.exp()
    selected_logp=logp.gather(1,torch.tensor(chosen).unsqueeze(1)).squeeze(1)
    advantage=target[:,0]-pred[:,0].detach()
    entropy=-(probability*logp).sum(dim=1)
    actor=-(selected_logp*advantage).mean()
    critic=F.mse_loss(pred,target)
    return actor+critic-entropy_coefficient*entropy.mean(),float(advantage.mean().detach())


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--kind",required=True,choices=list(KINDS))
    p.add_argument("--iterations",type=int,default=250)
    p.add_argument("--games",type=int,default=8)
    p.add_argument("--seed",type=int,default=20261103)
    p.add_argument("--radii",default="2,3,4")
    p.add_argument("--temperature",type=float,default=1.5)
    p.add_argument("--learning-rate",type=float,default=0.001)
    p.add_argument("--entropy",type=float,default=0.015)
    p.add_argument("--batch-size",type=int,default=32)
    p.add_argument("--horizon-multiplier",type=int,default=100)
    p.add_argument("--timeout-penalty",type=float,default=0.3)
    p.add_argument("--sample-stride",type=int,default=4)
    p.add_argument("--checkpoint-every",type=int,default=250)
    p.add_argument("--resume",type=Path)
    p.add_argument("--out",type=Path,default=ROOT/"reports"/"compare-candidate.json")
    args=p.parse_args()
    radii=[int(x) for x in args.radii.split(",")]
    if not (1<=args.iterations<=10000 and 1<=args.games<=100 and
            0<=args.seed<=0xffffffff and radii and all(2<=r<=5 for r in radii) and
            0<args.temperature<=10 and 0<args.learning_rate<=0.1 and
            0<=args.entropy<=0.5 and 1<=args.batch_size<=512 and
            1<=args.horizon_multiplier<=100 and 0<=args.timeout_penalty<=2 and
            1<=args.sample_stride<=16 and 0<=args.checkpoint_every<=args.iterations and
            all(map(math.isfinite,(args.temperature,args.learning_rate,args.entropy,args.timeout_penalty)))):
        p.error("Invalid experiment parameters")
    config={
        "kind":args.kind,"games":args.games,"seed":args.seed,"radii":radii,
        "temperature":args.temperature,"learningRate":args.learning_rate,
        "entropy":args.entropy,"batchSize":args.batch_size,
        "horizonMultiplier":args.horizon_multiplier,
        "timeoutPenalty":args.timeout_penalty,"sampleStride":args.sample_stride,
    }
    torch.manual_seed(args.seed)
    torch.set_num_threads(1)
    random.seed(args.seed)
    np.random.seed(args.seed)
    shuffle_rng=random.Random(args.seed)
    model=ComparisonNet(args.kind)
    optimizer=torch.optim.Adam(model.parameters(),lr=args.learning_rate)
    start=total_games=total_positions=finished=truncated=0
    if args.resume:
        state=torch.load(args.resume,map_location="cpu",weights_only=False)
        if state.get("format")!=FORMAT or state.get("config")!=config:
            raise RuntimeError("Wrong comparison resume format/config")
        start=state["iteration"]
        if not 0<start<args.iterations or state["games"]!=start*args.games:
            raise RuntimeError("Wrong resume iteration/game count")
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        shuffle_rng.setstate(state["shuffle_rng"])
        random.setstate(state["global_random"])
        np.random.set_state(state["numpy_rng"])
        torch.set_rng_state(state["torch_rng"])
        total_games=state["games"]
        total_positions=state["positions"]
        finished=state["finished"]
        truncated=state["truncated"]
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="three-color-compare-") as d:
        snapshot=Path(d)/"snapshot.json"
        for iteration in range(start,args.iterations):
            radius=radii[iteration%len(radii)]
            snapshot.write_text(json.dumps(exported(
                model,config,total_games,iteration,total_positions,finished,truncated)))
            seed=(args.seed+iteration*100003)&0xffffffff
            command=[
                "node",str(ROOT/"scripts"/"architecture-selfplay.mjs"),
                "--model",str(snapshot),"--games",str(args.games),
                "--seed",str(seed),"--radius",str(radius),
                "--temperature",str(args.temperature),
                "--horizon-multiplier",str(args.horizon_multiplier),
                "--timeout-penalty",str(args.timeout_penalty),
                "--sample-stride",str(args.sample_stride),
            ]
            result=subprocess.run(command,capture_output=True,text=True,check=True,cwd=ROOT)
            episodes=[json.loads(line) for line in result.stdout.splitlines()]
            if len(episodes)!=args.games:raise RuntimeError("Incorrect game count")
            for episode in episodes:
                if episode["ended"] == episode["truncated"]:raise RuntimeError("Inconsistent game status")
                if episode["truncated"] and episode["turns"]!=episode["horizon"]:
                    raise RuntimeError("Safety horizon mismatch")
                if not np.allclose(episode["rewards"],[
                    s-(args.timeout_penalty if episode["truncated"] else 0)
                    for s in episode["stoneShares"]],atol=1e-8):
                    raise RuntimeError("Reward mismatch")
            samples=[s for g in episodes for s in g["samples"]]
            if not samples:raise RuntimeError("No sampled trajectories")
            shuffle_rng.shuffle(samples)
            losses=[];adv=[]
            for begin in range(0,len(samples),args.batch_size):
                batch=samples[begin:begin+args.batch_size]
                optimizer.zero_grad()
                loss,mean_adv=batch_loss(model,batch,args.entropy,args.temperature,
                                          args.timeout_penalty,radius)
                if not bool(torch.isfinite(loss)):raise RuntimeError("Nonfinite loss")
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(),2)
                optimizer.step()
                losses.append(float(loss.detach()))
                adv.append(mean_adv)
            total_games+=len(episodes)
            total_positions+=len(samples)
            finished+=sum(g["ended"] for g in episodes)
            truncated+=sum(g["truncated"] for g in episodes)
            row={
                "kind":args.kind,"iteration":iteration+1,"totalGames":total_games,
                "radius":radius,"samples":len(samples),
                "naturallyEnded":sum(g["ended"] for g in episodes),
                "truncated":sum(g["truncated"] for g in episodes),
                "meanTurns":round(sum(g["turns"] for g in episodes)/len(episodes),2),
                "loss":round(sum(losses)/len(losses),6),
                "meanAdvantage":round(sum(adv)/len(adv),6),
            }
            print(json.dumps(row),flush=True)
            if args.checkpoint_every and (
                (iteration+1)%args.checkpoint_every==0 or
                iteration+1==args.iterations
            ):
                stamp=f"iter{iteration+1:04d}"
                pt=args.out.with_name(f"{args.out.stem}-{stamp}.pt")
                torch.save({
                    "format":FORMAT,"config":config,"iteration":iteration+1,
                    "model":model.state_dict(),"optimizer":optimizer.state_dict(),
                    "shuffle_rng":shuffle_rng.getstate(),
                    "global_random":random.getstate(),
                    "numpy_rng":np.random.get_state(),
                    "torch_rng":torch.get_rng_state(),
                    "games":total_games,"positions":total_positions,
                    "finished":finished,"truncated":truncated,
                },pt)
                # Export each milestone for head-to-head evaluations without
                # requiring PyTorch or job-local optimizer checkpoint files.
                milestone=args.out.with_name(f"{args.out.stem}-{stamp}.json")
                milestone.write_text(json.dumps(exported(
                    model,config,total_games,iteration+1,total_positions,finished,truncated),
                    separators=(",",":"))+"\n")
    args.out.write_text(json.dumps(exported(
        model,config,total_games,args.iterations,total_positions,finished,truncated),
        separators=(",",":"))+"\n")
    print("Comparison candidate:",args.out,"games:",total_games,flush=True)


if __name__=="__main__":main()
