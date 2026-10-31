"""Retrain the compact offline neural policy from generated three-color hex games.

Requires Python 3, numpy and torch. Run: python scripts/train-neural-policy.py
This is supervised distillation of an explicit tactical teacher, NOT AlphaZero.
The output is quantized for offline browser inference. No private game data used.
"""
import base64
import json
import random
from pathlib import Path
import numpy as np
import torch

SEED = 20261031
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
torch.set_num_threads(2)
DIRS = [(1,0),(1,-1),(0,-1),(-1,0),(-1,1),(0,1)]

def points(radius):
    return [(q,r) for r in range(-radius,radius+1)
        for q in range(-radius,radius+1) if abs(q+r)<=radius]

def adjacent(p,radius):
    q,r=p
    return [(q+dq,r+dr) for dq,dr in DIRS
        if max(abs(q+dq),abs(r+dr),abs(q+r+dq+dr))<=radius]

def group(board,p,radius):
    color=board.get(p)
    if color is None:return [],set()
    stones=[p];seen={p};libs=set()
    for cur in stones:
        for a in adjacent(cur,radius):
            value=board.get(a)
            if value is None:libs.add(a)
            elif value==color and a not in seen:seen.add(a);stones.append(a)
    return stones,libs

def try_move(board,p,turn,radius):
    if p in board:return None
    nextb=board.copy();nextb[p]=turn
    captured=[];seen=set()
    for neighbor in adjacent(p,radius):
        if neighbor not in nextb or nextb[neighbor]==turn or neighbor in seen:continue
        stones,libs=group(nextb,neighbor,radius);seen.update(stones)
        if not libs:captured.extend(stones)
    for c in captured:nextb.pop(c,None)
    own,ownlibs=group(nextb,p,radius)
    if not ownlibs:return None
    return nextb,captured,own,ownlibs

def features(board,move,turn,radius,count,result):
    nextb,captured,own,ownlibs=result
    neighbors=adjacent(move,radius)
    friends=sum(board.get(n)==turn for n in neighbors)
    enemies=sum(board.get(n)is not None and board.get(n)!=turn for n in neighbors)
    empty=sum(n not in board for n in neighbors)
    protected=set();rescued=0;attacked=set();pressure=0
    for n in neighbors:
        if board.get(n)==turn and n not in protected:
            g,l=group(board,n,radius);protected.update(g)
            if len(l)==1 and len(ownlibs)>=2:rescued+=len(g)
        if nextb.get(n)is not None and nextb.get(n)!=turn and n not in attacked:
            g,l=group(nextb,n,radius);attacked.update(g)
            if len(l)==1:pressure+=len(g)
    capacity=3*radius*(radius+1)+1
    edge=max(abs(move[0]),abs(move[1]),abs(sum(move)))/radius
    own_count=sum(x==turn for x in board.values())
    max_other=max(sum(x==o for x in board.values()) for o in range(3) if o!=turn)
    return np.array([edge,min(1.,count/(2*capacity)),friends/6,enemies/6,empty/6,
      min(1.,len(captured)/6),min(1.,len(ownlibs)/6),min(1.,len(own)/12),
      min(1.,rescued/8),min(1.,pressure/8),
      float(len(ownlibs)==1 and len(own)>len(captured)),
      np.clip((own_count-max_other)/(capacity*.5),-1.,1.)],dtype=np.float32)

def teacher(x):
    return (x[5]*7 + x[8]*4 + x[9]*2.5 + x[2]*.9 + x[6]*1.5 + x[7]*.5
        +x[4]*.45-x[0]*.18-x[10]*8+.9*x[8]*x[6]+.3*x[2]*x[7]+x[11]*.15)

data=[];labels=[];plies=0
for game in range(230):
    radius=[3,4,5,6][game%4]
    pts=points(radius)
    board={};turn=0;passes=0
    for i in range(min(110,len(pts)*2)):
        available=[]
        for p in pts:
            if p in board:continue
            res=try_move(board,p,turn,radius)
            if res is None:continue
            x=features(board,p,turn,radius,i,res)
            if x[10]>.5:continue
            available.append((p,res,x))
        if not available:
            passes+=1;turn=(turn+1)%3
            if passes==3:break
            continue
        passes=0
        rng=random.Random(SEED+game*10000+i)
        for _,_,x in rng.sample(available,min(12,len(available))):
            data.append(x);labels.append(teacher(x))
        chosen=max(available,key=lambda item:teacher(item[2])+rng.random()*.75)
        if rng.random()<.18:chosen=rng.choice(available)
        board=chosen[1][0];turn=(turn+1)%3;plies+=1
        if len(data)>95000:break
    if len(data)>95000:break

x=np.asarray(data,dtype=np.float32)
y=np.asarray(labels,dtype=np.float32)[:,None]
order=np.random.permutation(len(x));n=int(.85*len(x))
tx=torch.tensor(x[order[:n]])
ty=torch.tensor(y[order[:n]])
vx=torch.tensor(x[order[n:]])
vy=torch.tensor(y[order[n:]])

class Policy(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers=torch.nn.Sequential(
            torch.nn.Linear(12,24),torch.nn.ReLU(),
            torch.nn.Linear(24,16),torch.nn.ReLU(),
            torch.nn.Linear(16,8),torch.nn.ReLU(),
            torch.nn.Linear(8,1))
    def forward(self,x):return self.layers(x)

model=Policy()
optimizer=torch.optim.Adam(model.parameters(),lr=.009)
for epoch in range(70):
    for idx in torch.randperm(len(tx)).split(512):
        loss=torch.nn.functional.mse_loss(model(tx[idx]),ty[idx])
        optimizer.zero_grad();loss.backward();optimizer.step()

out_layers=[]
for layer in model.layers:
    if not isinstance(layer,torch.nn.Linear):continue
    w=layer.weight.detach().numpy().astype('float32')
    scale=max(1e-8,np.max(np.abs(w)))/127
    quant=np.clip(np.rint(w/scale),-127,127).astype('int8')
    out_layers.append({'rows':int(w.shape[0]),'cols':int(w.shape[1]),
      'scale':round(float(scale),8),
      'weights':base64.b64encode(quant.tobytes()).decode('ascii'),
      'bias':[round(float(v),6) for v in layer.bias.detach().numpy()]})
out={'version':'distill-20261031-v1','features':12,'activation':'relu',
    'teacher':'synthetic tactical self-play imitation, not a human-trained policy',
    'layers':out_layers}
dest=Path(__file__).resolve().parent.parent/'src/neural-weights.js'
dest.write_text('// Retrained synthetic self-play policy. See scripts/train-neural-policy.py.\n'
                +'export const NEURAL_MODEL='+json.dumps(out,separators=(',',':'))+';\n')
with torch.no_grad():
    print('sample candidates:',len(data),'simulated moves:',plies,
          'validation MSE:',torch.nn.functional.mse_loss(model(vx),vy).item(),
          'output:',dest)
