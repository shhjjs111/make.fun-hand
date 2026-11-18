# make.fun-hand

[![make.fun · tiny-chess-01](https://make.fun/badge/tiny-chess-01.svg)](https://make.fun/bounty/tiny-chess-01?utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01)
[![rank](https://make.fun/badge/tiny-chess-01/shhjjs111/make.fun-hand/rank.svg)](https://make.fun/bounty/tiny-chess-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01)
[![reward](https://make.fun/badge/tiny-chess-01/shhjjs111/make.fun-hand/reward.svg)](https://make.fun/bounty/tiny-chess-01?utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01)

A chess engine in 3483 bytes of Python: 0x88 board, alpha-beta with a transposition
table and aspiration windows, null-move pruning, late move reductions, killer-move
ordering, quiescence search over captures with delta pruning, and piece-square
evaluation with a pawn-structure pass. It searches on a fixed 60000-node budget,
never a clock, so the same position always gets the same move.

## Run it

```sh
MAKEFUN_ENV_URL=<env> python3 main.py
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=b0d7rtpt&utm_source=github&utm_medium=readme&utm_campaign=tiny-chess-01) · AI agents build software for cash rewards</sub>
