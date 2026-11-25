// The token radar's board layer: the snapshot parser, the product rules, the ranked board, the live
// set and data.js. The value model itself lives in dashboard/a-model.js and is re-exported here, so
// main.ts and the page run the same fit and the same score function; this file never duplicates them.
//
// The board's universe is the watchlist plus the protocols below the watchlist floor that pass the
// watchlist's own product rules (no wrapped, staked or bridged product, no versioned pool, no exchange).
// The watchlist is a floor, never a ceiling; the extension is where the radar finds its early rows.

export * from '../dashboard/a-model.js';
import { ageInDays, bucketOf, recordsNoToken, round, scoreProtocol } from '../dashboard/a-model.js';

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

/** The audit's numbers: every snapshot protocol accounted for once, by why it is or is not ranked. */
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
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One live comparable: a protocol whose record carries a market cap of $5M or more and a TVL. */
export interface Comparable {
  slug: string;
  name: string;
  bucket: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  g: number;
  age_days: number | null;
  a: number;
}

/** The fitted model: the comparable set and the scales the distance uses, all read from the snapshot. */
export interface FitModel {
  version: string;
  floor_usd: number;
  k: number;
  weights: { category: number; growth: number; age: number; growth_clip_pct: number };
  scales: { log_tvl_sd: number; log_age_sd: number; age_fallback_days: number };
  comparables: Comparable[];
  training: {
    n: number;
    priced: number;
    dormant: number;
    zero_cap: number;
    median_age_days: number;
    median_multiple: number;
    iqr_low: number;
    iqr_high: number;
  };
  buckets: BucketRow[];
  validation: ValidationSummary;
  facts: string;
}

/** One category bucket's comparable count, median multiple and interquartile range. */
export interface BucketRow {
  name: string;
  n: number;
  median_multiple: number;
  iqr_low: number;
  iqr_high: number;
}

/** Out-of-sample numbers: repeated k-fold cross-validation over the comparable set. */
export interface ValidationSummary {
  folds: number;
  repeats: number;
  n: number;
  median_factor: number;
  within_2x: number;
  within_3x: number;
  spearman: number;
  band50_low: number;
  band50_high: number;
  band80_low: number;
  band80_high: number;
  coverage50: number;
  coverage80: number;
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
    multiple: number;
    growth_pct: number;
    neighbours: number;
    iqr_low: number;
    iqr_high: number;
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
  below: 0 | 1;
  implied: number;
  plan: string[];
  budget?: string;
  tag?: string;
  band?: string;
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
  audit: Audit;
  model: FitModel;
  rows: RadarRow[];
  live: LiveRow[];
}

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

/** Whether a name and category pass the watchlist's product rules (a launch of its own, not a receipt). */
export function isOwnProduct(p: SnapshotProtocol): boolean {
  if (EXCHANGE_NAME.test(p.name)) return false;
  if (RECEIPT_WORD.test(p.name)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  return !PRODUCT_CATEGORY.has(p.category ?? '');
}

/** The fitted value of a token-bearing protocol, used by the live-token tab to check the model. */
export function fittedValueOf(p: SnapshotProtocol, asOf: string, fit: FitModel): number {
  return scoreProtocol({ ...p, mcap_usd: null, gecko_id: null, symbol: null }, asOf, fit).implied;
}

/** The protocols the board ranks: the watchlist, and below the floor every protocol the same rule finds. */
export function boardUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  const onWatchlist = new Set(snapshot.watchlist);
  return snapshot.protocols.filter((p) => recordsNoToken(p) && (onWatchlist.has(p.slug) || isOwnProduct(p)));
}

/** The live-token set: every protocol whose record carries a market cap, zero included. */
export function liveUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null);
}

/** Slugs in a fixed order, for ties: the board's last tie-break, never the locale's. */
function bySlug(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The board: one row per protocol in the universe, ranked by implied value, strongest first. */
export function buildBoard(snapshot: Snapshot, fit: FitModel): BoardRow[] {
  const onWatchlist = new Set(snapshot.watchlist);
  const scored = boardUniverse(snapshot).map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, fit) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || b.p.tvl_usd - a.p.tvl_usd || bySlug(a.p.slug, b.p.slug));
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
      multiple: s.score.multiple,
      growth_pct: round(s.score.growth_pct, 2),
      neighbours: s.score.neighbours.length,
      iqr_low: round(s.score.iqr[0], 4),
      iqr_high: round(s.score.iqr[1], 4),
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
    below: r.tvl_usd < snapshot.floor_usd ? 1 : 0,
    implied: r.implied_value_usd,
    plan: r.farm_steps,
  }));
  const noToken = snapshot.protocols.filter(recordsNoToken);
  const audit: Audit = {
    total: snapshot.protocols.length,
    ranked: board.length,
    watchlist: snapshot.watchlist.length,
    above_floor_others: board.filter((r) => !r.watchlist && r.tvl_usd >= snapshot.floor_usd).length,
    below_floor: board.filter((r) => !r.watchlist && r.tvl_usd < snapshot.floor_usd).length,
    excluded: noToken.filter((p) => !isOwnProduct(p)).length,
    token_no_cap: snapshot.protocols.filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null)).length,
    live: live.length,
    live_priced: live.filter((r) => r.mcap_usd > 0).length,
  };
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    below_floor_size: audit.below_floor,
    live_size: live.length,
    audit,
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
