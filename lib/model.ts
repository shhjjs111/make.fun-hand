// The token radar's value model: one snapshot in, one ranked board out.
//
// A protocol's token is a claim on the protocol's own record. 128 protocols in the snapshot already
// record both a TVL and a market cap, and those 128 rows are the training set: the market's own price
// for a given TVL, growth rate, age and category. We fit, in log space,
//
//   ln(mcap) = alpha + beta * ln(tvl / $100M) + gamma * g + delta * ln(1 + age_years) + effect[bucket]
//
// where g is the 7-day TVL change in fraction form, clamped to +/-50%, and effect[bucket] is one of
// eleven category effects. The fit is least-trimmed squares: 20% of the rows with the largest residual
// are held out of each iteration, because a handful of records price a chain token or a sibling token
// against a pool's TVL and would otherwise drag the line. Category effects carry a ridge penalty (the
// small buckets shrink toward zero), and the intercept is then calibrated so the median token-bearing
// protocol is priced at exactly its market cap.
//
// The fitted equation is applied to the protocols whose record carries no token. Nothing here reads a
// protocol's name: the same function scores every row, and the dashboard repeats the arithmetic from
// the same coefficients so the page and board.json can be checked against each other.
//
// The board's universe is the watchlist plus the protocols below the watchlist floor that pass the
// watchlist's own product rules (no wrapped, staked or bridged product, no versioned pool, no exchange).
// The watchlist is a floor, never a ceiling; the extension is where the radar finds its early rows.

/** One protocol as the sealed snapshot writes it: exactly the ten fields the input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model, with everything the dashboard states about it. */
export interface FitModel {
  version: string;
  ref_tvl_usd: number;
  growth_clip_pct: number;
  age_fallback_days: number;
  trim_share: number;
  ridge: number;
  lts_iterations: number;
  coefficients: {
    alpha: number;
    beta: number;
    gamma: number;
    delta: number;
  };
  calibration: number;
  buckets: BucketEffect[];
  training: TrainingSummary;
  validation: ValidationSummary;
}

/** One category bucket's fitted effect and how much of the training set it holds. */
export interface BucketEffect {
  name: string;
  effect: number;
  multiplier: number;
  n: number;
}

/** What the fit saw: how many rows, how many were trimmed, which records it could not use. */
export interface TrainingSummary {
  n: number;
  trimmed: number;
  no_market_cap: number;
  zero_market_cap: number;
  no_token: number;
  median_age_days: number;
  median_implied_ratio: number;
}

/** Out-of-sample numbers: repeated k-fold cross-validation over the training rows. */
export interface ValidationSummary {
  folds: number;
  repeats: number;
  n: number;
  median_abs_log_error: number;
  median_factor: number;
  r2: number;
  within_2x: number;
}

/** One row of the ranked board, exactly as board.json writes it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  bucket: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  age_imputed: boolean;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    size_multiple: number;
    growth_multiple: number;
    age_multiple: number;
    category_multiple: number;
    growth_pct: number;
  };
  farm_steps: string[];
}

/** A row as the dashboard reads it: the inputs, never the answer, so the page recomputes the value. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  bucket: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watch: 0 | 1;
  implied: number;
  plan: string[];
}

/** A token-bearing protocol: the market's own value, shown beside the model's fitted value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  bucket: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  mcap_usd: number;
  fitted_usd: number;
  ratio: number;
}

/** Everything the dashboard renders, plus the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist_size: number;
  board_size: number;
  below_floor_size: number;
  live_size: number;
  model: FitModel;
  rows: RadarRow[];
  live: LiveRow[];
}

/** One training observation: a protocol whose token trades. */
interface TrainRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  g: number;
  age_days: number | null;
  bucket: string;
}

const DAY_MS = 86_400_000;
const REF_TVL_USD = 100_000_000;
const GROWTH_CLIP_PCT = 50;
const TRIM_SHARE = 0.2;
const RIDGE = 16;
const LTS_MAX_ITERATIONS = 40;
const CV_FOLDS = 5;
const CV_REPEATS = 20;
const CV_SEED = 2_026_1114;

/** The eleven buckets: a protocol's DefiLlama categories mapped onto one valuation family each. */
export const BUCKETS = [
  'Bridge',
  'CEX',
  'Curators',
  'DEX',
  'Derivatives',
  'Lending',
  'Other',
  'RWA',
  'Stablecoin & CDP',
  'Staking',
  'Yield',
] as const;

/** The category -> bucket map. It maps DefiLlama's taxonomy, never a protocol's name. */
const BUCKET_BY_CATEGORY: Record<string, string> = {
  Lending: 'Lending',
  'Collateral Management': 'Lending',
  'Uncollateralized Lending': 'Lending',
  CDP: 'Stablecoin & CDP',
  'CDP Manager': 'Stablecoin & CDP',
  'Dual-Token Stablecoin': 'Stablecoin & CDP',
  'Stablecoin Issuer': 'Stablecoin & CDP',
  'Stablecoin Wrapper': 'Stablecoin & CDP',
  'Algo-Stables': 'Stablecoin & CDP',
  'Reserve Currency': 'Stablecoin & CDP',
  Dexs: 'DEX',
  'Liquidity Manager': 'DEX',
  Launchpad: 'DEX',
  'Liquid Staking': 'Staking',
  'Staking Pool': 'Staking',
  'Liquid Restaking': 'Staking',
  Restaking: 'Staking',
  'Restaked BTC': 'Staking',
  'Anchor BTC': 'Staking',
  Bridge: 'Bridge',
  'Canonical Bridge': 'Bridge',
  'Cross Chain Bridge': 'Bridge',
  RWA: 'RWA',
  Yield: 'Yield',
  'Yield Aggregator': 'Yield',
  'Basis Trading': 'Yield',
  'Leveraged Farming': 'Yield',
  Farm: 'Yield',
  Indexes: 'Yield',
  Derivatives: 'Derivatives',
  Options: 'Derivatives',
  'Options Vault': 'Derivatives',
  Synthetics: 'Derivatives',
  'Interest Rate Derivatives': 'Derivatives',
  'Prediction Market': 'Derivatives',
  'Risk Curators': 'Curators',
  'Onchain Capital Allocator': 'Curators',
  'Governance Incentives': 'Curators',
  CEX: 'CEX',
  CeDeFi: 'CEX',
};

/** Categories whose TVL is a wrapped, staked or bridged product of an asset that already trades. */
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'CEX']);

/** A name ending in a release marker is a pool or a product of another protocol, not a launch. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking names a receipt, not a protocol still to come. */
const RECEIPT_WORD = /\b(wrapped|staked|staking)\b/i;
/** An exchange's own desk is not a protocol waiting on a token. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The category bucket a DefiLlama category falls in. */
export function bucketOf(category: string | null): string {
  return category === null ? 'Other' : BUCKET_BY_CATEGORY[category] ?? 'Other';
}

/** Whole days from `listed_at` to the snapshot's `as_of`, or null when the record carries no date. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The 7-day change as a fraction, clamped the way the model states it; null counts as no change. */
export function growthFraction(change7d: number | null): number {
  const raw = isFiniteNumber(change7d) ? change7d : 0;
  return Math.min(GROWTH_CLIP_PCT, Math.max(-GROWTH_CLIP_PCT, raw)) / 100;
}

/** The age term's transform: ln(1 + years), with the training median standing in for an unlisted age. */
export function ageTerm(ageDays: number | null, fallbackDays: number): number {
  const days = ageDays === null ? fallbackDays : ageDays;
  return Math.log(1 + Math.max(0, days) / 365);
}

/** The design row for one observation: intercept, log TVL, growth, age, then one-hot buckets. */
function designRow(tvlUsd: number, g: number, ageDays: number | null, bucket: string, fallbackDays: number): number[] {
  const row: number[] = [1, Math.log(Math.max(1, tvlUsd) / REF_TVL_USD), g, ageTerm(ageDays, fallbackDays)];
  for (const name of BUCKETS) row.push(name === bucket ? 1 : 0);
  return row;
}

/** The dot product of a design row and a coefficient vector. */
function dot(x: number[], coef: number[]): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i]! * coef[i]!;
  return sum;
}

/** Weighted normal equations: (X'WX) coef = X'Wy. */
function normalEquations(xs: number[][], ys: number[], weights: number[]): { a: number[][]; b: number[] } {
  const n = xs[0]!.length;
  const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const w = weights[i]!;
    if (w === 0) continue;
    const x = xs[i]!;
    for (let j = 0; j < n; j++) {
      b[j]! += w * x[j]! * ys[i]!;
      for (let k = 0; k < n; k++) a[j]![k]! += w * x[j]! * x[k]!;
    }
  }
  return { a, b };
}

/**
 * Solve a ridge-penalised system by Gauss-Jordan elimination with partial pivoting. `penalty[j]` is the
 * ridge weight on column j; the intercept and the three slopes are unpenalised, the bucket dummies are.
 */
function ridgeSolve(a: number[][], b: number[], penalty: number[]): number[] {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) m[i]![i]! += penalty[i]!;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) continue;
    const swap = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = swap;
    const d = m[col]![col]!;
    for (let k = col; k <= n; k++) m[col]![k]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) m[r]![k]! -= f * m[col]![k]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** The ridge weights: the intercept and slopes free, each bucket dummy shrunk by `RIDGE`. */
function penalties(): number[] {
  const p = new Array<number>(4 + BUCKETS.length).fill(0);
  for (let i = 4; i < p.length; i++) p[i] = RIDGE;
  return p;
}

/** Weighted least squares with the model's ridge weights. */
function weightedLeastSquares(xs: number[][], ys: number[], weights: number[]): number[] {
  const { a, b } = normalEquations(xs, ys, weights);
  return ridgeSolve(a, b, penalties());
}

/** The median of a list of numbers (a copy is sorted; an empty list is 0). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Least-trimmed squares: refit on the best `1 - TRIM_SHARE` residuals until the kept set settles. */
function ltsFit(xs: number[][], ys: number[], trimShare: number): { coef: number[]; kept: number } {
  const n = xs.length;
  const keepCount = Math.round(n * (1 - trimShare));
  let weights: number[] = new Array<number>(n).fill(1);
  let coef = weightedLeastSquares(xs, ys, weights);
  let previous: number[] | null = null;
  for (let it = 0; it < LTS_MAX_ITERATIONS; it++) {
    const residuals = ys.map((y, i) => Math.abs(y - dot(xs[i]!, coef)));
    const order = residuals.map((_, i) => i).sort((i, j) => residuals[i]! - residuals[j]! || i - j);
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < keepCount; i++) next[order[i]!] = 1;
    coef = weightedLeastSquares(xs, ys, next);
    if (previous !== null && next.every((v, i) => v === previous![i])) {
      weights = next;
      break;
    }
    previous = next;
    weights = next;
  }
  return { coef, kept: weights.reduce((sum, w) => sum + w, 0) };
}

/** The median ratio of market cap to fitted value: the level correction applied to the intercept. */
function calibrationOf(rows: TrainRow[], coef: number[], fallbackDays: number): number {
  const ratios = rows.map((r) => {
    const fitted = Math.exp(dot(designRow(r.tvl_usd, r.g, r.age_days, r.bucket, fallbackDays), coef));
    return r.mcap_usd / Math.max(1, fitted);
  });
  const m = median(ratios);
  return isFiniteNumber(m) && m > 0 ? m : 1;
}

/** A deterministic PRNG, so the validation's folds are the same bytes on every run and machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Repeated k-fold cross-validation over the training rows, in log space. */
function validate(rows: TrainRow[], fallbackDays: number): ValidationSummary {
  const ys = rows.map((r) => Math.log(r.mcap_usd));
  const xs = rows.map((r) => designRow(r.tvl_usd, r.g, r.age_days, r.bucket, fallbackDays));
  const errors: number[] = [];
  const observed: number[] = [];
  let squared = 0;
  let within = 0;
  for (let rep = 0; rep < CV_REPEATS; rep++) {
    const random = mulberry32(CV_SEED + rep * 7919);
    const index = rows.map((_, i) => i);
    for (let i = index.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const swap = index[i]!;
      index[i] = index[j]!;
      index[j] = swap;
    }
    const folds: number[][] = Array.from({ length: CV_FOLDS }, () => []);
    index.forEach((v, i) => folds[i % CV_FOLDS]!.push(v));
    for (const test of folds) {
      const testSet = new Set(test);
      const trainIdx = index.filter((i) => !testSet.has(i));
      const trainRows = trainIdx.map((i) => rows[i]!);
      const trainXs = trainIdx.map((i) => xs[i]!);
      const trainYs = trainIdx.map((i) => ys[i]!);
      const { coef } = ltsFit(trainXs, trainYs, TRIM_SHARE);
      const calibration = calibrationOf(trainRows, coef, fallbackDays);
      for (const i of test) {
        const predicted = dot(xs[i]!, coef) - Math.log(calibration);
        const error = predicted - ys[i]!;
        errors.push(Math.abs(error));
        observed.push(ys[i]!);
        squared += error * error;
        if (Math.abs(error) <= Math.LN2) within++;
      }
    }
  }
  const mean = observed.reduce((sum, v) => sum + v, 0) / Math.max(1, observed.length);
  const total = observed.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  const mae = median(errors);
  return {
    folds: CV_FOLDS,
    repeats: CV_REPEATS,
    n: errors.length,
    median_abs_log_error: round(mae, 4),
    median_factor: round(Math.exp(mae), 3),
    r2: round(1 - squared / Math.max(1e-9, total), 4),
    within_2x: round(within / Math.max(1, errors.length), 4),
  };
}

/** A number rounded to `digits` decimal places, for the data file and the page. */
export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Whether the record carries no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a name and category pass the watchlist's product rules (a launch of its own, not a receipt). */
export function isOwnProduct(p: SnapshotProtocol): boolean {
  if (EXCHANGE_NAME.test(p.name)) return false;
  if (RECEIPT_WORD.test(p.name)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  return !PRODUCT_CATEGORY.has(p.category ?? '');
}

/**
 * Fit the model to the snapshot. The training rows are the protocols that record a token with a
 * positive market cap; rows with no market cap, or a zero one, cannot be logged and are counted,
 * not guessed at.
 */
export function fitModel(snapshot: Snapshot): FitModel {
  const noToken = snapshot.protocols.filter(recordsNoToken).length;
  const withMcap = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const zero = withMcap.filter((p) => (p.mcap_usd ?? 0) <= 0).length;
  const train: TrainRow[] = withMcap
    .filter((p) => (p.mcap_usd ?? 0) > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      g: growthFraction(p.change_7d),
      age_days: ageInDays(snapshot.as_of, p.listed_at),
      bucket: bucketOf(p.category),
    }));
  if (train.length < 40) throw new SnapshotError(`only ${train.length} protocols record both a TVL and a market cap: too few to fit`);

  const knownAges = train.filter((r) => r.age_days !== null).map((r) => r.age_days as number);
  const fallbackDays = Math.max(30, Math.round(median(knownAges)));
  const xs = train.map((r) => designRow(r.tvl_usd, r.g, r.age_days, r.bucket, fallbackDays));
  const ys = train.map((r) => Math.log(r.mcap_usd));
  const { coef, kept } = ltsFit(xs, ys, TRIM_SHARE);
  const calibration = calibrationOf(train, coef, fallbackDays);
  const validation = validate(train, fallbackDays);

  const buckets: BucketEffect[] = BUCKETS.map((name, i) => {
    const effect = coef[4 + i] ?? 0;
    return {
      name,
      effect: round(effect, 5),
      multiplier: round(Math.exp(effect), 4),
      n: train.filter((r) => r.bucket === name).length,
    };
  });

  return {
    version: 'radar 2.0 · log-linear LTS',
    ref_tvl_usd: REF_TVL_USD,
    growth_clip_pct: GROWTH_CLIP_PCT,
    age_fallback_days: fallbackDays,
    trim_share: TRIM_SHARE,
    ridge: RIDGE,
    lts_iterations: LTS_MAX_ITERATIONS,
    coefficients: {
      alpha: round(coef[0]!, 6),
      beta: round(coef[1]!, 6),
      gamma: round(coef[2]!, 6),
      delta: round(coef[3]!, 6),
    },
    calibration: round(calibration, 6),
    buckets,
    training: {
      n: train.length,
      trimmed: Math.round(train.length - kept),
      no_market_cap: snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length,
      zero_market_cap: zero,
      no_token: noToken,
      median_age_days: Math.round(median(knownAges)),
      median_implied_ratio: round(calibration, 4),
    },
    validation,
  };
}

/** One protocol's valuation under the fitted model: the value and every multiplier behind it. */
export interface Score {
  implied: number;
  base_multiple: number;
  size_multiple: number;
  growth_multiple: number;
  age_multiple: number;
  category_multiple: number;
  growth_pct: number;
  age_days: number | null;
  age_imputed: boolean;
}

/**
 * Apply the fitted equation to one protocol. The base multiple is the fitted multiple at $100M of TVL
 * with no growth and a brand-new listing; the size, growth, age and category multipliers then move it.
 * The dashboard repeats exactly this arithmetic from the same coefficients.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, fit: FitModel): Score {
  const age = ageInDays(asOf, p.listed_at);
  const g = growthFraction(p.change_7d);
  const bucket = bucketOf(p.category);
  const effect = fit.buckets.find((b) => b.name === bucket)?.effect ?? 0;
  // The base multiple is the fitted multiple at the reference TVL with no growth and a new listing:
  // exp(alpha) is the fitted market cap at that TVL, so the multiple is exp(alpha) / ref, calibrated.
  const base = Math.exp(fit.coefficients.alpha) / fit.calibration / fit.ref_tvl_usd;
  const size = Math.pow(Math.max(1, p.tvl_usd) / fit.ref_tvl_usd, fit.coefficients.beta - 1);
  const growth = Math.exp(fit.coefficients.gamma * g);
  const ageMultiplier = Math.exp(fit.coefficients.delta * ageTerm(age, fit.age_fallback_days));
  const category = Math.exp(effect);
  const value = Math.max(1, Math.round(p.tvl_usd * base * size * growth * ageMultiplier * category));
  return {
    implied: value,
    base_multiple: base,
    size_multiple: size,
    growth_multiple: growth,
    age_multiple: ageMultiplier,
    category_multiple: category,
    growth_pct: g * 100,
    age_days: age,
    age_imputed: age === null,
  };
}

/** The fitted value of a token-bearing protocol, used by the live-token tab to check the model. */
export function fittedValueOf(p: SnapshotProtocol, asOf: string, fit: FitModel): number {
  return scoreProtocol({ ...p, mcap_usd: null, gecko_id: null, symbol: null }, asOf, fit).implied;
}

/** The protocols the board ranks: the watchlist, and below the floor every protocol the same rule finds. */
export function boardUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  const onWatchlist = new Set(snapshot.watchlist);
  return snapshot.protocols.filter((p) => {
    if (!recordsNoToken(p)) return false;
    if (onWatchlist.has(p.slug)) return true;
    return p.tvl_usd < snapshot.floor_usd && isOwnProduct(p);
  });
}

/** The live-token set: every protocol whose token records a positive market cap. */
export function liveUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0);
}

/** The board: one row per protocol in the universe, ranked by implied value, strongest first. */
export function buildBoard(snapshot: Snapshot, fit: FitModel): BoardRow[] {
  const onWatchlist = new Set(snapshot.watchlist);
  const scored = boardUniverse(snapshot).map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, fit) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    bucket: bucketOf(s.p.category),
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    age_days: s.score.age_days,
    age_imputed: s.score.age_imputed,
    watchlist: onWatchlist.has(s.p.slug),
    implied_value_usd: s.score.implied,
    model: {
      base_multiple: round(s.score.base_multiple, 8),
      size_multiple: round(s.score.size_multiple, 6),
      growth_multiple: round(s.score.growth_multiple, 6),
      age_multiple: round(s.score.age_multiple, 6),
      category_multiple: round(s.score.category_multiple, 6),
      growth_pct: round(s.score.growth_pct, 2),
    },
    farm_steps: [],
  }));
}

/** The live-token rows: the market's own cap beside the model's fitted value for the same record. */
export function buildLive(snapshot: Snapshot, fit: FitModel): LiveRow[] {
  return liveUniverse(snapshot)
    .map((p) => {
      const fitted = fittedValueOf(p, snapshot.as_of, fit);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        bucket: bucketOf(p.category),
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: ageInDays(snapshot.as_of, p.listed_at),
        mcap_usd: p.mcap_usd as number,
        fitted_usd: fitted,
        ratio: round((p.mcap_usd as number) / fitted, 4),
      };
    })
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
}

/** Everything the dashboard needs: the board's inputs, the live set and the model's own numbers. */
export function buildRadar(snapshot: Snapshot, fit: FitModel, board: BoardRow[]): RadarData {
  const live = buildLive(snapshot, fit);
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    bucket: r.bucket,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    watch: r.watchlist ? 1 : 0,
    implied: r.implied_value_usd,
    plan: r.farm_steps,
  }));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    below_floor_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    model: fit,
    rows,
    live,
  };
}

/** data.js: the page's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Why a board is not one the gate will take, or null. The entry refuses to write a failing board. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const belowFloor = board.filter((r) => !r.watchlist).length;
  if (belowFloor < 60) return `only ${belowFloor} rows come from outside the watchlist: the gate wants at least 60`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows carry the same implied value`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the gate's cap`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${r.slug} has a farm step of ${step.length} characters`;
    }
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (!isFiniteNumber(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols: SnapshotProtocol[] = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !isFiniteNumber(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: isFiniteNumber(p.change_7d) ? p.change_7d : null,
      mcap_usd: isFiniteNumber(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}
