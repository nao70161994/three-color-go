# Teacher-assisted square-board GNN strength experiment

Initial models: 512 real self-play games. Teacher: separate balanced/tactical/guarded CPU games. Training and heldout teacher games are separate. Tournament uses unseen seed 20261215 and complete seat rotation.

| Model | Board | Policy | Distilled win share | 512 win share | Linear win share | Distilled stones | 512 stones | Early passes |
|---|---|---|---:|---:|---:|---:|---:|---:|
| gnn16 | 9×9 | greedy | 11.1% | 0.0% | 44.4% | 10.0% | 5.2% | 3/9 |
| gnn16 | 13×13 | greedy | 33.3% | 0.0% | 0.0% | 30.6% | 0.0% | 1/3 |
| gnn16 | 9×9 | sample | 0.0% | 0.0% | 44.4% | 14.7% | 1.0% | 1/9 |
| gnn16 | 13×13 | sample | 0.0% | 0.0% | 0.0% | 9.6% | 11.8% | 0/3 |
| gnn64 | 9×9 | greedy | 22.2% | 0.0% | 44.4% | 15.6% | 0.0% | 0/9 |
| gnn64 | 13×13 | greedy | 33.3% | 0.0% | 0.0% | 21.6% | 0.0% | 0/3 |
| gnn64 | 9×9 | sample | 11.1% | 0.0% | 44.4% | 10.5% | 9.9% | 0/9 |
| gnn64 | 13×13 | sample | 0.0% | 0.0% | 0.0% | 6.7% | 1.4% | 0/3 |

Caveats: These are small exploratory tournaments; none of the resulting models is automatically promoted to public CPU selection. A larger independent tournament is required. Finishes and observed stone percentages are distinct measurements.
