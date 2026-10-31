#!/usr/bin/env python3
"""Verify exported PyTorch board network matches real JavaScript inference."""
import json
import subprocess
import sys
import importlib.util
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('train_board_mcts', ROOT / 'scripts' / 'train-board-mcts.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
BoardPolicyValue = module.BoardPolicyValue
if len(sys.argv) != 2:
    sys.exit("Usage: python scripts/check-board-parity.py MODEL.json")
path = Path(sys.argv[1]).resolve()
payload = json.loads(path.read_text(encoding="utf-8"))
model = BoardPolicyValue()
with torch.no_grad():
    for name in ("conv1", "conv2", "policy", "pass_head", "value_head"):
        data = payload[{"pass_head": "passHead", "value_head": "valueHead"}.get(name, name)]
        layer = getattr(model, name)
        layer.weight.copy_(torch.tensor(data["weights"], dtype=torch.float32)
                           .reshape(layer.weight.shape))
        layer.bias.copy_(torch.tensor(data["bias"], dtype=torch.float32))
    model.eval()
    x = np.zeros((1, 8, 25, 25), dtype=np.float32)
    radius = 2
    for r in range(-radius, radius + 1):
        for q in range(-radius, radius + 1):
            if abs(q + r) <= radius:
                x[0, 3, r + 12, q + 12] = 1
                x[0, 4, r + 12, q + 12] = 1
                x[0, 7, r + 12, q + 12] = 3 / 38
    for q, r, color in [(0, 0, 0), (1, 0, 1), (-1, 0, 2)]:
        x[0, color, r + 12, q + 12] = 1
    logits, values = model(torch.from_numpy(x))
    py_logits = logits[0].numpy()
    py_values = torch.softmax(values[0], dim=0).numpy()
js = subprocess.run(["node", str(ROOT / "scripts" / "predict-board.mjs"), str(path)],
                    cwd=ROOT, text=True, capture_output=True, check=True)
prediction = json.loads(js.stdout)
logit_error = float(np.max(np.abs(py_logits - prediction["policy"])))
value_error = float(np.max(np.abs(py_values - prediction["value"])))
print(json.dumps({"policy_max_absolute_error": logit_error,
                  "value_max_absolute_error": value_error}))
if logit_error > 1e-4 or value_error > 1e-4:
    sys.exit("Python/JavaScript board-network inference mismatch")
