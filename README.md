# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shhjjs111/make.fun-hand/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shhjjs111/make.fun-hand/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar for make.fun's `token-radar-01` bounty: it reads the sealed protocol snapshot,
ranks the protocols whose record carries no token by an implied token value, gives each one a farm plan,
and hands the reader a static dashboard with a detail view per protocol.

The snapshot is DefiLlama's protocol index fetched on 2026-11-14: 758 protocols, 40 on the house's
watchlist (no token on record, at or above the $50M floor, not a wrapped, staked or bridged product).
The watchlist is a floor, never a ceiling, so the radar applies the same product rules below it and
ranks **195 protocols**: the 40 watchlist names, 19 more above the floor that the house's list leaves out,
and 136 below it. A full-snapshot audit accounts for all 758: 195 ranked pre-token, 147 no-token products
excluded (wrapped, staked or bridged products, CEX and versioned pools), 272 protocols with a token id but
no market cap, and 144 live tokens.

## The value model

The model is a **12-nearest-comparable median multiple**, computed at runtime from the snapshot. The
comparable set `C` is every protocol whose record carries a market cap of at least $5M and a positive
TVL — **87 rows** on this snapshot (41 sub-$5M caps and 16 zero-or-negative caps are left out). Nothing is
fitted: for a protocol `p` the page finds the 12 comparables with the smallest distance

```text
d(p,c) = ((ln tv − ln c.tvl) / s_T)^2
       + 4 · [bucket ≠ bucket(c)]
       + 0.5 · ((g − g(c)) / 0.5)^2
       + 0.05 · ((a − a(c)) / s_A)^2
```

where `g` is the 7-day TVL change clamped to ±50%, `a = ln(1 + record_age/365)`, and `s_T`, `s_A` and the
age fallback are population scales of `C` itself (2.100929, 0.374615, 995 days). The implied value is
`max(1, round(TVL × median(mcap/TVL of the 12)))`. For a live row the row itself is excluded from `C`, so
the check is leave-one-out. No protocol name is read: the only lookup is DefiLlama's category → bucket map.

On this snapshot:

| | |
| --- | --- |
| live comparables | 87 (mcap ≥ $5M, TVL > 0) |
| median multiple | 0.4793× TVL |
| IQR | 0.1686–1.5651× |
| validation | 5-fold × 20 repeats over C, n = 1,740 held-out predictions |
| median error | 2.373× |
| within 2× / 3× | 41.9% / 60.3% |
| rank IC | 0.422 |
| 50% held-out band | 0.351–2.111× (coverage 50.0%) |
| 80% held-out band | 0.170–5.678× (coverage 80.3%) |

The 50% and 80% bands are the 25th/75th and 10th/90th percentiles of signed held-out log error
`ln(actual/predicted)` computed inside `validate()`, with the share of held-out rows inside each band as
its coverage. They are estimates from 87 rows: the ranking is the model's claim, the absolute value is an
estimate. (The design note's measured 2.361× / 42.1% / 0.430 used a 0.10 age weight and scored held-out
comparables with the fallback age; this entry uses the spec's 0.05 weight and each row's real `listed_at`
age, which moves the numbers slightly.)

The same rule is applied to the 195 pre-token protocols. No protocol name is special-cased: the category
map knows DefiLlama's taxonomy, not a list of winners.

## The page

`dashboard/` is a static page — `index.html`, `z.css`, `a-model.js`, `plan.js`, `app.js`, no framework,
no webfont, no image, no network request. `a-model.js` is the real value model (`fitModel`, `validate`,
`scoreProtocol` and the bucket map) that `lib/model.ts` re-exports, and `plan.js` is the real farm
generator (`farmPlan`, `farmBudget`, `positionFor`, `guardrailFor`, `riskFor`, `capitalFor`,
`holdDaysFor`, `CHAIN_GAS`) that `lib/farm.ts` re-exports, so the page and the program run one
implementation of each. It reads `data.js`, which the program writes beside the page:

- a **board** of every pre-token protocol, sortable on every column, filterable by search, category,
  chain, age and watchlist membership;
- a **live-token tab** with the 144 token-bearing protocols (128 with a priced cap), the market's cap beside the model's fitted
  value, sorted by how close the fit came;
- a **detail drawer** for every protocol: its record, the 12-row neighbour table with each neighbour's TVL,
  market cap, multiple and distance, the `TVL × median multiple = implied` arithmetic, the neighbour IQR, the
  50%/80% calibrated bands with coverage, a check that the page's own recomputation matches `board.json`, and
  a nine-step farm plan with a cost and a time for each step;
- a **methodology panel** with the rule, the distance weights, the 87-row comparable set, the validation
  numbers, the eleven-bucket table and what the model does not claim.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22.18 or later, the standard library only, no install. The program writes:

```text
out/board.json        the ranked board: 195 rows, each with rank, implied value and farm steps
out/data.js           the dashboard's inputs and the fitted model
out/dashboard/        the static page
out/screenshots/      the four captured views
out/dossier.json      what buildDossier writes from the four above, written last
```

## Check it

```sh
node tools/gate.mjs --snapshot <kit>/input/snapshot.json --out out
```

The tool checks the seven rows make.fun's scorer checks (board shape and ordering, watchlist coverage,
farm steps, dashboard files and network addresses, screenshots, dossier bytes) plus two local checks:
the dashboard's text source fits the dossier's 64 KiB cap, and a local Chromium re-runs the page's own
model and compares all 195 values and plans with `board.json`.

Two runs of `main.ts` into different directories are byte-for-byte identical: the comparable set is read
from the snapshot, the validation's folds come from a fixed PRNG, and every write is ordered.

## Layout

```text
main.ts               reads the snapshot, fits, writes the board, the data, the page and the dossier
lib/model.ts          the board layer (snapshot parser, product rules, ranking); re-exports the fit
lib/farm.ts           the farm-plan generator: category, chains, TVL and age in, nine steps out
dashboard/            index.html, z.css, a-model.js, app.js — the page the judge reads
screenshots/          1-board.png, 2-detail.png, 3-filtered.png, 4-method.png
tools/gate.mjs        the local gate and the page-arithmetic check
tools/shoot.mjs       captures the four screenshots from a finished build over DevTools
vendor/               make.fun's dossier library, unchanged
```

## What it does not claim

Implied value is this entry's own claim, computed from the snapshot's own TVL, 7-day change and record age.
It is not a prediction that a token will be issued, and a record with no token is not proof that none
exists: a protocol on the watchlist may still carry a token DefiLlama does not record, so every farm
plan starts by checking the protocol's own site.
