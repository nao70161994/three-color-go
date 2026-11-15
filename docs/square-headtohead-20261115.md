# Direct three-player square GNN duels

Two distinct contestants and a third-party balanced CPU share one board. All six seat assignments are played with fixed independent seeds. **Only naturally completed games contribute to win/rank rates.**

| Match | Policy | 9×9 rank A>B | 13×13 rank A>B | 9×9 win A/B | 13×13 win A/B | Finished |
|---|---|---:|---:|---:|---:|---:|
| staged vs direct | greedy | 66.7% | 25.0% | 22.2%/13.9% | 16.7%/33.3% | 30/30 |
| staged vs direct | sample | 47.1% | 33.3% | 11.8%/35.3% | 0.0%/16.7% | 29/30 |
| staged vs linear | greedy | 76.5% | 100.0% | 52.9%/17.6% | 25.0%/0.0% | 29/30 |
| staged vs linear | sample | 61.1% | 75.0% | 5.6%/27.8% | 33.3%/25.0% | 30/30 |
| direct vs linear | greedy | 75.0% | 72.7% | 25.0%/18.8% | 45.5%/18.2% | 27/30 |
| direct vs linear | sample | 26.5% | 66.7% | 17.6%/41.2% | 0.0%/16.7% | 29/30 |
| staged vs old | greedy | 100.0% | 100.0% | 37.5%/0.0% | 4.5%/0.0% | 27/30 |
| staged vs old | sample | 88.9% | 100.0% | 0.0%/0.0% | 8.3%/0.0% | 30/30 |
| direct vs old | greedy | 100.0% | 100.0% | 8.8%/0.0% | 33.3%/0.0% | 29/30 |
| direct vs old | sample | 100.0% | 91.7% | 18.8%/0.0% | 8.3%/0.0% | 28/30 |

Rank means which model retains more stones than the other contestant at a completed game. It does not mean the model won the whole 3-person game. Multiple opponent policies and mobile benchmarking are still needed for definitive rankings.
