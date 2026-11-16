# 19×19 square GNN64 transfer experiment

Start from real 512 self-play + 44 teacher-game 13×13 GNN64. Fine-tune with 3 independently seeded 19×19 teacher games; hold out an additional 19×19 teacher game. Evaluate with fresh seeds and 6 rotated seats. **19×19 real-device inference and statistically reliable strength are not established.**

| Model | Completed games | Win share | Observed stone share | Early passes | JS inference mean per move |
|---|---:|---:|---:|---:|---:|
| candidate | 6/6 | 0.0% | 25.3% | 0 | 26.8 ms |
| source | 6/6 | 0.0% | 28.7% | 0 | 27.0 ms |
| linear | 6/6 | 0.0% | 8.1% | 0 | 16.1 ms |

Direct outrank vs pretransfer model: 16.7% (6/6 naturally finished).
Direct outrank vs linear learned CPU: 83.3% (6/6 naturally finished).

Decision: **experiment only; no production promotion without larger independent benchmarks and phone latency**
