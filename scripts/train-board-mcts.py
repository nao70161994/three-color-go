#!/usr/bin/env python3
"""Teacher-free three-player Policy-Value + MCTS self-play training.

The board input is 8x25x25: full black/white/red occupancy, valid cells,
three turn planes and game progress. No handcrafted tactical feature vectors,
human move labels, or teacher evaluation scores.

Policy targets are root MCTS visit shares. Value targets are terminal
three-player win shares. The network starts at random initialization.
Requires Python 3, PyTorch, NumPy and Node.js 22.
"""
import argparse
import json
import random
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parent.parent
WIDTH = 25
AREA = WIDTH * WIDTH
ACTIONS = AREA + 1


class BoardPolicyValue(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(8, 8, 3, padding=1)
        self.conv2 = nn.Conv2d(8, 8, 3, padding=1)
        self.policy = nn.Conv2d(8, 1, 1)
        self.pass_head = nn.Linear(8, 1)
        self.value_head = nn.Linear(8, 3)

    def forward(self, x):
        h = F.relu(self.conv1(x))
        h = F.relu(self.conv2(h))
        mask = x[:, 3:4]
        pooled = (h * mask).sum((2, 3)) / mask.sum((2, 3)).clamp(min=1)
        logits = torch.cat((self.policy(h).flatten(1),
                            self.pass_head(pooled)), dim=1)
        return logits, self.value_head(pooled)


def weights_json(model, meta):
    result = {
        "architecture": "hex-board-pv-v1",
        "version": "board-mcts-selfplay-seed{}-g{}".format(
            meta["seed"], meta["total_games"]),
        "training": "full-board MCTS self-play: visit policy + terminal winner shares",
        "metadata": meta,
    }
    for name in ["conv1", "conv2", "policy", "pass_head", "value_head"]:
        layer = getattr(model, name)
        result[{"pass_head": "passHead", "value_head": "valueHead"}.get(name, name)] = {
            "weights": [round(float(v), 8) for v in layer.weight.detach().flatten().tolist()],
            "bias": [round(float(v), 8) for v in layer.bias.detach().tolist()],
        }
    return result


def input_sample(sample):
    radius = sample["radius"]
    turn = sample["turn"]
    move_count = sample["moveCount"]
    if not (2 <= radius <= 4 and 0 <= turn <= 2):
        raise ValueError("Invalid game radius/turn")
    board = np.zeros((8, WIDTH, WIDTH), dtype=np.float32)
    for r in range(-radius, radius + 1):
        for q in range(-radius, radius + 1):
            if abs(q + r) <= radius:
                y, x = r + 12, q + 12
                board[3, y, x] = 1
                board[4 + turn, y, x] = 1
                cells = 3 * radius * (radius + 1) + 1
                board[7, y, x] = min(1, move_count / (2 * cells))
    for q, r, color in sample["stones"]:
        if not (0 <= color <= 2 and
                max(abs(q), abs(r), abs(q + r)) <= radius):
            raise ValueError("Invalid stone in self-play")
        board[color, r + 12, q + 12] = 1
    target = np.zeros(ACTIONS, dtype=np.float32)
    allowed = np.zeros(ACTIONS, dtype=np.bool_)
    for index in sample["legal"]:
        if not (0 <= index < ACTIONS):
            raise ValueError("Invalid action index")
        allowed[index] = True
    for index, probability in sample["policy"]:
        if not allowed[index] or not (0 <= probability <= 1):
            raise ValueError("Illegal policy target")
        target[index] = probability
    if not np.isclose(target.sum(), 1, atol=1e-5):
        raise ValueError("Policy probabilities do not sum to one")
    values = np.asarray(sample["value"], dtype=np.float32)
    if values.shape != (3,) or not np.isclose(values.sum(), 1):
        raise ValueError("Terminal win-share target malformed")
    return board, target, allowed, values


def train_batch(model, optimizer, data, batch_size, epochs, rng):
    all_x = torch.from_numpy(np.stack([d[0] for d in data]))
    all_policy = torch.from_numpy(np.stack([d[1] for d in data]))
    all_legal = torch.from_numpy(np.stack([d[2] for d in data]))
    all_value = torch.from_numpy(np.stack([d[3] for d in data]))
    model.train()
    losses = []
    for _ in range(epochs):
        indices = rng.permutation(len(data))
        for ids in np.array_split(indices, max(1, int(np.ceil(len(data) / batch_size)))):
            x = all_x[ids]
            policy_target, valid = all_policy[ids], all_legal[ids]
            target_value = all_value[ids]
            policy_logits, value_logits = model(x)
            masked = policy_logits.masked_fill(~valid, -1e9)
            policy_loss = -(policy_target * F.log_softmax(masked, dim=1)).sum(dim=1).mean()
            value_loss = -(target_value * F.log_softmax(value_logits, dim=1)).sum(dim=1).mean()
            loss = policy_loss + value_loss
            if not torch.isfinite(loss):
                raise RuntimeError("Nonfinite policy-value loss")
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            optimizer.step()
            losses.append(float(loss.detach()))
    return sum(losses) / len(losses)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument("--games", type=int, default=3)
    parser.add_argument("--simulations", type=int, default=12)
    parser.add_argument("--seed", type=int, default=20261031)
    parser.add_argument("--radii", default="2,3")
    parser.add_argument("--learning-rate", type=float, default=0.003)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--out", type=Path,
                        default=ROOT / "reports" / "board-mcts-candidate.json")
    args = parser.parse_args()
    radii = [int(s) for s in args.radii.split(",")]
    if not (1 <= args.iterations <= 5000 and 1 <= args.games <= 100 and
            2 <= args.simulations <= 256 and 0 <= args.seed <= 4294967295 and
            0 < args.learning_rate <= 0.1 and 1 <= args.epochs <= 10 and
            1 <= args.batch_size <= 1024 and radii and
            all(2 <= radius <= 4 for radius in radii)):
        parser.error("Invalid training settings")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(2)
    model = BoardPolicyValue()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    rng = np.random.default_rng(args.seed)
    total_games = 0
    with tempfile.TemporaryDirectory(prefix="tgo-board-training-") as temp:
        checkpoint = Path(temp) / "weights.json"
        for iteration in range(args.iterations):
            radius = radii[iteration % len(radii)]
            meta = {"seed": args.seed, "total_games": total_games}
            checkpoint.write_text(json.dumps(weights_json(model, meta)),
                                  encoding="utf-8")
            command = [
                "node", str(ROOT / "scripts" / "selfplay-board.mjs"),
                "--model", str(checkpoint),
                "--games", str(args.games),
                "--radius", str(radius),
                "--seed", str((args.seed + iteration * 100003) % 4294967296),
                "--simulations", str(args.simulations),
            ]
            run = subprocess.run(command, cwd=ROOT, capture_output=True,
                                 text=True, check=True)
            games = [json.loads(line) for line in run.stdout.splitlines()]
            if len(games) != args.games or any(not g["ended"] for g in games):
                raise RuntimeError("Incomplete self-play batch")
            samples = [input_sample(s) for g in games for s in g["samples"]]
            if not samples:
                raise RuntimeError("No training examples")
            loss = train_batch(model, optimizer, samples, args.batch_size,
                               args.epochs, rng)
            total_games += len(games)
            print(json.dumps({"iteration": iteration + 1,
                              "radius": radius, "games": len(games),
                              "samples": len(samples), "loss": round(loss, 5)}),
                  flush=True)
    meta = {
        "seed": args.seed, "total_games": total_games,
        "iterations": args.iterations, "games_per_iteration": args.games,
        "simulations": args.simulations, "radii": radii,
        "epochs": args.epochs, "learning_rate": args.learning_rate,
        "generator": "scripts/selfplay-board.mjs",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(weights_json(model, meta),
                                   separators=(",", ":")) + "\n", encoding="utf-8")
    print("Candidate model:", args.out, "(NOT deployed)", flush=True)


if __name__ == "__main__":
    main()
