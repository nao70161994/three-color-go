#!/usr/bin/env python3
"""Train fresh 3-player direct-policy actor-critic on stone share minus timeout penalty.

No forced passes, no human move labels, no pass-head bias calibration, no search.
All three players share one frozen policy per batch of self-play games.
Natural finish => R_i = stone_share_i; safety timeout => R_i = stone_share_i - penalty.
The value head independently regresses real-valued three-player returns using MSE.
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
RESUME_FORMAT = "direct-reward-actor-critic-resume-v1"


def exported(net, config, total_games, iteration, positions, ended, truncated, passes, optional):
    raw = dump_model(net, {
        "seed": config["seed"], "games": total_games,
        "rewardProfile": "stone-share-minus-timeout",
    })
    raw["version"] = f"direct-3p-reward-seed{config['seed']}-g{total_games}"
    raw["training"] = "3-player on-policy actor-critic, stone share minus timeout; no search"
    raw["algorithm"] = "direct-reward-actor-critic-v2"
    raw["metadata"].update({
        "valueOutput": "independent",
        "rewardProfile": "stone-share-minus-timeout",
        "timeoutPenalty": config["timeoutPenalty"],
        "horizonMultiplier": config["horizonMultiplier"],
        "iterations": iteration,
        "temperature": config["temperature"],
        "learningRate": config["learningRate"],
        "entropyCoefficient": config["entropy"],
        "batchSize": config["batchSize"],
        "gamesPerIteration": config["games"],
        "radii": config["radii"],
        "epochs": config["epochs"],
        "positions": positions,
        "naturallyEndedGames": ended,
        "truncatedGames": truncated,
        "passesSampled": passes,
        "optionalPassesSampled": optional,
        "passInLegalActions": True,
        "initialPassMargin": None,
        "all_three_seats": True,
    })
    return raw


def sample_loss(net, sample, entropy_weight, temperature, penalty):
    logits, value_pred = net(sample["features"], sample["radius"])
    legal, chosen = sample["legal"], sample["selected"]
    if not legal or chosen not in legal or len(set(legal)) != len(legal):
        raise ValueError("Invalid legal action in reward self-play example")
    log_probs = F.log_softmax(logits[legal] / temperature, dim=0)
    probs = log_probs.exp()
    target = torch.tensor(sample["value"], dtype=torch.float32)
    if (target.shape != (3,) or not bool(torch.isfinite(target).all()) or
            not bool(torch.all(target >= -penalty - 1e-5)) or
            not bool(torch.all(target <= 1 + 1e-5))):
        raise ValueError("Invalid independent signed-return target")
    # The actor-critic baseline is detached: the actor only sees the advantage.
    advantage = target[0] - value_pred.detach()[0]
    actor = -log_probs[legal.index(chosen)] * advantage
    entropy = -(probs * log_probs).sum()
    critic = F.mse_loss(value_pred, target)
    return actor + critic - entropy_weight * entropy, advantage


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--iterations", type=int, default=24)
    p.add_argument("--games", type=int, default=8)
    p.add_argument("--seed", type=int, default=20261103)
    p.add_argument("--radii", default="2,3,4")
    p.add_argument("--temperature", type=float, default=1.5)
    p.add_argument("--learning-rate", type=float, default=0.001)
    p.add_argument("--entropy", type=float, default=0.015)
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--horizon-multiplier", type=int, default=100)
    p.add_argument("--timeout-penalty", type=float, default=0.3)
    p.add_argument("--checkpoint-every", type=int, default=0)
    p.add_argument("--resume", type=Path,
                   help="Resume only a trusted .pt from this reward trainer")
    p.add_argument("--out", type=Path,
                   default=ROOT / "reports" / "direct-reward-candidate.json")
    args = p.parse_args()
    radii = [int(x) for x in args.radii.split(",")]
    if not (
        1 <= args.iterations <= 5000 and 1 <= args.games <= 100 and
        0 <= args.seed <= 0xffffffff and
        radii and all(2 <= r <= 5 for r in radii) and
        math.isfinite(args.temperature) and 0 < args.temperature <= 10 and
        math.isfinite(args.learning_rate) and 0 < args.learning_rate <= .1 and
        math.isfinite(args.entropy) and 0 <= args.entropy <= .5 and
        math.isfinite(args.timeout_penalty) and 0 <= args.timeout_penalty <= 2 and
        1 <= args.horizon_multiplier <= 100 and
        1 <= args.epochs <= 10 and 1 <= args.batch_size <= 512 and
        0 <= args.checkpoint_every <= args.iterations
    ):
        p.error("Invalid reward training configuration")

    config = {
        "seed": args.seed, "games": args.games, "radii": radii,
        "temperature": args.temperature, "learningRate": args.learning_rate,
        "entropy": args.entropy, "epochs": args.epochs,
        "batchSize": args.batch_size,
        "horizonMultiplier": args.horizon_multiplier,
        "timeoutPenalty": args.timeout_penalty,
    }
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(1)
    shuffler = random.Random(args.seed)
    net = HexPolicyValue()
    # No --init-model / --init-pass-margin. Initialize ALL heads with the
    # same PyTorch Linear-layer rules; training starts from a clean network.
    optimizer = torch.optim.Adam(net.parameters(), lr=args.learning_rate)
    start_iteration = total_games = total_positions = 0
    naturally_ended = truncated_games = sampled_passes = optional_passes = 0

    if args.resume:
        checkpoint = torch.load(args.resume, map_location="cpu", weights_only=False)
        if checkpoint.get("format") != RESUME_FORMAT or checkpoint.get("config") != config:
            raise RuntimeError("Incompatible reward trainer checkpoint")
        start_iteration = checkpoint["iteration"]
        if not 0 < start_iteration < args.iterations:
            raise RuntimeError("Resumed iteration is outside the target")
        net.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        shuffler.setstate(checkpoint["shuffleRng"])
        random.setstate(checkpoint["globalRandom"])
        np.random.set_state(checkpoint["numpyRng"])
        torch.set_rng_state(checkpoint["torchRng"])
        total_games = checkpoint["totalGames"]
        total_positions = checkpoint["totalPositions"]
        naturally_ended = checkpoint["naturallyEndedGames"]
        truncated_games = checkpoint["truncatedGames"]
        sampled_passes = checkpoint["passesSampled"]
        optional_passes = checkpoint["optionalPassesSampled"]
        if total_games != start_iteration * args.games or naturally_ended + truncated_games != total_games:
            raise RuntimeError("Invalid resumed episode counts")

    with tempfile.TemporaryDirectory(prefix="tgo-direct-reward-") as directory:
        snapshot = Path(directory) / "frozen-policy.json"
        for iteration in range(start_iteration, args.iterations):
            snapshot.write_text(json.dumps(exported(
                net, config, total_games, iteration, total_positions,
                naturally_ended, truncated_games, sampled_passes, optional_passes
            )), encoding="utf-8")
            seed = (args.seed + iteration * 100003) & 0xffffffff
            command = [
                "node", str(ROOT / "scripts" / "direct-reward-selfplay.mjs"),
                "--model", str(snapshot), "--games", str(args.games),
                "--seed", str(seed), "--radius", str(radii[iteration % len(radii)]),
                "--temperature", str(args.temperature),
                "--horizon-multiplier", str(args.horizon_multiplier),
                "--timeout-penalty", str(args.timeout_penalty),
            ]
            output = subprocess.run(command, check=True, capture_output=True,
                                    text=True, cwd=ROOT)
            episodes = [json.loads(line) for line in output.stdout.splitlines()]
            if (len(episodes) != args.games or
                any(g["ended"] == g["truncated"] for g in episodes)):
                raise RuntimeError("Expected natural or censored result for every game")
            for g in episodes:
                if any(count <= 0 for count in g["seatCounts"]):
                    raise RuntimeError("Not all three seats participated")
                scores = g["scores"]
                total = sum(scores.values())
                base = ([scores[c] / total for c in ("black", "white", "red")]
                        if total else [1 / 3] * 3)
                penalty = args.timeout_penalty if g["truncated"] else 0
                expected = [v - penalty for v in base]
                if not np.allclose(g["rewards"], expected, atol=1e-8):
                    raise RuntimeError("Inconsistent signed reward target")
                if g["truncated"] and g["turns"] != g["horizon"]:
                    raise RuntimeError("Truncated game must reach safety horizon")
                if g["ended"] and g["turns"] > g["horizon"]:
                    raise RuntimeError("Natural game surpassed safety horizon")

            samples = [s for g in episodes for s in g["samples"]]
            if not samples:
                raise RuntimeError("No training samples")
            losses, advantages = [], []
            for _ in range(args.epochs):
                shuffler.shuffle(samples)
                for start in range(0, len(samples), args.batch_size):
                    optimizer.zero_grad()
                    terms = [sample_loss(net, s, args.entropy, args.temperature,
                                         args.timeout_penalty)
                             for s in samples[start:start + args.batch_size]]
                    loss = torch.stack([v[0] for v in terms]).mean()
                    if not bool(torch.isfinite(loss)):
                        raise RuntimeError("Non-finite signed reward loss")
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(net.parameters(), max_norm=2)
                    optimizer.step()
                    losses.append(float(loss.detach()))
                    advantages.extend(float(v[1]) for v in terms)

            total_games += len(episodes)
            total_positions += len(samples)
            naturally_ended += sum(g["ended"] for g in episodes)
            truncated_games += sum(g["truncated"] for g in episodes)
            sampled_passes += sum(g["passes"] for g in episodes)
            optional_passes += sum(g["optionalPasses"] for g in episodes)
            if args.checkpoint_every and (
                (iteration + 1) % args.checkpoint_every == 0 or
                iteration + 1 == args.iterations
            ):
                path = args.out.with_name(f"{args.out.stem}-iter{iteration+1:04d}.pt")
                path.parent.mkdir(parents=True, exist_ok=True)
                torch.save({
                    "format": RESUME_FORMAT, "config": config, "iteration": iteration + 1,
                    "model": net.state_dict(), "optimizer": optimizer.state_dict(),
                    "shuffleRng": shuffler.getstate(),
                    "globalRandom": random.getstate(),
                    "numpyRng": np.random.get_state(),
                    "torchRng": torch.get_rng_state(),
                    "totalGames": total_games, "totalPositions": total_positions,
                    "naturallyEndedGames": naturally_ended,
                    "truncatedGames": truncated_games,
                    "passesSampled": sampled_passes,
                    "optionalPassesSampled": optional_passes,
                }, path)
            print(json.dumps({
                "iteration": iteration + 1,
                "radius": radii[iteration % len(radii)],
                "games": len(episodes), "samples": len(samples),
                "naturallyEnded": sum(g["ended"] for g in episodes),
                "truncated": sum(g["truncated"] for g in episodes),
                "passes": sum(g["passes"] for g in episodes),
                "optionalPasses": sum(g["optionalPasses"] for g in episodes),
                "meanTurns": sum(g["turns"] for g in episodes) / len(episodes),
                "loss": round(sum(losses) / len(losses), 6),
                "meanAdvantage": round(sum(advantages) / len(advantages), 6),
            }), flush=True)

    model = exported(net, config, total_games, args.iterations, total_positions,
                     naturally_ended, truncated_games, sampled_passes, optional_passes)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(model, separators=(",", ":")) + "\n",
                        encoding="utf-8")
    print("Independent-return reward-model candidate (NOT deployed):", args.out)


if __name__ == "__main__":
    main()
