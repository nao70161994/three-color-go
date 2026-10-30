# AI agent instructions: Three Color Hex Go

## Goal
A playable 3-player Go variant. Three colors, hexagonal board (6 neighbors), stone-count scoring, positional superko. Improve the game only while preserving agreed rules unless the owner requests a rule change.

## Available agent interfaces
- Node.js JSONL CLI: `node scripts/agent-play.mjs`. Send one JSON object per line and parse one JSON result per line. No dependencies.
- Self-play: `node scripts/agent-play.mjs --selfplay 20 --seed 42 --radius 3`.
- Browser: `window.threeColorGo` with `getState(), legalMoves(), play(q,r), pass(), reset({mode:'local',radius:3}), undo(), exportRecord(), importRecord(record), autoPlay(limit,seed)`.
- Browser DOM: `g.cell[data-q="0"][data-r="0"]` for simulated human clicking.
- Browser smoke test: `tests/browser-smoke.html`, which exposes `#status[data-status="passed"|"failed"]` and a human-readable log.

## Playing from an agent
1. Start a game with `{"action":"new","radius":3}`.
2. Query `{"action":"state"}` and `{"action":"legal"}`.
3. Choose a listed coordinate and submit `{"action":"play","q":0,"r":0}` or `{"action":"pass"}`.
4. Repeat until `state.ended` is true. Read `state.scores` and `state.winners`.
5. Use `{"action":"export"}` to retain a reproducible game record. Import the same record to confirm replay.
6. Batch test with the seeded simulation command. Always include seeds, moves, and failure messages in bug reports.

## Before completing changes
- Run `npm test` and verify all cases pass.
- If UI is changed, run the browser smoke test using a real browser and verify the DOM status is passed, not merely that the page loads.
- Check mobile viewport layout (390x844), human and CPU modes, 3 passes, and invalid moves.
- Never claim the live GitHub Pages site is deployed until the Pages workflow has succeeded and the URL can be loaded.
- Never silently rewrite rules. A bot choosing to pass is not a mandatory game-end rule.

## Known limitations
- CPU is only a lightweight, deterministic-under-seed heuristic, not a competitive Go engine.
- No online play.
- No dead-stone agreement or automatic removal after 3 passes.
- Browser save uses localStorage and may be unavailable in restricted browsing environments.
