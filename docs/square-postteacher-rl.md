# Post-teacher GNN64 mixed-league reinforcement learning experiment

Frozen GNN64 teacher models compete with a trainable GNN64 and seeded tactical/balanced/guarded CPUs. Genuine three-color rules including legal pass. Policy gradient is regularized by KL from a frozen initial model. Games below are independent of training seeds.

| Train board | League games | Natural endings | Target board | Candidate win share | Source win share | Direct outrank rate | Candidate early passes | Decision |
|---|---:|---:|---|---:|---:|---:|---:|---|
| 9×9 | 36 | 36 | 9×9 | 22.2% | 33.3% | 83.3% | 0 | do not promote |
| 13×13 | 36 | 36 | 13×13 | 33.3% | 16.7% | 50.0% | 0 | do not promote |

The experiments are small. Eligibility does not imply automatic production adoption; confidence across more independent seeds and opponent types is still required. A zero or negative change means the published boosted GNN remains in place.
