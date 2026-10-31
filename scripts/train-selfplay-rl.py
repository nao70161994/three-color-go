#!/usr/bin/env python3
"""Teacher-free REINFORCE learning for the compact three-color Go policy.

No tactical teacher scores, imitation labels, human games or outside Go model.
Node generates real-rule self-play using the current policy at each iteration.
The only learning signal is terminal win-share plus relative surviving stones.

Requires Python 3 + PyTorch and Node 22:
  python scripts/train-selfplay-rl.py --iterations 30 --games 12
Candidate weights are NOT installed into the game automatically.
"""
import argparse
import base64
import json
import random
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
SHAPE = (12, 24, 16, 8, 1)


class Policy(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = torch.nn.Sequential(
            torch.nn.Linear(12, 24), torch.nn.ReLU(),
            torch.nn.Linear(24, 16), torch.nn.ReLU(),
            torch.nn.Linear(16, 8), torch.nn.ReLU(),
            torch.nn.Linear(8, 1),
        )

    def forward(self, x):
        return self.layers(x).squeeze(-1)


def export_model(model, version, metadata):
    layers = []
    for layer in model.layers:
        if not isinstance(layer, torch.nn.Linear):
            continue
        weights = layer.weight.detach().cpu().numpy().astype("float32")
        scale = max(1e-8, float(np.max(np.abs(weights))) / 127)
        quantized = np.clip(np.rint(weights / scale), -127, 127).astype("int8")
        layers.append({
            "rows": int(weights.shape[0]), "cols": int(weights.shape[1]),
            "scale": round(scale, 8),
            "weights": base64.b64encode(quantized.tobytes()).decode("ascii"),
            "bias": [round(float(n), 6) for n in layer.bias.detach().tolist()],
        })
    return {
        "version": version,
        "features": SHAPE[0],
        "activation": "relu",
        "training": "self-play terminal-outcome REINFORCE; no tactical teacher labels",
        "selfplay": metadata,
        "layers": layers,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--games", type=int, default=12,
                        help="games per iteration (one model snapshot per batch)")
    parser.add_argument("--seed", type=int, default=20261031)
    parser.add_argument("--radii", default="2,3,4",
                        help="comma-separated curriculum, 2..6")
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    parser.add_argument("--entropy", type=float, default=0.01)
    parser.add_argument("--out", type=Path,
                        default=ROOT / "reports" / "neural-rl-candidate.json")
    args = parser.parse_args()
    radii = [int(x) for x in args.radii.split(",")]
    if not (1 <= args.iterations <= 10000 and 1 <= args.games <= 200 and
            0 <= args.seed <= 4294967295 and 0 < args.temperature <= 10 and
            0 < args.learning_rate <= 0.1 and 0 <= args.entropy <= 1 and
            radii and all(2 <= r <= 6 for r in radii)):
        parser.error("Invalid iteration, game, seed, radius, temperature or optimizer setting")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(1)
    model = Policy()  # Start from random weights, NOT a distilled teacher.
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)

    played = 0
    with tempfile.TemporaryDirectory(prefix="tgo-selfplay-") as tmp:
        checkpoint = Path(tmp) / "policy.json"
        for iteration in range(args.iterations):
            radius = radii[iteration % len(radii)]
            checkpoint.write_text(json.dumps(export_model(
                model, "selfplay-training", {"iteration": iteration}
            )), encoding="utf-8")
            batch_seed = (args.seed + iteration * 100003) % 4294967296
            command = [
                "node", str(ROOT / "scripts" / "selfplay-trajectories.mjs"),
                "--model", str(checkpoint), "--games", str(args.games),
                "--seed", str(batch_seed), "--radius", str(radius),
                "--temperature", str(args.temperature),
            ]
            generated = subprocess.run(
                command, cwd=ROOT, capture_output=True, text=True, check=True,
            )
            games = [json.loads(line) for line in generated.stdout.splitlines()]
            if len(games) != args.games or not all(g["ended"] for g in games):
                raise RuntimeError("Unexpected or incomplete self-play results")
            losses, plies = [], 0
            for game in games:
                if len(game["samples"]) == 0:
                    continue
                optimizer.zero_grad()
                sample_losses = []
                for sample in game["samples"]:
                    x = torch.tensor(sample["candidates"], dtype=torch.float32)
                    logits = model(x) / args.temperature
                    log_probs = torch.nn.functional.log_softmax(logits, dim=0)
                    probs = log_probs.exp()
                    entropy = -(probs * log_probs).sum()
                    reward = float(sample["reward"])
                    sample_losses.append(
                        -reward * log_probs[int(sample["choice"])]
                        - args.entropy * entropy
                    )
                loss = torch.stack(sample_losses).mean()
                if not torch.isfinite(loss):
                    raise RuntimeError("Non-finite policy-gradient loss")
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                losses.append(float(loss.detach()))
                plies += len(sample_losses)
            played += len(games)
            print(json.dumps({
                "iteration": iteration + 1, "radius": radius,
                "games": len(games), "moves": plies,
                "loss": round(sum(losses) / max(1, len(losses)), 5),
            }), flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "seed": args.seed, "iterations": args.iterations,
        "games": played, "radii": radii,
        "temperature": args.temperature, "learning_rate": args.learning_rate,
        "entropy": args.entropy, "generator": "scripts/selfplay-trajectories.mjs",
    }
    candidate = export_model(model, f"selfplay-reinforce-seed{args.seed}-g{played}", metadata)
    args.out.write_text(json.dumps(candidate, separators=(",", ":")) + "\n",
                        encoding="utf-8")
    print("Candidate model written:", args.out)
    print("NOT promoted. Run the seat-rotated benchmark and compare to hard CPU.")


if __name__ == "__main__":
    main()
