#!/usr/bin/env python3
"""Train a full-board hex policy/value network from 3-player MCTS self-play.

This is AlphaZero-style policy improvement and value learning with MaxN
selection, but a deliberately small experimental network; not AlphaZero's
original residual architecture or a claim of professional Go strength.

Requires Python 3, NumPy, PyTorch and Node 22. Uses no labeled human games
and no handcrafted move-scoring teacher. Output is a *candidate*, not deployed.
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
DIRECTIONS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))
ARCH = "hex-neighbor-pv-16-v1"


def points(radius):
    return [(q, r) for r in range(-radius, radius + 1)
            for q in range(-radius, radius + 1) if abs(q + r) <= radius]


def neighbors(radius):
    cells = points(radius)
    index = {p: i for i, p in enumerate(cells)}
    return [[index[(q + dq, r + dr)] for dq, dr in DIRECTIONS
             if (q + dq, r + dr) in index] for q, r in cells]


class HexPolicyValue(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Linear(5, 16)
        self.mix = nn.Linear(32, 16)
        self.policy = nn.Linear(16, 1)
        self.pass_head = nn.Linear(16, 1)
        self.value_hidden = nn.Linear(16, 16)
        self.value = nn.Linear(16, 3)

    def forward(self, board, turn, move_count, radius):
        count = len(board)
        stones = torch.tensor(board, dtype=torch.long)
        x = torch.stack([
            (stones == turn).float(),
            (stones == (turn + 1) % 3).float(),
            (stones == (turn + 2) % 3).float(),
            (stones == -1).float(),
            torch.full((count,), min(1.0, move_count / (2 * count)))
        ], dim=-1)
        h = F.relu(self.embed(x))
        adjacent = neighbors(radius)
        means = torch.stack([h[indices].mean(dim=0) for indices in adjacent])
        mixed = F.relu(self.mix(torch.cat((h, means), dim=-1)))
        pooled = mixed.mean(dim=0)
        logits = torch.cat((self.policy(mixed).flatten(),
                            self.pass_head(pooled).flatten()))
        value_logits = self.value(F.relu(self.value_hidden(pooled)))
        return logits, value_logits


def dump_model(model, metadata):
    names = (
        ("embed", model.embed), ("mix", model.mix),
        ("policy", model.policy), ("pass", model.pass_head),
        ("valueHidden", model.value_hidden), ("value", model.value)
    )
    layers = {}
    for name, layer in names:
        weights = layer.weight.detach().cpu().numpy()
        bias = layer.bias.detach().cpu().numpy()
        layers[name] = {
            "rows": int(weights.shape[0]), "cols": int(weights.shape[1]),
            "weights": [round(float(v), 7) for v in weights.flatten()],
            "bias": [round(float(v), 7) for v in bias],
        }
    return {
        "version": "pv-selfplay-seed{}-g{}".format(metadata["seed"], metadata["games"]),
        "architecture": ARCH,
        "training": "MCTS self-play policy targets + terminal 3-player result",
        "metadata": metadata, "layers": layers
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=8)
    parser.add_argument("--games", type=int, default=4)
    parser.add_argument("--simulations", type=int, default=12)
    parser.add_argument("--seed", type=int, default=20261031)
    parser.add_argument("--radii", default="2,3,4")
    parser.add_argument("--learning-rate", type=float, default=0.002)
    parser.add_argument("--out", type=Path,
                        default=ROOT / "reports" / "pv-candidate.json")
    args = parser.parse_args()
    radii = [int(r) for r in args.radii.split(",")]
    if (not 1 <= args.iterations <= 2000 or not 1 <= args.games <= 100 or
            not 2 <= args.simulations <= 256 or
            not 0 <= args.seed <= 4294967295 or
            not radii or any(r < 2 or r > 5 for r in radii) or
            not math.isfinite(args.learning_rate) or
            not 0 < args.learning_rate <= 0.1):
        parser.error("Invalid training configuration")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(1)
    model = HexPolicyValue()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    all_games, all_examples = 0, 0
    with tempfile.TemporaryDirectory(prefix="tgo-pv-") as tmp:
        snapshot = Path(tmp) / "candidate.json"
        for iteration in range(args.iterations):
            radius = radii[iteration % len(radii)]
            snapshot.write_text(json.dumps(dump_model(model, {
                "seed": args.seed, "games": all_games
            })), encoding="utf-8")
            game_seed = (args.seed + iteration * 100003) % 4294967296
            command = [
                "node", str(ROOT / "scripts/pv-selfplay.mjs"),
                "--model", str(snapshot), "--seed", str(game_seed),
                "--games", str(args.games), "--radius", str(radius),
                "--simulations", str(args.simulations),
            ]
            output = subprocess.run(command, capture_output=True,
                                    text=True, cwd=ROOT, check=True)
            games = [json.loads(line) for line in output.stdout.splitlines()]
            if len(games) != args.games or not all(g["ended"] for g in games):
                raise RuntimeError("Incomplete MCTS self-play trajectory")
            samples = [sample for game in games for sample in game["examples"]]
            if not samples:
                raise RuntimeError("Self-play yielded no training examples")
            random.shuffle(samples)
            losses = []
            for start in range(0, len(samples), 8):
                optimizer.zero_grad()
                batch_losses = []
                for sample in samples[start:start + 8]:
                    logits, value_logits = model(
                        sample["board"], sample["turn"],
                        sample["moveCount"], sample["radius"]
                    )
                    indices = torch.tensor(sample["legal"], dtype=torch.long)
                    probabilities = torch.tensor(sample["policy"],
                                                 dtype=torch.float32)
                    if abs(float(probabilities.sum()) - 1) > 1e-4:
                        raise RuntimeError("MCTS visit probabilities do not sum to one")
                    log_probs = F.log_softmax(logits[indices], dim=-1)
                    policy_loss = -(probabilities * log_probs).sum()
                    outcome = torch.tensor(sample["value"], dtype=torch.float32)
                    value_loss = -(outcome * F.log_softmax(
                        value_logits, dim=-1)).sum()
                    batch_losses.append(policy_loss + value_loss)
                loss = torch.stack(batch_losses).mean()
                if not torch.isfinite(loss):
                    raise RuntimeError("Non-finite policy/value loss")
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=2)
                optimizer.step()
                losses.append(float(loss.detach()))
            all_games += len(games)
            all_examples += len(samples)
            print(json.dumps({
                "iteration": iteration + 1, "radius": radius,
                "games": len(games), "examples": len(samples),
                "loss": round(sum(losses) / len(losses), 5)
            }), flush=True)

    metadata = {
        "seed": args.seed, "games": all_games, "examples": all_examples,
        "iterations": args.iterations, "radii": radii,
        "simulations": args.simulations, "learning_rate": args.learning_rate
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(dump_model(model, metadata),
                                    separators=(",", ":")) + "\n",
                        encoding="utf-8")
    print("Policy-value candidate:", args.out)
    print("Not installed. Benchmark against actual hard CPU before promotion.")


if __name__ == "__main__":
    main()
