# 19×19 unchanged 13x13 GNN64 vs teacher-tactical hybrid screening

Both candidates use the same 13x13-trained GNN64 weights, neither policy has been retrained on 19x19. Results are on actual 19x19 geometry; the third-player policy varies. Sample sizes are small, and mobile latency is not measured.

| Third player | Natural finals | Hybrid whole-game win | Original whole-game win | Relative hybrid stone outrank | Hybrid observed stones | GNN observed stones | Mean hybrid decision |
|---|---:|---:|---:|---:|---:|---:|---:|
| balanced | 12/12 | 25.0% | 25.0% | 66.7% | 32.4% | 26.6% | 32.3 ms |
| guarded | 12/12 | 29.2% | 4.2% | 58.3% | 33.5% | 25.6% | 35.2 ms |

Decision: **do not adopt**. Even an eligible candidate must pass untouched-seed validation.
