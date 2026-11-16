# RL milestone screening (separate from final 36-game evaluation)

This additional independent-seed screening compares 4, 8 and 12 iterations against the same initial teacher-distilled model. Choosing the best checkpoint from the screening reuses those data for model selection; any promoted checkpoint therefore needs a third, untouched confirmation seed.

| Board | Checkpoint games | Completed CPU games | Candidate CPU win | Base CPU win | Head-to-head rank rate | Decision |
|---|---:|---:|---:|---:|---:|---|
| 9×9 | 12 | 9/9 | 22.2% | 11.1% | 25.0% | not selected |
| 9×9 | 24 | 9/9 | 38.9% | 11.1% | 65.0% | not selected |
| 9×9 | 36 | 9/9 | 22.2% | 11.1% | 45.5% | not selected |
| 13×13 | 12 | 6/6 | 33.3% | 50.0% | 33.3% | not selected |
| 13×13 | 24 | 6/6 | 50.0% | 50.0% | 50.0% | not selected |
| 13×13 | 36 | 6/6 | 41.7% | 50.0% | 66.7% | not selected |

The screen is not sufficient for a production decision. Any selected checkpoint must pass a new independent 6-seat matchup and 19×19 must be assessed separately.
