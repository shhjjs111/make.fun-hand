// Prints the measured evidence tables for one snapshot, so the numbers in the docs and the page can be
// checked against a fresh fit without opening the dashboard.
//
//   node tools/evidence.ts [--snapshot <snapshot.json>] [--out <dir>]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard, buildRadar, fitModel, fnv1a, parseSnapshot } from '../lib/model.ts';
import { farmPlan, farmVerdict } from '../lib/farm.ts';

const at = process.argv.indexOf('--snapshot');
const outAt = process.argv.indexOf('--out');
const file = at >= 0 && at + 1 < process.argv.length
  ? process.argv[at + 1]!
  : 'D:/make.fun/_kits/token-radar-01/token-radar-01-kit/input/snapshot.json';
const out = outAt >= 0 && outAt + 1 < process.argv.length ? process.argv[outAt + 1]! : 'out';
const snapshot = parseSnapshot(readFileSync(file, 'utf8'));
const fit = fitModel(snapshot);
const board = buildBoard(snapshot, fit);
for (const row of board) {
  const input = {
    name: row.name, category: row.category, bucket: row.bucket, chains: row.chains, tvl_usd: row.tvl_usd,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd, value_if_launches_usd: row.value_if_launches_usd, as_of: snapshot.as_of,
  };
  row.farm_steps = farmPlan(input);
  Object.assign(row, farmVerdict(input));
}
const hash = fnv1a(Buffer.from(`${JSON.stringify({ rows: board }, null, 0)}\n`));
buildRadar(snapshot, fit, board, hash);
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const num = (v: number, d = 3): string => v.toFixed(d);

console.log(`snapshot ${snapshot.as_of} · ${snapshot.protocols.length} protocols · ${board.length} ranked`);
console.log(`\nVALUE (${fit.training.n_value} traded tokens) — median absolute miss, ×`);
for (const t of fit.evidence.value_terms) console.log(`  ${pad(t.term, 36)} ${pad('×' + num(t.loo), 10)} ${pad('×' + num(t.wf), 10)} ${t.status}`);
console.log(`  kept ${fit.evidence.value_kept} of ${fit.evidence.value_tested}`);
console.log(`\nODDS (${fit.training.n_peers} peers, ${fit.training.n_token_peers} with a token) — Brier (called right)`);
for (const t of fit.evidence.odds_terms) {
  console.log(`  ${pad(t.term, 36)} ${pad(num(t.loo, 4) + ' (' + Math.round(t.hit_loo * 100) + '%)', 16)} ${pad(num(t.wf, 4) + ' (' + Math.round(t.hit_wf * 100) + '%)', 16)} ${t.status}`);
}
console.log(`  kept ${fit.evidence.odds_kept} of ${fit.evidence.odds_tested}`);
console.log(`\nCOVERAGE  within ×3 ${(fit.evidence.coverage.w3_loo * 100).toFixed(1)}% / ${(fit.evidence.coverage.w3_wf * 100).toFixed(1)}%  P25–P75 ${(fit.evidence.coverage.p25_loo * 100).toFixed(1)}% / ${(fit.evidence.coverage.p25_wf * 100).toFixed(1)}%  P10–P90 ${(fit.evidence.coverage.p10_loo * 100).toFixed(1)}% / ${(fit.evidence.coverage.p10_wf * 100).toFixed(1)}%`);
console.log(`\nFINAL  miss LOO ×${fit.evidence.loo_miss} WF ×${fit.evidence.wf_miss}; flat ×${fit.evidence.flat_loo} / ×${fit.evidence.flat_wf}; Brier ${fit.evidence.brier} / ${fit.evidence.brier_wf} vs base ${fit.evidence.base_brier} / ${fit.evidence.base_brier_wf}`);
console.log(`COEF   base ×${fit.base_multiple.toFixed(6)} slope ${fit.size_slope.toFixed(6)}; odds b0 ${fit.odds.b0.toFixed(6)} age ${fit.odds.age.toFixed(6)} tvl ${fit.odds.tvl.toFixed(6)} growth ${fit.odds.growth.toFixed(6)}; bootstrap n=${fit.bootstrap.n} slope s.e. ${fit.bootstrap.slope_se}`);
const counts: Record<string, number> = {};
for (const row of board) counts[row.farm_verdict] = (counts[row.farm_verdict] ?? 0) + 1;
const farms = board.filter((r) => r.farm_verdict === 'FARM').sort((a, b) => b.farm_net_per_hour_usd - a.farm_net_per_hour_usd);
console.log(`\nFARM   ${counts.FARM ?? 0} FARM / ${counts.MARGINAL ?? 0} MARGINAL / ${counts.SKIP ?? 0} SKIP; $${(farms.reduce((s, r) => s + r.tvl_usd, 0) / 1e9).toFixed(2)}B TVL, $${(farms.reduce((s, r) => s + r.implied_value_usd, 0) / 1e6).toFixed(0)}M implied`);
console.log(`TOP    ${farms.slice(0, 10).map((r) => `${r.name} $${r.farm_net_per_hour_usd.toFixed(1)}/h`).join(' · ')}`);
console.log(`OUT    ${join(out, 'board.json')} fnv1a ${hash}`);
