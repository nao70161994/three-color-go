# Square GNN enlarged teacher curriculum and independent evaluation

Training: 44 additional games. Validation: 11 separate heldout teacher games. Evaluation: new seed 20270117, fully rotated seats, 18 games 9×9 and 6 games 13×13, both greedy and sampled policies.

| Variant | Board | Mode | New win share | Previous win share | Original 512 win share | Linear CPU win share | New stones | Early pass |
|---|---|---|---:|---:|---:|---:|---:|---:|
| gnn64-staged | 9×9 | greedy | 22.2% | 5.6% | 0.0% | 27.8% | 34.9% | 0/18 |
| gnn64-staged | 13×13 | greedy | 16.7% | 50.0% | 0.0% | 16.7% | 39.2% | 0/6 |
| gnn64-staged | 9×9 | sample | 8.3% | 0.0% | 0.0% | 27.8% | 23.4% | 0/18 |
| gnn64-staged | 13×13 | sample | 33.3% | 33.3% | 0.0% | 16.7% | 35.9% | 0/6 |
| gnn64-direct | 9×9 | greedy | 23.5% | 5.6% | 0.0% | 27.8% | 28.7% | 0/18 |
| gnn64-direct | 13×13 | greedy | 50.0% | 50.0% | 0.0% | 16.7% | 28.8% | 0/6 |
| gnn64-direct | 9×9 | sample | 11.1% | 0.0% | 0.0% | 27.8% | 25.0% | 0/18 |
| gnn64-direct | 13×13 | sample | 0.0% | 33.3% | 0.0% | 16.7% | 26.6% | 0/6 |
| gnn16-staged | 9×9 | greedy | 11.1% | 19.4% | 0.0% | 27.8% | 22.9% | 0/18 |
| gnn16-staged | 13×13 | greedy | 16.7% | 33.3% | 0.0% | 16.7% | 38.6% | 0/6 |
| gnn16-staged | 9×9 | sample | 0.0% | 5.6% | 0.0% | 27.8% | 16.8% | 0/18 |
| gnn16-staged | 13×13 | sample | 33.3% | 0.0% | 0.0% | 16.7% | 27.6% | 0/6 |

These results are exploratory and are not a final statistical proof of superior strength. The playable default remains unchanged until repeated independent validation and integration tests.
