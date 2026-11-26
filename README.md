# Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shhjjs111/make.fun-hand/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shhjjs111/make.fun-hand/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The launch radar for make.fun's `token-radar-01`: one sealed DefiLlama snapshot in, a ranked board of
the protocols whose record carries no token, a value-if-it-launches estimate, token odds, a
held-out range, and a farm verdict with a ten-step plan.

The snapshot is the 2026-11-14 protocol index: 758 protocols. The board ranks **195**: the 40
watchlist names, 19 more above the floor the house list leaves out, and 136 below it. The ledger
accounts for every record once: 195 ranked, 128 priced token records, 288 token records without a
usable cap, and 147 products left out by the house list's own rules.

## The model

Two claims, multiplied:

```text
value_if_launches = TVL × base_multiple × (TVL / $100M) ^ size_slope × category_effect
token_odds        = (F(H) − F(a)) / (1 − F(a))
implied           = value_if_launches × token_odds
```

The value fit is least-trimmed squares on `ln(mcap / TVL)` over the **95** protocols that record a
positive market cap and a listing date, with eleven category effects and ridge 16 on the dummies:
`base_multiple = 0.191196` at $100M TVL, `size_slope = −0.422285`. The odds fit is an IRLS logistic on
the **645** protocols that record an age, of whether they record a token, on age, log TVL, 7-day
growth and the eleven categories: `b0 = −1.248345`, age `+0.609180`, ln TVL `+0.163656`, growth
`−2.570234`. `F` is the cumulative share of peers that record a token by a given age; `H` is the
oldest observed age (5.071 years), so `q` is the remaining cohort's completion share. No name is
read.

### Held-out evidence (measured by this build)

| term | leave-one-out | walk-forward |
| --- | ---: | ---: |
| flat median multiple | ×4.498 | ×5.489 |
| + size curve | ×3.545 | ×3.256 |
| + category effect | ×3.372 | **×2.797** |
| final value model | **×3.372** | **×2.797** |

The value model keeps 2 of 6 tested terms (size curve, category effect); growth, age, chain count,
the CeFi/DeFi family effect and the no-information control are shown, not used. The odds model keeps
4 of 5 (age, family, size, growth); chain count adds less than 0.001 Brier and is not used. Final
Brier: **0.1982 leave-one-out / 0.2233 walk-forward** against **0.2507 / 0.2862** base rates;
called right **68.1% / 66.9%** against **50.7% / 43.8%**.

The printed P25–P75 band is `implied × [0.2597, 2.1916]` and P10–P90 is
`implied × [0.0510, 7.2755]`, from the walk-forward residuals. Those bands cover **50.8%** and
**78.5%** of held-out caps (stated 50% / 80%); **50.8%** are within ×3. Two hundred bootstrap refits
give each row's rank range and the printed standard errors.

## The farm verdict

The scenario is a **$10,000** plan (capped at **0.017% of TVL**), a **7.0%** modelled drop share and
**12 weeks**:

```text
drop          = effective_deposit × 7.0% × implied / TVL
fees          = 0.0002 × $10,000 + $0.95 + $0.50 per extra chain
net           = drop − fees
net_per_hour  = net / (3.4 + category extra + 0.25 per extra chain)
FARM          = net > 4%-T-bill ($92.31) and net_per_hour > $25
MARGINAL      = net > 0 but not FARM
SKIP          = net ≤ 0
```

On this snapshot: **28 FARM / 165 MARGINAL / 2 SKIP**. The FARM subset carries **$1.85B TVL** and
**$349M implied**. Best net/hour: Arcus Perps $42.9, Firelight $42.0, Axis $39.6, Tori Finance $37.6,
Nado Spot $37.1. Every row carries `farm_deposit_usd`, `farm_drop_share`, `farm_drop_usd`,
`farm_fees_usd`, `farm_net_usd`, `farm_hours`, `farm_net_per_hour_usd`, `farm_tbill_usd`,
`farm_verdict`, both break-evens, the exit level and the 16-cell sensitivity matrix.

## The page

`dashboard/` is static: `index.html`, `app.css`, `app.js`, no framework, no webfont, no image, no
network request. It reads `data.js`, which `main.ts` writes beside it:

- **Board** — six KPI cards, the protocol-accounting ledger with six checks (including the FNV-1a
  digest of the exact `board.json` bytes, printed by `main.ts`), the out-of-sample evidence tables,
  the toolbar, and the ranked table with token odds, value if it launches, implied value, P25–P75,
  verdict, net of fees and net per hour.
- **Detail** — the seven-row “how the figure is made” table with each factor's held-out miss, the
  nearest priced peers, the farm verdict box with benchmarks and the 4×4 sensitivity matrix, and the
  ten-step plan with a cost and a time per step.
- **Decision** — the same board filtered to `verdict = FARM` and sorted by net per hour; the filter
  state is in the hash (`#verdict=farm&sort=net`).
- **Method** — the two equations, training counts, coefficient table with bootstrap standard
  errors, six evidence KPIs, all eleven category multipliers, the farm policy and the limits.

Every row is recomputed in the browser from the same coefficients and checked against `board.json`;
`window.radarParts` exposes that arithmetic to `tools/gate.mjs`.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
node tools/gate.mjs --snapshot <kit>/input/snapshot.json --out out
```

Node 22.18 or later, the standard library only. The program writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json`. Two runs into different directories are byte-for-byte
identical: the LTS fit has no random seed, the bootstrap and validation use a fixed PRNG, and every
write is ordered.

## Layout

```text
main.ts               reads the snapshot, fits, writes the board, data, page, shots and dossier
lib/model.ts          parser, LTS value fit, logistic odds, held-out tables, bootstrap, board
lib/farm.ts           farm verdict, sensitivity matrix, ten-step plan
dashboard/            index.html, app.css, app.js
screenshots/          1-board.png, 2-detail.png, 3-decision.png, 4-method.png
tools/gate.mjs        local gate and browser arithmetic check
tools/evidence.ts     prints the held-out evidence tables for a snapshot
tools/shoot.mjs       captures the four screenshots over DevTools
vendor/               make.fun's dossier library, unchanged
```

## What it does not claim

Implied value is this entry's own estimate, not a price and not a promise that a token will launch.
A record with no token is not proof that none exists. `drop_share`, the deposit cap, the fee schedule
and the hours are policy assumptions, not snapshot facts; yield earned meanwhile is left out. The
watchlist is the house's floor, and the 155 rows outside it are the radar's extension of the same rule.
