#!/usr/bin/env python3
"""No-MCTS 3-player on-policy actor-critic trained ONLY on final stone shares.

All black/white/red turns are sampled from the same frozen network in each
self-play iteration; samples from all three players update one shared model.
The reward for color c is final_stones(c) / total_final_stones. No human games,
teacher moves, tactical labels, tree search or opponent lookahead.
"""
import argparse
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

ROOT = Path(__file__).resolve().parent.parent
pv2 = runpy.run_path(str(ROOT / "scripts" / "train-pv2-selfplay.py"))
HexPolicyValue = pv2["HexPolicyValue"]
dump_model = pv2["dump_model"]


def exported(model, seed, total_games, iterations, temperature):
    raw = dump_model(model, {
        "seed": seed, "games": total_games,
        "rewardProfile": "stone-share",
    })
    raw["version"] = f"direct-3p-stones-seed{seed}-g{total_games}"
    raw["training"] = "shared 3-player on-policy actor-critic, final stone shares; no search"
    raw["algorithm"] = "direct-policy-gradient-v1"
    raw["metadata"].update({
        "iterations": iterations,
        "temperature": temperature,
        "all_three_seats": True,
    })
    return raw


def sample_loss(net, sample, entropy_weight):
    logits, value_logits = net(sample["features"], sample["radius"])
    legal = sample["legal"]
    chosen = sample["selected"]
    if not legal or chosen not in legal or len(set(legal)) != len(legal):
        raise ValueError("Illegal action in self-play example")
    log_probs = F.log_softmax(logits[legal], dim=0)
    probs = log_probs.exp()
    chosen_position = legal.index(chosen)
    true_value = torch.tensor(sample["value"], dtype=torch.float32)
    if (true_value.shape != (3,) or not torch.isfinite(true_value).all() or
            not bool(torch.all(true_value >= 0)) or
            abs(float(true_value.sum()) - 1) > 1e-4):
        raise ValueError("Invalid three-player stone-share target")
    value_log_probs = F.log_softmax(value_logits, dim=0)
    # Each state is normalized so this state's current player is index 0.
    advantage = true_value[0] - value_log_probs.detach().exp()[0]
    policy_loss = -(log_probs[chosen_position] * advantage)
    entropy = -(probs * log_probs).sum()
    value_loss = -(true_value * value_log_probs).sum()
    return policy_loss + value_loss - entropy_weight * entropy, advantage


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--iterations", type=int, default=24)
    p.add_argument("--games", type=int, default=8)
    p.add_argument("--seed", type=int, default=20261101)
    p.add_argument("--radii", default="2,3,4")
    p.add_argument("--temperature", type=float, default=1)
    p.add_argument("--learning-rate", type=float, default=0.001)
    p.add_argument("--entropy", type=float, default=0.015)
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--out", type=Path,
                   default=ROOT / "reports" / "direct-policy-candidate.json")
    args = p.parse_args()
    radii = [int(r) for r in args.radii.split(",")]
    if not (1 <= args.iterations <= 1000 and 1 <= args.games <= 100 and
            0 <= args.seed <= 0xffffffff and
            0 < args.temperature <= 10 and
            0 < args.learning_rate <= .1 and
            0 <= args.entropy <= .5 and 1 <= args.epochs <= 10 and
            1 <= args.batch_size <= 512 and
            radii and all(2 <= r <= 5 for r in radii) and
            all(math.isfinite(v) for v in
                [args.temperature, args.learning_rate, args.entropy])):
        p.error("Invalid direct policy training parameters")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(1)
    rng = random.Random(args.seed)
    net = HexPolicyValue()
    optimizer = torch.optim.Adam(net.parameters(), lr=args.learning_rate)
    total_games, total_positions = 0, 0
    with tempfile.TemporaryDirectory(prefix="tgo-direct-") as directory:
        snapshot = Path(directory) / "frozen-policy.json"
        for iteration in range(args.iterations):
            radius = radii[iteration % len(radii)]
            snapshot.write_text(json.dumps(exported(
                net, args.seed, total_games, iteration, args.temperature)),
                encoding="utf-8")
            seed = (args.seed + iteration * 100003) & 0xffffffff
            command = [
                "node", str(ROOT / "scripts" / "direct-selfplay.mjs"),
                "--model", str(snapshot), "--games", str(args.games),
                "--seed", str(seed), "--radius", str(radius),
                "--temperature", str(args.temperature)
            ]
            result = subprocess.run(command, check=True, capture_output=True,
                                    text=True, cwd=ROOT)
            games = [json.loads(line) for line in result.stdout.splitlines()]
            if len(games) != args.games or not all(g["ended"] for g in games):
                raise RuntimeError("Not all direct self-play games terminated")
            if not all(all(seat > 0 for seat in g["seatCounts"]) for g in games):
                raise RuntimeError("All three players must participate")
            for g in games:
                shares = g["rewards"]
                totals = g["scores"]
                total = sum(totals.values())
                expected = ([totals[c] / total for c in ("black", "white", "red")]
                            if total else [1/3] * 3)
                if not np.allclose(shares, expected, atol=1e-8):
                    raise RuntimeError("Reward is not terminal stone share")
            samples = [s for g in games for s in g["samples"]]
            if not samples:
                raise RuntimeError("Missing training samples")
            # Collect complete trajectories with ONE frozen behavior policy,
            # then optimize the ONE shared network using all 3 seats' turns.
            losses, advantages = [], []
            for _ in range(args.epochs):
                rng.shuffle(samples)
                for start in range(0, len(samples), args.batch_size):
                    optimizer.zero_grad()
                    batch = samples[start:start + args.batch_size]
                    terms = [sample_loss(net, s, args.entropy) for s in batch]
                    loss = torch.stack([x[0] for x in terms]).mean()
                    if not bool(torch.isfinite(loss)):
                        raise RuntimeError("Non-finite policy gradient loss")
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(net.parameters(), max_norm=2)
                    optimizer.step()
                    losses.append(float(loss.detach()))
                    advantages.extend(float(x[1]) for x in terms)
            total_games += len(games)
            total_positions += len(samples)
            print(json.dumps({
                "iteration": iteration+1, "radius": radius,
                "games": len(games), "samples": len(samples),
                "seatPositions": [sum(g["seatCounts"][i] for g in games)
                                  for i in range(3)],
                "loss": round(sum(losses)/len(losses), 5),
                "meanAdvantage": round(sum(advantages)/len(advantages), 5)
            }), flush=True)

    model = exported(net, args.seed, total_games,
                     args.iterations, args.temperature)
    model["metadata"].update({
        "gamesPerIteration": args.games,
        "radii": radii, "epochs": args.epochs,
        "positions": total_positions,
        "learningRate": args.learning_rate,
        "entropyCoefficient": args.entropy
    })
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(model, separators=(",", ":")) + "\n",
                        encoding="utf-8")
    print("Direct-policy stone-share candidate:", args.out, "(NOT deployed)")


if __name__ == "__main__":
    main()
