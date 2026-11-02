#!/usr/bin/env python3
"""Validate exported group-aware PV2 weights match JavaScript inference."""
import json
import subprocess
import sys
import runpy
from pathlib import Path

import numpy as np
import torch
ROOT = Path(__file__).resolve().parent.parent
HexPolicyValue = runpy.run_path(str(ROOT / 'scripts/train-pv2-selfplay.py'))['HexPolicyValue']


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/check-pv2-parity.py model.json")
    path = Path(sys.argv[1])
    weights = json.loads(path.read_text(encoding="utf-8"))
    if weights["architecture"] != "hex-group-pv-16-v2":
        raise ValueError("Expected group-aware policy/value v2")
    output = subprocess.run(
        ["node", str(ROOT / "scripts/predict-pv2.mjs"), str(path.resolve())],
        cwd=ROOT, capture_output=True, text=True, check=True
    )
    samples = json.loads(output.stdout)
    model = HexPolicyValue()
    for name, layer in (
        ("embed", model.embed), ("mix1", model.mix1),
        ("mix2", model.mix2), ("mix3", model.mix3),
        ("policy", model.policy), ("pass", model.pass_head),
        ("valueHidden", model.value_hidden), ("value", model.value)
    ):
        layer.weight.data = torch.tensor(weights["layers"][name]["weights"],
                                         dtype=torch.float32).view_as(layer.weight)
        layer.bias.data = torch.tensor(weights["layers"][name]["bias"],
                                       dtype=torch.float32)
    model.eval()
    maximum = 0.0
    with torch.no_grad():
        for sample in samples:
            policy, value = model(sample["features"], sample["radius"])
            probability = torch.softmax(value, dim=0).numpy()
            absolute = np.zeros(3)
            for i in range(3):
                absolute[(sample["turn"] + i) % 3] = probability[i]
            differences = [
                np.max(np.abs(policy.numpy() - np.array(sample["logits"]))),
                np.max(np.abs(absolute - np.array(sample["value"]))),
            ]
            maximum = max(maximum, *differences)
    print(json.dumps({"examples": len(samples), "max_abs_error": maximum}))
    if maximum > 0.0002:
        raise AssertionError("PV2 Torch/JS inference mismatch")


if __name__ == "__main__":
    main()
