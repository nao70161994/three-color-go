#!/usr/bin/env python3
"""Check JS/PyTorch policy and independent return parity on all three radii."""
import json
import subprocess
import sys
import runpy
from pathlib import Path
import numpy as np
import torch
ROOT=Path(__file__).resolve().parent.parent
ComparisonNet=runpy.run_path(str(ROOT/"scripts"/"train-architecture-comparison.py"))["ComparisonNet"]
if len(sys.argv)!=2:raise SystemExit("Usage: python scripts/check-architecture-parity.py model.json")
path=Path(sys.argv[1]); raw=json.loads(path.read_text())
net=ComparisonNet(raw["kind"])
for name,layer in net.layers.items():
    values=raw["layers"][name]
    layer.weight.data=torch.tensor(values["weights"],dtype=torch.float32).reshape(layer.weight.shape)
    if layer.bias is not None:
        layer.bias.data=torch.tensor(values["bias"],dtype=torch.float32)
samples=json.loads(subprocess.run(
    ["node",str(ROOT/"scripts"/"predict-architecture.mjs"),str(path.resolve())],
    capture_output=True,text=True,check=True,cwd=ROOT).stdout)
maximum=0
with torch.no_grad():
    for sample in samples:
        logits,value=net(sample["features"],sample["radius"])
        actual=np.zeros(3,dtype=float)
        for i,v in enumerate(value[0].numpy()):
            actual[(sample["turn"]+i)%3]=float(v)
        maximum=max(maximum,float(np.max(np.abs(logits[0].numpy()-sample["logits"]))),
                    float(np.max(np.abs(actual-sample["value"]))))
print(json.dumps({"kind":raw["kind"],"samples":len(samples),"maxAbsoluteError":maximum}))
if maximum>0.0002:raise AssertionError("Experimental PyTorch/JS mismatch")
