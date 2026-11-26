# Square GNN64 teacher+tactics fusion: independent confirmation

The teacher-guard variant was selected on prior 20261127 screening, **not on this data**. This is an independent 20271227/20271228-seed tournament against the unchanged pretrained GNN64 or the independent learned linear CPU, with balanced and guarded third-player policies. All six seat assignments are rotated in each batch.

| Rival | Third CPU | Board | Natural finals | Hybrid win | Rival win | Hybrid outranks rival | Hybrid stone share | Rival stone share | Mean CPU time |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| neural | balanced | 9×9 | 36/36 | 31.9% | 13.9% | 58.3% | 35.8% | 26.1% | 6.7 ms |
| neural | balanced | 13×13 | 18/18 | 16.7% | 33.3% | 55.6% | 32.9% | 30.3% | 15.7 ms |
| neural | guarded | 9×9 | 35/36 | 41.4% | 14.3% | 68.6% | 35.8% | 23.0% | 6.6 ms |
| neural | guarded | 13×13 | 18/18 | 11.1% | 16.7% | 44.4% | 24.7% | 27.6% | 15.8 ms |
| linear | balanced | 9×9 | 33/36 | 39.4% | 15.2% | 75.8% | 47.8% | 12.5% | 5.2 ms |
| linear | balanced | 13×13 | 18/18 | 38.9% | 11.1% | 88.9% | 51.3% | 9.6% | 12.9 ms |
| linear | guarded | 9×9 | 31/36 | 35.5% | 17.7% | 51.6% | 37.4% | 19.9% | 4.9 ms |
| linear | guarded | 13×13 | 18/18 | 44.4% | 5.6% | 94.4% | 55.1% | 4.9% | 12.6 ms |

Independent adoption check: {"9": "remain research-only", "13": "remain research-only"}.

Evidence is still limited to preset CPU matchups; it is not proof of human-level or general optimal Go play. Mobile device benchmarks have not been performed.
