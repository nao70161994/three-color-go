# 9×9 RL checkpoint-8 independent confirmation

The 24-game checkpoint was selected as a screening candidate using seed 20280316 / 20280317. Confirmation below uses **new seeds 20280416 and 20280417**, stronger/different heuristic opponents, full 3-color finished games, and all six seats.

| Opponents | Candidate win | Source win | Linear win | Candidate vs source rank rate | Candidate vs linear rank rate | Natural terminal count |
|---|---:|---:|---:|---:|---:|---:|
| balanced + ['balanced', 'tactical'] | 3.3% | 23.3% | 16.7% | 28.3% | 65.4% | 56/60 |
| guarded + ['guarded', 'baseline'] | 31.0% | 35.0% | 20.0% | 58.6% | 65.5% | 58/60 |

Decision: **not promoted: inconsistent or insufficient confirmed improvement**.

This remains exploratory, not an assertion of statistical superiority. A confirmed model must still pass main CI and real mobile testing before replacing the current shipped GNN.