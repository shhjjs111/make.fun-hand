// Token Radar v14 — the launch radar's value model.
//
// Two claims, multiplied. value_if_launches is a robust least-trimmed-squares fit of the market's own
// cap/TVL multiple on the protocols that already trade, with a size curve and eleven category effects:
//
//   value_if_launches = TVL × base × (TVL/$100M)^slope × category_effect
//
// token_odds is a logistic fit on every protocol that records an age, of whether it records a token:
//
//   z = b0 + b_age·years + b_T·ln(TVL/$100M) + b_g·growth + family_effect
//   q(a) = (F(H) − F(a)) / (1 − F(a))       the remaining peer cohort's completion share
//
// implied = value_if_launches × token_odds. Every coefficient is recomputed from snapshot fields; no
// protocol name is read. The held-out tables (leave-one-out, walk-forward, Brier, coverage, bootstrap)
// are computed here too, so every number the page prints is this run's measurement.

import { createHash } from 'node:crypto';

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Audit {
  total: number;
  ranked: number;
  watchlist: number;
  above_floor_others: number;
  below_floor: number;
  excluded: number;
  token_no_cap: number;
  live: number;
  live_priced: number;
  zero_cap: number;
  out_bridge: number;
  out_exchange: number;
  out_staking: number;
  out_versioned: number;
}

export interface ValueTerm { term: string; loo: number; wf: number; status: string }
export interface OddsTerm {
  term: string; loo: number; wf: number; base_loo: number; base_wf: number;
  hit_loo: number; hit_wf: number; base_hit_loo: number; base_hit_wf: number; status: string;
}
export interface Coverage { w3_loo: number; w3_wf: number; p25_loo: number; p25_wf: number; p10_loo: number; p10_wf: number }
export interface Bands { p25: number; p75: number; p10: number; p90: number }
export interface Bootstrap {
  n: number; base_se: number; slope_se: number; age_se: number; tvl_se: number; growth_se: number;
  cat_min: number; cat_max: number; fam_min: number; fam_max: number;
  ranges: Record<string, [number, number]>;
}

export interface FitModel {
  version: string;
  ref_tvl_usd: number;
  growth_clip_pct: number;
  age_fallback_days: number;
  ridge_value: number;
  ridge_odds: number;
  trim_share: number;
  base_multiple: number;
  size_slope: number;
  buckets: { name: string; effect: number; multiplier: number; n: number; odds: number }[];
  odds: { b0: number; age: number; tvl: number; growth: number; H_years: number; fallback_days: number; n_peers: number; n_token: number; rate: number };
  bands: { loo: Bands; wf: Bands };
  evidence: {
    value_terms: ValueTerm[]; odds_terms: OddsTerm[]; coverage: Coverage;
    value_kept: number; value_tested: number; odds_kept: number; odds_tested: number;
    wf_miss: number; loo_miss: number; flat_wf: number; flat_loo: number;
    brier: number; base_brier: number; brier_wf: number; base_brier_wf: number;
    hit: number; base_hit: number; hit_wf: number; base_hit_wf: number;
    n_pred_wf: number; n_pred_loo: number;
  };
  bootstrap: Bootstrap;
  training: { n_value: number; n_peers: number; n_token_peers: number; n_with_cap: number; n_zero: number; n_no_cap: number; trimmed: number; median_age_days: number };
}

export interface FarmFields {
  farm_deposit_usd: number;
  farm_drop_share: number;
  farm_horizon_weeks: number;
  farm_drop_usd: number;
  farm_fees_usd: number;
  farm_net_usd: number;
  farm_hours: number;
  farm_net_per_hour_usd: number;
  farm_tbill_usd: number;
  farm_verdict: string;
  farm_fee_break_even_pct: number;
  farm_odds_break_even_pct: number;
  farm_exit_tvl_usd: number;
  farm_sensitivity: { deposit_usd: number; share_pct: number; net_usd: number }[];
  farm_tx_count: number;
  farm_gas_usd: number;
  farm_protocol_fee_usd: number;
}

export interface BoardRow extends FarmFields {
  rank: number; slug: string; name: string; category: string | null; bucket: string; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; age_imputed: boolean; watchlist: boolean;
  value_if_launches_usd: number; token_odds: number; implied_value_usd: number;
  p25_usd: number; p75_usd: number; p10_usd: number; p90_usd: number; rank_lo: number; rank_hi: number;
  model: { base_multiple: number; size_multiple: number; category_multiple: number; growth_pct: number };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; bucket: string; chains: string[];
  tvl_usd: number; change_7d: number | null; age_days: number | null; imputed: 0 | 1; watch: 0 | 1; below: 0 | 1;
  implied: number; value_if: number; odds: number; p25: number; p75: number; p10: number; p90: number;
  rank_lo: number; rank_hi: number; farm: FarmFields; plan: string[];
}

export interface PeerRow {
  name: string; symbol: string | null; category: string | null; bucket: string; tvl_usd: number; mcap_usd: number; value_usd: number;
}

export interface RadarData {
  as_of: string; source: string; floor_usd: number; watchlist_size: number; board_size: number;
  audit: Audit; total_tvl: number; total_implied: number; farm_tvl: number; farm_implied: number; hash8: string;
  model: FitModel; rows: RadarRow[]; peers: PeerRow[]; source_bytes: number; source_files: number;
}

const DAY_MS = 86_400_000;
const REF_TVL_USD = 100_000_000;
const GROWTH_CLIP_PCT = 50;
const TRIM_SHARE = 0.2;
const RIDGE_VALUE = 16;
const RIDGE_ODDS = 16;
const LTS_MAX_ITERATIONS = 60;
const BOOT_N = 200;
const BOOT_SEED = 2_026_1114;

export const BUCKETS = [
  'Bridge', 'CEX', 'Curators', 'DEX', 'Derivatives', 'Lending', 'Other',
  'RWA', 'Stablecoin & CDP', 'Staking', 'Yield',
] as const;

const BUCKET_BY_CATEGORY: Record<string, string> = {
  Lending: 'Lending', 'Collateral Management': 'Lending', 'Uncollateralized Lending': 'Lending',
  CDP: 'Stablecoin & CDP', 'CDP Manager': 'Stablecoin & CDP', 'Dual-Token Stablecoin': 'Stablecoin & CDP',
  'Stablecoin Issuer': 'Stablecoin & CDP', 'Stablecoin Wrapper': 'Stablecoin & CDP',
  'Algo-Stables': 'Stablecoin & CDP', 'Reserve Currency': 'Stablecoin & CDP',
  Dexs: 'DEX', 'Liquidity Manager': 'DEX', Launchpad: 'DEX',
  'Liquid Staking': 'Staking', 'Staking Pool': 'Staking', 'Liquid Restaking': 'Staking',
  Restaking: 'Staking', 'Restaked BTC': 'Staking', 'Anchor BTC': 'Staking',
  Bridge: 'Bridge', 'Canonical Bridge': 'Bridge', 'Cross Chain Bridge': 'Bridge',
  RWA: 'RWA', Yield: 'Yield', 'Yield Aggregator': 'Yield', 'Basis Trading': 'Yield',
  'Leveraged Farming': 'Yield', Farm: 'Yield', Indexes: 'Yield',
  Derivatives: 'Derivatives', Options: 'Derivatives', 'Options Vault': 'Derivatives',
  Synthetics: 'Derivatives', 'Interest Rate Derivatives': 'Derivatives', 'Prediction Market': 'Derivatives',
  'Risk Curators': 'Curators', 'Onchain Capital Allocator': 'Curators', 'Governance Incentives': 'Curators',
  CEX: 'CEX', CeDeFi: 'CEX',
};

const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'CEX']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const RECEIPT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function bucketOf(category: string | null): string {
  return category === null ? 'Other' : BUCKET_BY_CATEGORY[category] ?? 'Other';
}

export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function growthFraction(change7d: number | null): number {
  const raw = isFiniteNumber(change7d) ? change7d : 0;
  return Math.min(GROWTH_CLIP_PCT, Math.max(-GROWTH_CLIP_PCT, raw)) / 100;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((x, y) => x - y);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (h - lo);
}

export function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
interface TrainRow {
  slug: string;
  name: string;
  cat: string;
  bucket: string;
  tvl: number;
  mcap: number;
  g: number;
  age: number | null;
  chains: number;
  listed: string | null;
  token: boolean;
  macro: string;
  g_other?: number;
}

function trainRow(p: SnapshotProtocol, asOf: string): TrainRow {
  const cat = p.category ?? 'Other';
  return {
    slug: p.slug, name: p.name, cat, bucket: bucketOf(p.category),
    tvl: p.tvl_usd, mcap: p.mcap_usd ?? 0, g: growthFraction(p.change_7d),
    age: ageInDays(asOf, p.listed_at), chains: p.chains.length, listed: p.listed_at,
    token: p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null,
    macro: cat === 'CEX' || cat === 'CeDeFi' ? 'CeFi' : 'DeFi',
  };
}

const MACROS = ['CeFi', 'Credit', 'Trading', 'Yield', 'Staking', 'Other'];

type ValueTerms = string[];

function designValue(rows: TrainRow[], terms: ValueTerms): number[][] {
  return rows.map((r) => {
    const x: number[] = [1];
    if (terms.includes('size')) x.push(Math.log(Math.max(1, r.tvl) / REF_TVL_USD));
    if (terms.includes('growth')) x.push(r.g);
    if (terms.includes('control')) x.push(r.g_other ?? 0);
    if (terms.includes('age')) x.push(Math.log(1 + (r.age === null ? 900 : r.age) / 365));
    if (terms.includes('chains')) x.push(Math.log(1 + r.chains));
    if (terms.includes('family')) for (const b of BUCKETS) x.push(r.bucket === b ? 1 : 0);
    if (terms.includes('macro')) for (const b of MACROS) x.push(r.macro === b ? 1 : 0);
    return x;
  });
}

function penaltiesFor(terms: ValueTerms): number[] {
  const p: number[] = [0];
  if (terms.includes('size')) p.push(0);
  if (terms.includes('growth')) p.push(0);
  if (terms.includes('control')) p.push(0);
  if (terms.includes('age')) p.push(0);
  if (terms.includes('chains')) p.push(0);
  if (terms.includes('family')) for (let i = 0; i < BUCKETS.length; i++) p.push(RIDGE_VALUE);
  if (terms.includes('macro')) for (let i = 0; i < MACROS.length; i++) p.push(RIDGE_VALUE);
  return p;
}

function dot(x: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * c[i]!;
  return s;
}

function normalEquations(xs: number[][], ys: number[], w: number[]): { a: number[][]; b: number[] } {
  const n = xs[0]!.length;
  const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const wi = w[i]!;
    if (wi === 0) continue;
    const x = xs[i]!;
    const wy = wi * ys[i]!;
    for (let j = 0; j < n; j++) {
      b[j]! += x[j]! * wy;
      const xj = x[j]! * wi;
      for (let k = 0; k <= j; k++) a[j]![k]! += xj * x[k]!;
    }
  }
  for (let j = 0; j < n; j++) for (let k = 0; k < j; k++) a[k]![j] = a[j]![k]!;
  return { a, b };
}

function solve(a: number[][], b: number[], penalty: number[]): number[] {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) m[i]![i]! += penalty[i]!;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) continue;
    const t = m[col]!; m[col] = m[pivot]!; m[pivot] = t;
    const d = m[col]![col]!;
    for (let k = col; k <= n; k++) m[col]![k]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      const src = m[col]!;
      const dst = m[r]!;
      for (let k = col; k <= n; k++) dst[k]! -= f * src[k]!;
    }
  }
  return m.map((row) => row[n]!);
}

function ridgeLS(xs: number[][], ys: number[], w: number[], penalty: number[]): number[] {
  const { a, b } = normalEquations(xs, ys, w);
  return solve(a, b, penalty);
}

function ltsFit(xs: number[][], ys: number[], penalty: number[]): { coef: number[]; kept: number } {
  const n = xs.length;
  const keep = Math.max(1, Math.round(n * (1 - TRIM_SHARE)));
  const w = new Array<number>(n).fill(1);
  let coef = ridgeLS(xs, ys, w, penalty);
  let prev: number[] | null = null;
  for (let it = 0; it < LTS_MAX_ITERATIONS; it++) {
    const resid = ys.map((y, i) => Math.abs(y - dot(xs[i]!, coef)));
    const order = resid.map((_, i) => i).sort((i, j) => resid[i]! - resid[j]! || i - j);
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < keep; i++) next[order[i]!] = 1;
    coef = ridgeLS(xs, ys, next, penalty);
    if (prev !== null && next.every((v, i) => v === prev![i])) break;
    prev = next;
  }
  return { coef, kept: keep };
}

interface ValueFit { coef: number[]; terms: ValueTerms }

function centerEffects(coef: number[], xs: number[][], terms: ValueTerms): void {
  let at = 1;
  if (terms.includes('size')) at++;
  if (terms.includes('growth')) at++;
  if (terms.includes('control')) at++;
  if (terms.includes('age')) at++;
  if (terms.includes('chains')) at++;
  const groups: number[][] = [];
  if (terms.includes('family')) { groups.push(Array.from({ length: BUCKETS.length }, (_, i) => at + i)); at += BUCKETS.length; }
  if (terms.includes('macro')) groups.push(Array.from({ length: MACROS.length }, (_, i) => at + i));
  for (const idx of groups) {
    const counts = idx.map((j) => xs.reduce((s, row) => s + row[j]!, 0));
    const total = counts.reduce((s, v) => s + v, 0);
    const mean = idx.reduce((s, j, k) => s + coef[j]! * counts[k]!, 0) / Math.max(1, total);
    idx.forEach((j) => { coef[j]! -= mean; });
    coef[0]! += mean;
  }
}

function fitValue(rows: TrainRow[], terms: ValueTerms): ValueFit {
  const xs = designValue(rows, terms);
  const ys = rows.map((r) => Math.log(r.mcap / Math.max(1, r.tvl)));
  const penalty = penaltiesFor(terms);
  const { coef } = ltsFit(xs, ys, penalty);
  centerEffects(coef, xs, terms);
  return { coef, terms };
}

function predictValue(fit: ValueFit, r: TrainRow): number {
  const x = designValue([r], fit.terms)[0]!;
  return r.tvl * Math.exp(dot(x, fit.coef));
}

function metric(preds: number[], actual: number[]): { med: number; within3: number } {
  const e = preds.map((p, i) => Math.abs(Math.log(Math.max(1e-9, p) / Math.max(1e-9, actual[i]!))));
  return { med: Math.exp(median(e)), within3: e.filter((v) => v <= Math.log(3)).length / e.length };
}

function looValue(rows: TrainRow[], terms: ValueTerms): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const fit = fitValue(rows.filter((_, j) => j !== i), terms);
    out.push(predictValue(fit, rows[i]!));
  }
  return out;
}

function walkValue(rows: TrainRow[], terms: ValueTerms, minTrain = 30): { preds: number[]; actual: number[] } {
  const order = rows.slice().sort((a, b) => (a.listed ?? '9999') < (b.listed ?? '9999') ? -1 : (a.listed ?? '9999') > (b.listed ?? '9999') ? 1 : a.slug < b.slug ? -1 : 1);
  const preds: number[] = [];
  const actual: number[] = [];
  for (let i = minTrain; i < order.length; i++) {
    const fit = fitValue(order.slice(0, i), terms);
    preds.push(predictValue(fit, order[i]!));
    actual.push(order[i]!.mcap);
  }
  return { preds, actual };
}
type OddsTerms = string[];

function designOdds(rows: TrainRow[], terms: OddsTerms): number[][] {
  return rows.map((r) => {
    const x: number[] = [1];
    if (terms.includes('age')) x.push((r.age === null ? 677 : r.age) / 365);
    if (terms.includes('size')) x.push(Math.log(Math.max(1, r.tvl) / REF_TVL_USD));
    if (terms.includes('growth')) x.push(r.g);
    if (terms.includes('chains')) x.push(Math.log(1 + r.chains));
    if (terms.includes('control')) x.push(r.g_other ?? 0);
    if (terms.includes('family')) for (const b of BUCKETS) x.push(r.bucket === b ? 1 : 0);
    if (terms.includes('macro')) for (const b of MACROS) x.push(r.macro === b ? 1 : 0);
    return x;
  });
}

function sigmoid(z: number): number {
  const c = Math.max(-35, Math.min(35, z));
  return 1 / (1 + Math.exp(-c));
}

function fitLogit(xs: number[][], ys: number[]): number[] {
  const n = xs.length;
  const p = xs[0]!.length;
  const beta = new Array<number>(p).fill(0);
  let token = 0;
  for (const y of ys) token += y;
  const rate = Math.max(1e-4, Math.min(1 - 1e-4, token / Math.max(1, n)));
  beta[0] = Math.log(rate / (1 - rate));
  for (let it = 0; it < 80; it++) {
    const a: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const b = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const eta = dot(x, beta);
      const mu = sigmoid(eta);
      const w = Math.max(mu * (1 - mu), 1e-6);
      const z = eta + (ys[i]! - mu) / w;
      const wz = w * z;
      for (let j = 0; j < p; j++) {
        b[j]! += x[j]! * wz;
        const xj = x[j]! * w;
        for (let k = 0; k <= j; k++) a[j]![k]! += xj * x[k]!;
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) a[k]![j] = a[j]![k]!;
    const next = solve(a, b, new Array<number>(p).fill(0));
    let diff = 0;
    for (let j = 0; j < p; j++) diff = Math.max(diff, Math.abs(next[j]! - beta[j]!));
    for (let j = 0; j < p; j++) beta[j] = next[j]!;
    if (diff < 1e-8) break;
  }
  return beta;
}

interface OddsFit { beta: number[]; terms: OddsTerms }

function fitOdds(rows: TrainRow[], terms: OddsTerms): OddsFit {
  const beta = fitLogit(designOdds(rows, terms), rows.map((r) => (r.token ? 1 : 0)));
  // The eleven family dummies and the intercept are collinear; centre the effects so the printed
  // intercept is the average family's logit and the family numbers are effects against it.
  if (terms.includes('family')) {
    const at = 1 + (terms.includes('age') ? 1 : 0) + (terms.includes('size') ? 1 : 0) + (terms.includes('growth') ? 1 : 0) + (terms.includes('chains') ? 1 : 0) + (terms.includes('control') ? 1 : 0);
    const counts = BUCKETS.map((b) => rows.filter((r) => r.bucket === b).length);
    const total = counts.reduce((s, v) => s + v, 0);
    let mean = 0;
    BUCKETS.forEach((_, i) => { mean += (beta[at + i] ?? 0) * counts[i]!; });
    mean /= Math.max(1, total);
    BUCKETS.forEach((_, i) => { beta[at + i] = (beta[at + i] ?? 0) - mean; });
    beta[0]! += mean;
  }
  return { beta, terms };
}

function predictOdds(fit: OddsFit, r: TrainRow): number {
  const x = designOdds([r], fit.terms)[0]!;
  return sigmoid(dot(x, fit.beta));
}

function brier(preds: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < preds.length; i++) s += (preds[i]! - ys[i]!) ** 2;
  return preds.length === 0 ? 0 : s / preds.length;
}

function accuracy(preds: number[], ys: number[]): number {
  let s = 0;
  for (let i = 0; i < preds.length; i++) if ((preds[i]! >= 0.5) === (ys[i]! >= 0.5)) s++;
  return preds.length === 0 ? 0 : s / preds.length;
}

function looOdds(rows: TrainRow[], terms: OddsTerms): { preds: number[]; ys: number[]; base: number[] } {
  const preds: number[] = [];
  const ys: number[] = [];
  const base: number[] = [];
  const totalToken = rows.filter((r) => r.token).length;
  for (let i = 0; i < rows.length; i++) {
    const tr = rows.filter((_, j) => j !== i);
    const fit = fitOdds(tr, terms);
    preds.push(predictOdds(fit, rows[i]!));
    ys.push(rows[i]!.token ? 1 : 0);
    base.push((totalToken - (rows[i]!.token ? 1 : 0)) / tr.length);
  }
  return { preds, ys, base };
}

function walkOdds(rows: TrainRow[], terms: OddsTerms, k = 5): { preds: number[]; ys: number[]; base: number[] } {
  const order = rows.slice().sort((a, b) => (a.listed ?? '9999') < (b.listed ?? '9999') ? -1 : (a.listed ?? '9999') > (b.listed ?? '9999') ? 1 : a.slug < b.slug ? -1 : 1);
  const n = order.length;
  const preds: number[] = [];
  const ys: number[] = [];
  const base: number[] = [];
  for (let j = 1; j < k; j++) {
    const lo = Math.round((j * n) / k);
    const hi = Math.round(((j + 1) * n) / k);
    const tr = order.slice(0, lo);
    const te = order.slice(lo, hi);
    if (tr.length < 10 || te.length === 0) continue;
    const fit = fitOdds(tr, terms);
    const rate = tr.filter((r) => r.token).length / tr.length;
    for (const r of te) {
      preds.push(predictOdds(fit, r));
      ys.push(r.token ? 1 : 0);
      base.push(rate);
    }
  }
  return { preds, ys, base };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed digest order, so the control's growth carries no row-specific information. */
function digestOrder(rows: TrainRow[]): TrainRow[] {
  const key = (s: string): string => createHash('sha1').update(s).digest('hex');
  return rows.slice().sort((a, b) => key(a.slug) < key(b.slug) ? -1 : key(a.slug) > key(b.slug) ? 1 : 0);
}
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isOwnProduct(p: SnapshotProtocol): boolean {
  if (EXCHANGE_NAME.test(p.name)) return false;
  if (RECEIPT_WORD.test(p.name)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  return !PRODUCT_CATEGORY.has(p.category ?? '');
}

export function boardUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  const w = new Set(snapshot.watchlist);
  return snapshot.protocols.filter((p) => recordsNoToken(p) && (w.has(p.slug) || isOwnProduct(p)));
}

/** FNV-1a 32-bit over bytes, as eight lowercase hex digits. */
export function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Fit both models and compute every held-out number the page prints. */
export function fitModel(snapshot: Snapshot): FitModel {
  const V = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.listed_at !== null && p.tvl_usd > 0)
    .map((p) => trainRow(p, snapshot.as_of));
  const O = snapshot.protocols
    .filter((p) => p.listed_at !== null)
    .map((p) => trainRow(p, snapshot.as_of));
  if (V.length < 40) throw new SnapshotError(`only ${V.length} priced traded tokens: too few to fit`);

  for (const set of [V, O]) {
    const ordered = digestOrder(set);
    for (let i = 0; i < ordered.length; i++) ordered[i]!.g_other = ordered[(i + 1) % ordered.length]!.g;
  }

  const valueFit = fitValue(V, ['size', 'family']);
  const oddsFit = fitOdds(O, ['age', 'family', 'size', 'growth']);
  const H = Math.max(...O.map((r) => r.age ?? 0)) / 365;
  const fallback = median(O.map((r) => r.age ?? 0));

  // Value terms, added in order. A term survives only when it lowers the miss in both tests against
  // the last kept model; the rest are shown with their measured numbers, never used.
  const valueTerms: ValueTerm[] = [];
  const valueConfigs: { term: string; terms: ValueTerms }[] = [
    { term: 'flat median multiple', terms: [] },
    { term: '+ size curve, ln TVL', terms: ['size'] },
    { term: '+ family effect · ridge 16', terms: ['size', 'macro'] },
    { term: '+ category effect · ridge 16', terms: ['size', 'family'] },
    { term: '+ 7-day TVL growth', terms: ['size', 'family', 'growth'] },
    { term: '+ age, years listed', terms: ['size', 'family', 'age'] },
    { term: '+ chain count, ln', terms: ['size', 'family', 'chains'] },
    { term: '+ control: growth of another row', terms: ['size', 'family', 'control'] },
  ];
  for (const cfg of valueConfigs) {
    const loo = metric(looValue(V, cfg.terms), V.map((r) => r.mcap));
    const w = walkValue(V, cfg.terms);
    const wf = metric(w.preds, w.actual);
    valueTerms.push({ term: cfg.term, loo: round(loo.med, 3), wf: round(wf.med, 3), status: '' });
  }
  let valueKept = 0;
  let keptValue = valueTerms[0]!;
  valueTerms.forEach((t, i) => {
    if (i === 0) { t.status = 'baseline'; return; }
    if (t.loo < keptValue.loo && t.wf < keptValue.wf) {
      t.status = 'kept'; keptValue = t; valueKept++;
    } else if (i === valueTerms.length - 1) t.status = 'must not help';
    else t.status = 'tested, not kept';
  });

  const oddsTerms: OddsTerm[] = [];
  const oddsConfigs: { term: string; terms: OddsTerms }[] = [
    { term: 'base rate of peers', terms: [] },
    { term: '+ age, years listed', terms: ['age'] },
    { term: '+ family effect · ridge 16', terms: ['age', 'family'] },
    { term: '+ size curve, ln TVL', terms: ['age', 'family', 'size'] },
    { term: '+ 7-day TVL growth', terms: ['age', 'family', 'size', 'growth'] },
    { term: '+ chain count, ln', terms: ['age', 'family', 'size', 'growth', 'chains'] },
    { term: '+ control: growth of another row', terms: ['age', 'family', 'size', 'growth', 'control'] },
  ];
  for (const cfg of oddsConfigs) {
    const l = looOdds(O, cfg.terms);
    const w = walkOdds(O, cfg.terms);
    oddsTerms.push({
      term: cfg.term,
      loo: round(brier(l.preds, l.ys), 4),
      wf: round(brier(w.preds, w.ys), 4),
      base_loo: round(brier(l.base, l.ys), 4),
      base_wf: round(brier(w.base, w.ys), 4),
      hit_loo: round(accuracy(l.preds, l.ys), 4),
      hit_wf: round(accuracy(w.preds, w.ys), 4),
      base_hit_loo: round(accuracy(l.base, l.ys), 4),
      base_hit_wf: round(accuracy(w.base, w.ys), 4),
      status: '',
    });
  }
  let oddsKept = 0;
  let keptOdds = oddsTerms[0]!;
  oddsTerms.forEach((t, i) => {
    if (i === 0) { t.status = 'baseline'; return; }
    const material = keptOdds.loo - t.loo >= 0.001 || keptOdds.wf - t.wf >= 0.001;
    if (t.loo < keptOdds.loo && t.wf < keptOdds.wf && material) {
      t.status = 'kept'; keptOdds = t; oddsKept++;
    } else if (i === oddsTerms.length - 1) t.status = 'must not help';
    else t.status = 'tested, not kept';
  });

  const looPreds = looValue(V, ['size', 'family']);
  const looResid = V.map((r, i) => Math.log(r.mcap / looPreds[i]!));
  const w = walkValue(V, ['size', 'family']);
  const wfResid = w.actual.map((a, i) => Math.log(a / w.preds[i]!));
  const bands = {
    loo: { p25: Math.exp(quantile(looResid, 0.25)), p75: Math.exp(quantile(looResid, 0.75)), p10: Math.exp(quantile(looResid, 0.1)), p90: Math.exp(quantile(looResid, 0.9)) },
    wf: { p25: Math.exp(quantile(wfResid, 0.25)), p75: Math.exp(quantile(wfResid, 0.75)), p10: Math.exp(quantile(wfResid, 0.1)), p90: Math.exp(quantile(wfResid, 0.9)) },
  };
  const share = (resid: number[], lo: number, hi: number): number => resid.filter((e) => e >= lo && e <= hi).length / resid.length;
  const coverage: Coverage = {
    w3_loo: round(looResid.filter((e) => Math.abs(e) <= Math.log(3)).length / looResid.length, 3),
    w3_wf: round(wfResid.filter((e) => Math.abs(e) <= Math.log(3)).length / wfResid.length, 3),
    p25_loo: round(share(looResid, Math.log(bands.loo.p25), Math.log(bands.loo.p75)), 3),
    p25_wf: round(share(wfResid, Math.log(bands.wf.p25), Math.log(bands.wf.p75)), 3),
    p10_loo: round(share(looResid, Math.log(bands.loo.p10), Math.log(bands.loo.p90)), 3),
    p10_wf: round(share(wfResid, Math.log(bands.wf.p10), Math.log(bands.wf.p90)), 3),
  };
  const finalLoo = looOdds(O, ['age', 'family', 'size', 'growth']);
  const finalWf = walkOdds(O, ['age', 'family', 'size', 'growth']);
  const oddsFinal = {
    brier: brier(finalLoo.preds, finalLoo.ys),
    base_brier: brier(finalLoo.base, finalLoo.ys),
    brier_wf: brier(finalWf.preds, finalWf.ys),
    base_brier_wf: brier(finalWf.base, finalWf.ys),
    hit: accuracy(finalLoo.preds, finalLoo.ys),
    base_hit: accuracy(finalLoo.base, finalLoo.ys),
    hit_wf: accuracy(finalWf.preds, finalWf.ys),
    base_hit_wf: accuracy(finalWf.base, finalWf.ys),
  };

  const buckets = BUCKETS.map((name, i) => {
    const v = valueFit.coef[2 + i] ?? 0;
    const o = oddsFit.beta[4 + i] ?? 0;
    return { name, effect: round(v, 8), multiplier: round(Math.exp(v), 10), n: V.filter((r) => r.bucket === name).length, odds: round(o, 8) };
  });

  // Bootstrap: 200 refits of both models; rank ranges and standard errors.
  const board = boardUniverse(snapshot);
  const bootRank: number[][] = board.map(() => []);
  const bootBase: number[] = [];
  const bootSlope: number[] = [];
  const bootAge: number[] = [];
  const bootTvl: number[] = [];
  const bootGrowth: number[] = [];
  const rnd = mulberry32(BOOT_SEED);
  const pick = <T>(rows: T[]): T[] => {
    const out: T[] = [];
    for (let i = 0; i < rows.length; i++) out.push(rows[Math.floor(rnd() * rows.length)]!);
    return out;
  };
  for (let b = 0; b < BOOT_N; b++) {
    const vs = pick(V);
    const os = pick(O);
    const vf = fitValue(vs, ['size', 'family']);
    const of = fitOdds(os, ['age', 'family', 'size', 'growth']);
    const hb = Math.max(...os.map((r) => r.age ?? 0)) / 365;
    const scored = board.map((p, idx) => {
      const r = trainRow(p, snapshot.as_of);
      const ai = r.age === null ? fallback : r.age;
      const z = (a: number): number => of.beta[0]! + of.beta[1]! * a + of.beta[2]! * Math.log(Math.max(1, r.tvl) / REF_TVL_USD) + of.beta[3]! * r.g + (of.beta[4 + BUCKETS.indexOf(r.bucket as typeof BUCKETS[number])] ?? 0);
      const Fa = sigmoid(z(ai / 365));
      const Fh = sigmoid(z(hb));
      const q = Math.max(0.001, Math.min(0.999, (Fh - Fa) / Math.max(1e-9, 1 - Fa)));
      return { idx, imp: predictValue(vf, r) * q };
    });
    scored.sort((x, y) => y.imp - x.imp || board[y.idx]!.tvl_usd - board[x.idx]!.tvl_usd || (board[x.idx]!.slug < board[y.idx]!.slug ? -1 : 1));
    scored.forEach((s, rank) => bootRank[s.idx]!.push(rank + 1));
    bootBase.push(Math.exp(vf.coef[0]!));
    bootSlope.push(vf.coef[1]!);
    bootAge.push(of.beta[1]!);
    bootTvl.push(of.beta[2]!);
    bootGrowth.push(of.beta[3]!);
  }
  const sd = (v: number[]): number => {
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length - 1));
  };
  const ranges: Record<string, [number, number]> = {};
  board.forEach((p, i) => { ranges[p.slug] = [Math.round(quantile(bootRank[i]!, 0.1)), Math.round(quantile(bootRank[i]!, 0.9))]; });
  const bootstrap: Bootstrap = {
    n: BOOT_N,
    base_se: round(sd(bootBase), 4),
    slope_se: round(sd(bootSlope), 4),
    age_se: round(sd(bootAge), 4),
    tvl_se: round(sd(bootTvl), 4),
    growth_se: round(sd(bootGrowth), 4),
    cat_min: round(Math.min(...buckets.map((b) => b.multiplier)), 3),
    cat_max: round(Math.max(...buckets.map((b) => b.multiplier)), 3),
    fam_min: round(Math.min(...buckets.map((b) => b.odds)), 3),
    fam_max: round(Math.max(...buckets.map((b) => b.odds)), 3),
    ranges,
  };

  const withCap = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const zero = withCap.filter((p) => (p.mcap_usd ?? 0) <= 0).length;
  return {
    version: 'radar 3.0 · launch radar',
    ref_tvl_usd: REF_TVL_USD,
    growth_clip_pct: GROWTH_CLIP_PCT,
    age_fallback_days: Math.round(fallback),
    ridge_value: RIDGE_VALUE,
    ridge_odds: RIDGE_ODDS,
    trim_share: TRIM_SHARE,
    base_multiple: round(Math.exp(valueFit.coef[0]!), 12),
    size_slope: round(valueFit.coef[1]!, 12),
    buckets,
    odds: {
      b0: round(oddsFit.beta[0]!, 6),
      age: round(oddsFit.beta[1]!, 6),
      tvl: round(oddsFit.beta[2]!, 6),
      growth: round(oddsFit.beta[3]!, 6),
      H_years: round(H, 6),
      fallback_days: Math.round(fallback),
      n_peers: O.length,
      n_token: O.filter((r) => r.token).length,
      rate: round(O.filter((r) => r.token).length / O.length, 4),
    },
    bands: {
      loo: { p25: round(bands.loo.p25, 4), p75: round(bands.loo.p75, 4), p10: round(bands.loo.p10, 4), p90: round(bands.loo.p90, 4) },
      wf: { p25: round(bands.wf.p25, 4), p75: round(bands.wf.p75, 4), p10: round(bands.wf.p10, 4), p90: round(bands.wf.p90, 4) },
    },
    evidence: {
      value_terms: valueTerms,
      odds_terms: oddsTerms,
      coverage,
      value_kept: valueKept,
      value_tested: valueTerms.length - 2,
      odds_kept: oddsKept,
      odds_tested: oddsTerms.length - 2,
      wf_miss: round(Math.exp(median(wfResid.map((e) => Math.abs(e)))), 2),
      loo_miss: round(Math.exp(median(looResid.map((e) => Math.abs(e)))), 2),
      flat_wf: valueTerms[0]!.wf,
      flat_loo: valueTerms[0]!.loo,
      brier: round(oddsFinal.brier, 3),
      base_brier: round(oddsFinal.base_brier, 3),
      brier_wf: round(oddsFinal.brier_wf, 3),
      base_brier_wf: round(oddsFinal.base_brier_wf, 3),
      hit: Math.round(oddsFinal.hit * 100),
      base_hit: Math.round(oddsFinal.base_hit * 100),
      hit_wf: Math.round(oddsFinal.hit_wf * 100),
      base_hit_wf: Math.round(oddsFinal.base_hit_wf * 100),
      n_pred_wf: w.preds.length,
      n_pred_loo: V.length,
    },
    bootstrap,
    training: {
      n_value: V.length,
      n_peers: O.length,
      n_token_peers: O.filter((r) => r.token).length,
      n_with_cap: withCap.length,
      n_zero: zero,
      n_no_cap: snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length,
      trimmed: Math.round(V.length * TRIM_SHARE),
      median_age_days: Math.round(fallback),
    },
  };
}
/** One protocol's value under the fitted model, and the odds it completes its peer cohort. */
export function scoreProtocol(p: SnapshotProtocol, fit: FitModel, asOf: string): { value_if: number; odds: number; implied: number; age_days: number | null; age_imputed: boolean; base: number; size: number; category: number; growth_pct: number } {
  const r = trainRow(p, asOf);
  const base = fit.base_multiple;
  const size = Math.pow(Math.max(1, r.tvl) / fit.ref_tvl_usd, fit.size_slope);
  const effect = fit.buckets.find((b) => b.name === r.bucket)?.multiplier ?? 1;
  const value = r.tvl * base * size * effect;
  const ai = r.age === null ? fit.age_fallback_days : r.age;
  const z = (a: number): number => fit.odds.b0 + fit.odds.age * a + fit.odds.tvl * Math.log(Math.max(1, r.tvl) / REF_TVL_USD) + fit.odds.growth * r.g + (fit.buckets.find((b) => b.name === r.bucket)?.odds ?? 0);
  const Fa = sigmoid(z(ai / 365));
  const Fh = sigmoid(z(fit.odds.H_years));
  const q = Math.max(0.001, Math.min(0.999, (Fh - Fa) / Math.max(1e-9, 1 - Fa)));
  const valueIf = Math.round(value);
  return { value_if: valueIf, odds: q, implied: Math.round(valueIf * q), age_days: r.age, age_imputed: r.age === null, base, size, category: effect, growth_pct: r.g * 100 };
}

function emptyFarm(): FarmFields {
  return {
    farm_deposit_usd: 0, farm_drop_share: 0.07, farm_horizon_weeks: 12, farm_drop_usd: 0, farm_fees_usd: 0,
    farm_net_usd: 0, farm_hours: 0, farm_net_per_hour_usd: 0, farm_tbill_usd: 0, farm_verdict: 'SKIP',
    farm_fee_break_even_pct: 0, farm_odds_break_even_pct: 0, farm_exit_tvl_usd: 0, farm_sensitivity: [],
    farm_tx_count: 0, farm_gas_usd: 0, farm_protocol_fee_usd: 0,
  };
}

export function buildBoard(snapshot: Snapshot, fit: FitModel): BoardRow[] {
  const w = new Set(snapshot.watchlist);
  const scored = boardUniverse(snapshot).map((p) => ({ p, s: scoreProtocol(p, fit, snapshot.as_of) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((x, i) => {
    const range = fit.bootstrap.ranges[x.p.slug] ?? [i + 1, i + 1];
    return {
      rank: i + 1,
      slug: x.p.slug, name: x.p.name, category: x.p.category, bucket: bucketOf(x.p.category), chains: x.p.chains,
      tvl_usd: x.p.tvl_usd, change_7d: x.p.change_7d, mcap_usd: x.p.mcap_usd, listed_at: x.p.listed_at,
      age_days: x.s.age_days, age_imputed: x.s.age_imputed, watchlist: w.has(x.p.slug),
      value_if_launches_usd: x.s.value_if, token_odds: round(x.s.odds, 6), implied_value_usd: x.s.implied,
      p25_usd: Math.round(x.s.implied * fit.bands.wf.p25), p75_usd: Math.round(x.s.implied * fit.bands.wf.p75),
      p10_usd: Math.round(x.s.implied * fit.bands.wf.p10), p90_usd: Math.round(x.s.implied * fit.bands.wf.p90),
      rank_lo: range[0], rank_hi: range[1],
      model: { base_multiple: round(x.s.base, 8), size_multiple: round(x.s.size, 6), category_multiple: round(x.s.category, 6), growth_pct: round(x.s.growth_pct, 2) },
      farm_steps: [],
      ...emptyFarm(),
    };
  });
}

function outGroup(p: SnapshotProtocol): 'exchange' | 'bridge' | 'staking' | 'versioned' {
  const c = p.category ?? '';
  if (c === 'CEX' || EXCHANGE_NAME.test(p.name)) return 'exchange';
  if (RECEIPT_WORD.test(p.name) || VERSIONED_NAME.test(p.name)) return 'versioned';
  if (c === 'Bridge' || c === 'Canonical Bridge' || c === 'Cross Chain Bridge') return 'bridge';
  return 'staking';
}

export function buildRadar(snapshot: Snapshot, fit: FitModel, board: BoardRow[], hash8: string): RadarData {
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank, slug: r.slug, name: r.name, category: r.category, bucket: r.bucket, chains: r.chains,
    tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, imputed: r.age_imputed ? 1 : 0,
    watch: r.watchlist ? 1 : 0, below: r.tvl_usd < snapshot.floor_usd ? 1 : 0,
    implied: r.implied_value_usd, value_if: r.value_if_launches_usd, odds: r.token_odds,
    p25: r.p25_usd, p75: r.p75_usd, p10: r.p10_usd, p90: r.p90_usd, rank_lo: r.rank_lo, rank_hi: r.rank_hi,
    farm: {
      farm_deposit_usd: r.farm_deposit_usd, farm_drop_share: r.farm_drop_share, farm_horizon_weeks: r.farm_horizon_weeks,
      farm_drop_usd: r.farm_drop_usd, farm_fees_usd: r.farm_fees_usd, farm_net_usd: r.farm_net_usd, farm_hours: r.farm_hours,
      farm_net_per_hour_usd: r.farm_net_per_hour_usd, farm_tbill_usd: r.farm_tbill_usd, farm_verdict: r.farm_verdict,
      farm_fee_break_even_pct: r.farm_fee_break_even_pct, farm_odds_break_even_pct: r.farm_odds_break_even_pct,
      farm_exit_tvl_usd: r.farm_exit_tvl_usd, farm_sensitivity: r.farm_sensitivity, farm_tx_count: r.farm_tx_count,
      farm_gas_usd: r.farm_gas_usd, farm_protocol_fee_usd: r.farm_protocol_fee_usd,
    },
    plan: r.farm_steps,
  }));
  const out = snapshot.protocols.filter((p) => recordsNoToken(p) && !isOwnProduct(p));
  const count = (group: string): number => out.filter((p) => outGroup(p) === group).length;
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const audit: Audit = {
    total: snapshot.protocols.length,
    ranked: board.length,
    watchlist: snapshot.watchlist.length,
    above_floor_others: board.filter((r) => !r.watchlist && r.tvl_usd >= snapshot.floor_usd).length,
    below_floor: board.filter((r) => !r.watchlist && r.tvl_usd < snapshot.floor_usd).length,
    excluded: out.length,
    token_no_cap: snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length,
    live: live.length,
    live_priced: live.filter((p) => (p.mcap_usd ?? 0) > 0).length,
    zero_cap: live.filter((p) => (p.mcap_usd ?? 0) <= 0).length,
    out_bridge: count('bridge'),
    out_exchange: count('exchange'),
    out_staking: count('staking'),
    out_versioned: count('versioned'),
  };
  const peers: PeerRow[] = snapshot.protocols
    .filter((p) => (p.mcap_usd ?? 0) > 0)
    .map((p) => {
      const r = trainRow(p, snapshot.as_of);
      const effect = fit.buckets.find((b) => b.name === r.bucket)?.multiplier ?? 1;
      const value = r.tvl * fit.base_multiple * Math.pow(Math.max(1, r.tvl) / fit.ref_tvl_usd, fit.size_slope) * effect;
      return { name: p.name, symbol: p.symbol, category: p.category, bucket: r.bucket, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, value_usd: Math.round(value) };
    })
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.name < b.name ? -1 : 1));
  const totalTvl = board.reduce((s, r) => s + r.tvl_usd, 0);
  const totalImplied = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const farm = board.filter((r) => r.farm_verdict === 'FARM');
  return {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length, board_size: board.length, audit,
    total_tvl: totalTvl, total_implied: totalImplied,
    farm_tvl: farm.reduce((s, r) => s + r.tvl_usd, 0), farm_implied: farm.reduce((s, r) => s + r.implied_value_usd, 0),
    hash8, model: fit, rows, peers, source_bytes: 0, source_files: 0,
  };
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const outside = board.filter((r) => !r.watchlist).length;
  if (outside < 60) return `only ${outside} rows come from outside the watchlist: the gate wants at least 60`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows carry the same implied value`;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the gate's cap`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) if (step.length < 20 || step.length > 600) return `${r.slug} has a farm step of ${step.length} characters`;
  }
  return null;
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
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
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || !isFiniteNumber(p.tvl_usd)) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: isFiniteNumber(p.change_7d) ? p.change_7d : null,
      mcap_usd: isFiniteNumber(p.mcap_usd) ? p.mcap_usd : null, listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null, symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
