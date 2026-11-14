# Square deep 512-game model adoption review

| Model | Training games | Natural training finishes | Evaluated games | Win share | Observed stone share | Decision |
|---|---:|---:|---:|---:|---:|---|
| gnn16 | 512 | 181 | 12/12 | 0 | 0.058 | do not promote (insufficient winning evidence) |
| gnn64 | 512 | 203 | 12/12 | 0 | 0.125 | do not promote (insufficient winning evidence) |
| attn64 | 512 | 225 | 12/12 | 0 | 0.011 | do not promote (insufficient winning evidence) |

All checkpoint JSON files and original SHA-256 hashes are retained under experiments/square-512/ rather than replacing the shipped 32-game weights.
No model is promoted solely because it trained for more games or because its observed stone share increased. The 32-game vs 512-game tests used different seeds; a controlled equal-seed comparison is required before promotion.

Original PyTorch optimizer checkpoint and RNG state remain in Actions artifacts.
