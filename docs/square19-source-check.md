# 19×19 GNN64 trained on 9/13 vs 19 transfer vs linear: independent six-seat matches

The pretrained model was never fitted to 19×19 teacher decisions, while the experimental transfer model used 3 teacher games on 19×19. Each test rotates all 6 seat assignments; outcomes are counted only for natural terminal games.

| External third player | 19×19 rival | Naturally finished | Pretrained GNN win | Rival win | Pretrained ranks above rival |
|---|---|---:|---:|---:|---:|
| balanced | linear | 12/12 | 33.3% | 8.3% | 91.7% |
| balanced | transfer3 | 12/12 | 50.0% | 8.3% | 75.0% |
| guarded | linear | 12/12 | 33.3% | 0.0% | 100.0% |
| guarded | transfer3 | 12/12 | 33.3% | 8.3% | 50.0% |

Assessment: **suitable only as an explicitly labeled opt-in 19x19 experimental beta**.

No claim of overall 19×19 superiority or successful 19×19 self-play convergence is made. Before a default CPU replacement, substantially more heldout games and Android device latency are required.