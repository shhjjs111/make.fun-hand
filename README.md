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

The 128 protocols in the snapshot that record both a TVL and a positive market cap are the training set.
The model is a log-linear fit, in log space:

```text
ln(mcap) = α + β·ln(TVL / $100M) + γ·g + δ·ln(1 + age_years) + effect[bucket]
```

with `g` the 7-day TVL change clamped to ±50%, eleven category buckets, a ridge penalty on the bucket
dummies, and least-trimmed squares (the worst 20% of residuals are refitted out each iteration, because a
few records price a chain token or a sibling token against a pool's TVL). The intercept is then
calibrated so the median token-bearing protocol is priced at its market cap.

On this snapshot:

| | |
| --- | --- |
| α, β, γ, δ | 16.5376, 0.5476, 0.6400, 0.2522 |
| training rows | 128 of 144 with a market cap (16 record a zero market cap) |
| trimmed per iteration | 26 |
| calibration | 0.8668 |
| validation | 5-fold × 20 repeats, n = 2,560 out-of-sample predictions |
| median error | 3.889× in value (1.358 in log space) |
| R² (log space) | 0.121 |
| within 2× | 28% |

The cross-section is noisy, and the dashboard says so: the ranking is the model's claim, the absolute
value is an estimate. Growth and age are small tilts, and every row shows both multipliers.

The same equation is applied to the 195 pre-token protocols. No protocol name is special-cased: the
category map knows DefiLlama's taxonomy, not a list of winners.

## The page

`dashboard/` is a static page — `index.html`, `z.css`, `a-model.js`, `app.js`, no framework, no webfont,
no image, no network request. `a-model.js` is the real value model (`fitModel`, `ltsFit`, `validate`,
`scoreProtocol` and the bucket map) that `lib/model.ts` re-exports, so the page and the program run one
implementation. It reads `data.js`, which the program writes beside the page:

- a **board** of every pre-token protocol, sortable on every column, filterable by search, category,
  chain, age and watchlist membership;
- a **live-token tab** with the 144 token-bearing protocols (128 with a priced cap), the market's cap beside the model's fitted
  value, sorted by how close the fit came;
- a **detail drawer** for every protocol: its record, the model's five multipliers, the arithmetic that
  produces its value, a check that the page's own recomputation matches `board.json`, and a nine-step
  farm plan with a cost and a time for each step;
- a **methodology panel** with the equation, the coefficients, the fit's sample, the validation numbers
  and what the model does not claim.

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

Two runs of `main.ts` into different directories are byte-for-byte identical: the fit has no random
seed in it, the validation's folds come from a fixed PRNG, and every write is ordered.

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

Implied value is this entry's own claim, computed from the snapshot's TVL, 7-day change and listing age.
It is not a prediction that a token will be issued, and a record with no token is not proof that none
exists: a protocol on the watchlist may still carry a token DefiLlama does not record, so every farm
plan starts by checking the protocol's own site.
