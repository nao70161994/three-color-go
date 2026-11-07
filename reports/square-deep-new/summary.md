# Square-board deep AI initial evaluation

| Model | Trained games | Greedy wins | Sampled finished | Sampled win share | Sampled mean stone share | Sampled early passes |
|---|---:|---:|---:|---:|---:|---:|
| gnn16 | 32 | 0.0% | 12/12 | 0.0% | 3.2% | 0 |
| gnn64 | 32 | 0.0% | 12/12 | 0.0% | 5.4% | 0 |
| attn64 | 32 | 0.0% | 12/12 | 0.0% | 2.3% | 0 |

The sampled policy is the same trained policy distribution used for self-play, with random legal action sampling and no pass veto. These are exploratory 32-game checkpoints, not proven strong CPUs.
19×19 is inference-only and has no square self-play training in this checkpoint.
