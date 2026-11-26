# Square hybrid A/B screening: new tactics vs unchanged pretrained GNN64

All candidates use the **same immutable self-play 512 + teacher-distilled GNN64** on each board. Every compared AI participates in the *same* three-player game, with all six seat permutations, independent seeds and a balanced or guarded third player. Any win rate below is a whole-game outcome, whereas outrank is relative stone count. No results were used in neural training.

| Variant | 3rd CPU | Board | Natural finals | Hybrid win | Original win | Hybrid outranks original | Observed stones hybrid/original | Mean hybrid decision |
|---|---|---|---:|---:|---:|---:|---:|---:|
| neural-guard | balanced | 9×9 | 18/18 | 25.0% | 16.7% | 50.0% | 28.1%/27.0% | 6.4 ms |
| neural-guard | balanced | 13×13 | 12/12 | 8.3% | 16.7% | 58.3% | 31.3%/25.6% | 12.7 ms |
| neural-guard | guarded | 9×9 | 18/18 | 19.4% | 0.0% | 50.0% | 23.5%/19.8% | 3.0 ms |
| neural-guard | guarded | 13×13 | 12/12 | 16.7% | 16.7% | 66.7% | 29.8%/26.0% | 6.9 ms |
| teacher-blend | balanced | 9×9 | 18/18 | 38.9% | 11.1% | 55.6% | 36.9%/28.4% | 7.6 ms |
| teacher-blend | balanced | 13×13 | 12/12 | 41.7% | 0.0% | 41.7% | 27.0%/24.7% | 17.0 ms |
| teacher-blend | guarded | 9×9 | 18/18 | 27.8% | 8.3% | 50.0% | 30.2%/22.6% | 4.3 ms |
| teacher-blend | guarded | 13×13 | 12/12 | 25.0% | 25.0% | 33.3% | 24.6%/27.1% | 11.3 ms |
| teacher-guard | balanced | 9×9 | 18/18 | 55.6% | 2.8% | 72.2% | 41.7%/22.9% | 3.7 ms |
| teacher-guard | balanced | 13×13 | 12/12 | 33.3% | 16.7% | 58.3% | 34.7%/22.5% | 8.9 ms |
| teacher-guard | guarded | 9×9 | 18/18 | 38.9% | 13.9% | 66.7% | 32.3%/23.9% | 5.1 ms |
| teacher-guard | guarded | 13×13 | 12/12 | 50.0% | 16.7% | 66.7% | 41.9%/25.0% | 12.5 ms |

Provisional screening picks: {'9': 'teacher-guard', '13': 'teacher-guard'}. **A pick requires an entirely untouched confirmation seed and more complete games, then is still opt-in unless robustly superior.**
