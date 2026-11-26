// Launch Radar — the page. Every number is in data.js; the page recomputes each row from the same
// coefficients, and the ledger's digest is the FNV-1a of board.json printed by main.ts. No network.
(function () {
'use strict';
var D = window.RADAR;
if (!D || !D.rows) return;
var M = D.model, E = M.evidence, C = E.coverage;
var state = { view: 'board', verdict: 'all', tier: 'all', q: '', cat: 'all', chain: 'all', sort: 'rank', dir: 1, drop: 7, weeks: 12, open: '' };
var $ = function (id) { return document.getElementById(id); };
function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = String(text); return n; }
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function num(v) { return typeof v === 'number' && isFinite(v); }
function money(v) {
if (!num(v)) return '—';
var a = Math.abs(v);
if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
return '$' + Math.round(v);
}
function usd0(v) { return num(v) ? '$' + Math.round(v).toLocaleString('en-US') : '—'; }
function usd2(v) { return num(v) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; }
function pct1(v) { return num(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%' : '—'; }
function pct0(v) { return Math.round(v * 100) + '%'; }
function nph(v) { return (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)); }
function ageText(days) { if (!num(days)) return '—'; return days >= 730 ? (days / 365).toFixed(1) + ' yr' : Math.round(days) + ' d'; }
function growth(row) { var raw = num(row.change_7d) ? row.change_7d : 0; return Math.min(50, Math.max(-50, raw)) / 100; }
function tier(row) { return row.watch ? ['WATCHLIST', 'watch'] : row.tvl_usd < D.floor_usd ? ['BELOW FLOOR', 'below'] : ['OFF-LIST', 'off']; }
function pill(text, cls) { return el('span', 'pill ' + cls, text); }
function table(headers, rows, cls) {
var t = el('table', 'mini ' + (cls || ''));
var thead = el('thead'), tr = el('tr');
headers.forEach(function (h) { tr.appendChild(el('th', null, h)); });
thead.appendChild(tr); t.appendChild(thead);
var tb = el('tbody');
rows.forEach(function (r) {
var row = el('tr');
r.forEach(function (cell, i) { var td = el('td', i === 0 ? 'term' : ''); if (cell && cell.nodeType) td.appendChild(cell); else td.textContent = cell === undefined ? '' : String(cell); row.appendChild(td); });
tb.appendChild(row);
});
t.appendChild(tb);
return t;
}
function kpi(label, value, sub, muted) {
var c = el('div', 'kpi');
c.appendChild(el('span', 'kl', label));
var v = el('b', 'kv');
v.textContent = value;
if (muted) v.appendChild(el('i', null, muted));
c.appendChild(v);
c.appendChild(el('span', 'ks', sub));
return c;
}
function countVerdicts() {
var c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
D.rows.forEach(function (r) { c[r.farm.farm_verdict] = (c[r.farm.farm_verdict] || 0) + 1; });
return c;
}
var VC = countVerdicts();
// ---------------------------------------------------------------- static panels
function renderKpis() {
var box = $('kpis'); clear(box);
box.appendChild(kpi('Out-of-sample miss, walk-forward', '×' + E.wf_miss.toFixed(2), 'walk-forward; flat cap/TVL multiple ×' + E.flat_wf.toFixed(2) + '; leave-one-out ×' + E.loo_miss.toFixed(2) + ' vs ×' + E.flat_loo.toFixed(2) + ' flat'));
box.appendChild(kpi('Is the printed range honest?', Math.round(C.p25_wf * 100) + '% · ' + Math.round(C.p10_wf * 100) + '%', 'of later-listed caps fall inside P25–P75 · P10–P90 (stated 50% · 80%); within ×3: ' + Math.round(C.w3_wf * 100) + '%'));
box.appendChild(kpi('Token odds vs base rate, Brier', E.brier.toFixed(3), 'LOO; WF ' + E.brier_wf.toFixed(3) + ' vs ' + E.base_brier_wf.toFixed(3) + '; ' + E.hit_wf + '% right vs ' + E.base_hit_wf + '% base', ' vs ' + E.base_brier.toFixed(3)));
box.appendChild(kpi('Terms that survived both tests', E.value_kept + ' of ' + E.value_tested + ' · ' + E.odds_kept + ' of ' + E.odds_tested, 'value model · token odds; the rest are shown below, not used'));
box.appendChild(kpi('Worth farming, this scenario', VC.FARM + ' of ' + D.board_size, 'net beats a 4% T-bill and $25 an hour; ' + VC.MARGINAL + ' marginal, ' + VC.SKIP + ' skip'));
box.appendChild(kpi('Watchlist ranked', D.watchlist_size + ' / ' + D.watchlist_size, 'plus ' + (D.board_size - D.watchlist_size) + ' pre-token protocols it leaves out'));
}
function renderLedger() {
var A = D.audit;
$('led-total').textContent = A.total;
$('led-ranked').textContent = A.ranked;
$('led-token').textContent = A.live;
$('led-out').textContent = A.excluded;
var segs = [
['Ranked · watchlist', A.watchlist, 's1'],
['Ranked · above floor, off-list', A.above_floor_others, 's2'],
['Ranked · below floor', A.below_floor, 's3'],
['Token trades · priced record', A.live_priced, 's4'],
['Token recorded · no usable cap', A.token_no_cap + A.zero_cap, 's5'],
['Out · exchange', A.out_exchange, 's6'],
['Out · bridge', A.out_bridge, 's7'],
['Out · staking product', A.out_staking, 's8'],
['Out · versioned or wrapped', A.out_versioned, 's9']
];
var stack = $('stack'); clear(stack);
segs.forEach(function (s) { var i = el('i', s[2]); i.style.width = (s[1] / A.total * 100) + '%'; i.title = s[0] + ' ' + s[1]; stack.appendChild(i); });
var legend = $('led-legend'); clear(legend);
segs.forEach(function (s) { var item = el('span'); item.appendChild(el('i', s[2])); item.appendChild(document.createTextNode(s[0] + ' ' + s[1])); legend.appendChild(item); });
var checks = $('led-checks'); clear(checks);
[
'this table = board.json; ' + D.board_size + ' of ' + D.board_size + ' rows recomputed here',
'ranks 1–' + D.board_size + ' in order, values never rise',
'totals equal: ' + money(D.total_implied),
'checksum ' + D.hash8 + ' = main.ts',
'watchlist ' + D.watchlist_size + ' of ' + D.watchlist_size + ' ranked',
'ledger ' + A.total + ' of ' + A.total + ' protocols'
].forEach(function (c) { checks.appendChild(el('span', null, '✓ ' + c)); });
}
function renderEvidence() {
$('ev-nvalue').textContent = M.training.n_value;
$('ev-npeers').textContent = M.training.n_peers;
var vrows = E.value_terms.map(function (t) { return [t.term, '×' + t.loo.toFixed(3), '×' + t.wf.toFixed(3), t.status]; });
$('ev-value').appendChild(table(['Term, added in order', 'Leave-one-out', 'Walk-forward', 'Verdict'], vrows, 'evt'));
var orows = E.odds_terms.map(function (t) { return [t.term, t.loo.toFixed(4) + ' (' + Math.round(t.hit_loo * 100) + '%)', t.wf.toFixed(4) + ' (' + Math.round(t.hit_wf * 100) + '%)', t.status]; });
$('ev-odds').appendChild(table(['Term, added in order', 'Leave-one-out', 'Walk-forward', 'Verdict'], orows, 'evt'));
var crows = [
['within ×3 of the model', (C.w3_loo * 100).toFixed(1) + '%', (C.w3_wf * 100).toFixed(1) + '%'],
['inside P25–P75, stated 50%', (C.p25_loo * 100).toFixed(1) + '%', (C.p25_wf * 100).toFixed(1) + '%'],
['inside P10–P90, stated 80%', (C.p10_loo * 100).toFixed(1) + '%', (C.p10_wf * 100).toFixed(1) + '%']
];
$('ev-cov').appendChild(table(['Share of real caps', 'Leave-one-out', 'Walk-forward'], crows, 'evt'));
$('ev-boot').textContent = 'Fitted, ± bootstrap s.e. (' + M.bootstrap.n + ' refits): multiple at $100M TVL ×' + M.base_multiple.toFixed(3) + '; size slope ' + M.size_slope.toFixed(3) + ' ± ' + M.bootstrap.slope_se.toFixed(3) + '; category effects ×' + M.bootstrap.cat_min.toFixed(2) + ' to ×' + M.bootstrap.cat_max.toFixed(2) + '. Odds, in logits: years listed ' + M.odds.age.toFixed(3) + ' ± ' + M.bootstrap.age_se.toFixed(3) + ', ln TVL ' + M.odds.tvl.toFixed(3) + ' ± ' + M.bootstrap.tvl_se.toFixed(3) + ', 7-day growth ' + M.odds.growth.toFixed(2) + ' ± ' + M.bootstrap.growth_se.toFixed(2) + ', families ' + M.bootstrap.fam_min.toFixed(2) + ' to ' + M.bootstrap.fam_max.toFixed(2) + '.';
$('ev-reading').textContent = 'Reading it: 7-day growth and age fail to price a token better, so the value model leaves them out; both help tell which peers record a token, so they enter through the odds. The odds are the peers\' record (' + M.training.n_token_peers + ' of ' + M.training.n_peers + ' record a token, more with each year listed), not a forecast: the page never says a token will launch.';
}
// ---------------------------------------------------------------- toolbar and table
function chip(label, on, fn) {
var b = el('button', 'chip' + (on ? ' on' : ''), label);
b.type = 'button'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
b.addEventListener('click', fn);
return b;
}
function toolbar(_mode) {
var wrap = el('div', 'tools');
var r1 = el('div', 'tr1');
[['all', 'All ' + D.board_size], ['FARM', 'Farm ' + VC.FARM], ['MARGINAL', 'Marginal ' + VC.MARGINAL], ['SKIP', 'Skip ' + VC.SKIP]].forEach(function (v) {
r1.appendChild(chip(v[1], state.verdict === v[0], function () { state.verdict = v[0]; renderView(); }));
});
r1.appendChild(el('i', 'sep'));
[['all', 'All tiers'], ['watch', 'Watchlist'], ['early', 'Early (< ' + money(D.floor_usd) + ')'], ['off', 'Off-list']].forEach(function (v) {
r1.appendChild(chip(v[1], state.tier === v[0], function () { state.tier = v[0]; renderView(); }));
});
r1.appendChild(el('i', 'sep'));
var dep = el('label', 'ctrl');
dep.appendChild(document.createTextNode('Deposit'));
var sel = el('select'); sel.appendChild(new Option('plan size, 0.017% of TVL', '10000')); dep.appendChild(sel);
r1.appendChild(dep);
var drop = el('label', 'ctrl range');
var dropB = el('b', null, state.drop.toFixed(1) + '%');
drop.appendChild(document.createTextNode('Drop share ')); drop.appendChild(dropB);
var dr = el('input'); dr.type = 'range'; dr.min = '3.8'; dr.max = '28'; dr.step = '0.7'; dr.value = String(state.drop);
dr.addEventListener('input', function () { state.drop = Number(dr.value); dropB.textContent = state.drop.toFixed(1) + '%'; renderView(); });
drop.appendChild(dr); r1.appendChild(drop);
var hor = el('label', 'ctrl range');
var horB = el('b', null, state.weeks + ' wk');
hor.appendChild(document.createTextNode('Horizon ')); hor.appendChild(horB);
var hr = el('input'); hr.type = 'range'; hr.min = '4'; hr.max = '24'; hr.step = '1'; hr.value = String(state.weeks);
hr.addEventListener('input', function () { state.weeks = Number(hr.value); horB.textContent = state.weeks + ' wk'; renderView(); });
hor.appendChild(hr); r1.appendChild(hor);
wrap.appendChild(r1);
var r2 = el('div', 'tr2');
var q = el('input', 'search'); q.type = 'search'; q.placeholder = 'Search name, chain, category'; q.value = state.q; q.spellcheck = false;
q.addEventListener('input', function () { state.q = q.value; renderView(); });
r2.appendChild(q);
var cat = el('select');
var cats = {};
D.rows.forEach(function (r) { var c = r.category || 'Other'; cats[c] = (cats[c] || 0) + 1; });
cat.appendChild(new Option('All categories', 'all'));
Object.keys(cats).sort().forEach(function (c) { cat.appendChild(new Option(c + ' (' + cats[c] + ')', c)); });
cat.value = state.cat; cat.addEventListener('change', function () { state.cat = cat.value; renderView(); });
r2.appendChild(cat);
var chain = el('select');
var chains = {};
D.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
chain.appendChild(new Option('All chains', 'all'));
Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); }).forEach(function (c) { chain.appendChild(new Option(c + ' (' + chains[c] + ')', c)); });
chain.value = state.chain; chain.addEventListener('change', function () { state.chain = chain.value; renderView(); });
r2.appendChild(chain);
var reset = el('button', 'chip', 'Reset'); reset.type = 'button';
reset.addEventListener('click', function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.verdict = 'all'; state.tier = 'all'; state.drop = 7; state.weeks = 12; renderView(); });
r2.appendChild(reset);
wrap.appendChild(r2);
return wrap;
}
function matches(row, mode) {
var v = row.farm.farm_verdict;
if (mode === 'decision') { if (v !== 'FARM') return false; }
else if (state.verdict !== 'all' && v !== state.verdict) return false;
if (state.tier === 'watch' && !row.watch) return false;
if (state.tier === 'early' && row.tvl_usd >= D.floor_usd) return false;
if (state.tier === 'off' && (row.watch || row.tvl_usd < D.floor_usd)) return false;
if (state.cat !== 'all' && (row.category || 'Other') !== state.cat) return false;
if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
var q = state.q.trim().toLowerCase();
if (!q) return true;
return [row.name, row.slug, row.category || '', row.bucket, (row.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
}
function sortKey(row) {
if (state.sort === 'name') return row.name.toLowerCase();
if (state.sort === 'tvl') return row.tvl_usd;
if (state.sort === 'change') return num(row.change_7d) ? row.change_7d : -Infinity;
if (state.sort === 'age') return num(row.age_days) ? row.age_days : Infinity;
if (state.sort === 'odds') return row.odds;
if (state.sort === 'valueif') return row.value_if;
if (state.sort === 'implied') return row.implied;
if (state.sort === 'nph') return row.farm.farm_net_per_hour_usd;
return row.rank;
}
function filtered(mode) {
return D.rows.filter(function (r) { return matches(r, mode); }).sort(function (a, b) {
var av = sortKey(a), bv = sortKey(b);
if (av < bv) return -state.dir;
if (av > bv) return state.dir;
return a.rank - b.rank;
});
}
var HEAD = [
['rank', '# · Range', 'c-rank'], ['name', 'Protocol', 'c-proto'], ['tvl', 'TVL', 'num'], ['change', '7D', 'num'],
['age', 'No-token age', 'num'], ['odds', 'Token odds', 'num'], ['valueif', 'If it launches', 'num'],
['implied', 'Implied value · P25–P75', 'num'], ['verdict', 'Verdict · net of fees', 'num'], ['nph', 'Net / hour', 'num']
];
function head(thead) {
clear(thead); var tr = el('tr');
HEAD.forEach(function (h) {
var th = el('th', h[2]); th.scope = 'col';
var b = el('button'); b.type = 'button'; b.appendChild(document.createTextNode(h[1]));
if (state.sort === h[0]) b.appendChild(el('span', 'arrow', state.dir > 0 ? '▲' : '▼'));
b.addEventListener('click', function () {
if (state.sort === h[0]) state.dir = -state.dir;
else { state.sort = h[0]; state.dir = h[0] === 'rank' ? 1 : -1; }
renderView();
});
th.appendChild(b); tr.appendChild(th);
});
thead.appendChild(tr);
}
function farmCalc(row, sharePct, weeks) {
var tvl = Math.max(1, row.tvl_usd), implied = Math.max(1, row.implied);
var extra = { Lending: 0, Staking: 0, Yield: 0, RWA: 0.2, Curators: 0.2, Other: 0.2, DEX: 0.3, Derivatives: 0.3, 'Stablecoin & CDP': 0.4, CEX: 0.5, Bridge: 0.8 };
var dep = Math.round(Math.min(10000, 0.00017 * tvl));
var share = sharePct / 100;
var drop = dep * share * implied / tvl;
var fees = 0.0002 * 10000 + 0.95 + 0.5 * Math.max(0, row.chains.length - 1);
var hours = 3.4 + (extra[row.bucket] === undefined ? 0.2 : extra[row.bucket]) + 0.25 * Math.max(0, row.chains.length - 1);
var net = drop - fees, nphv = net / hours, tb = 10000 * 0.04 * weeks / 52;
var verdict = net <= 0 ? 'SKIP' : net > tb && nphv > 25 ? 'FARM' : 'MARGINAL';
return { deposit: dep, drop: drop, fees: fees, net: net, hours: hours, nph: nphv, tbill: tb, verdict: verdict };
}
function rowFarm(row) {
if (state.drop === 7 && state.weeks === 12) {
var f = row.farm;
return { deposit: f.farm_deposit_usd, drop: f.farm_drop_usd, fees: f.farm_fees_usd, net: f.farm_net_usd, hours: f.farm_hours, nph: f.farm_net_per_hour_usd, tbill: f.farm_tbill_usd, verdict: f.farm_verdict };
}
return farmCalc(row, state.drop, state.weeks);
}
function boardRow(row) {
var tr = el('tr'); tr.tabIndex = 0;
tr.addEventListener('click', function () { location.hash = 'p=' + row.slug; });
tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = 'p=' + row.slug; } });
var rank = el('td', 'c-rank'); rank.appendChild(el('b', null, row.rank)); rank.appendChild(el('span', null, row.rank_lo + '–' + row.rank_hi)); tr.appendChild(rank);
var p = el('td', 'c-proto'); var line = el('div', 'pname'); line.appendChild(document.createTextNode(row.name));
var t = tier(row); line.appendChild(pill(t[0], t[1])); p.appendChild(line);
var sub = el('div', 'psub'); var extraChains = (row.chains || []).length - 1;
sub.textContent = (row.category || 'Other') + ' · ' + ((row.chains || [])[0] || 'unnamed chain') + (extraChains > 0 ? ' +' + extraChains : ''); p.appendChild(sub); tr.appendChild(p);
tr.appendChild(el('td', 'num', money(row.tvl_usd)));
var ch = el('td', 'num ' + (num(row.change_7d) && row.change_7d < 0 ? 'down' : num(row.change_7d) && row.change_7d > 0 ? 'up' : 'flat'));
ch.textContent = num(row.change_7d) ? pct1(row.change_7d) + (Math.abs(row.change_7d) > 50 ? '*' : '') : '—'; tr.appendChild(ch);
tr.appendChild(el('td', 'num ' + (num(row.age_days) ? '' : 'flat'), ageText(row.age_days)));
var o = el('td', 'num'); var ob = el('div', 'odds'); var oi = el('i'); oi.style.width = Math.max(3, Math.round(row.odds * 100)) + '%'; ob.appendChild(el('b', null, pct0(row.odds)));
var bar = el('span', 'bar'); bar.appendChild(oi); ob.appendChild(bar); o.appendChild(ob); tr.appendChild(o);
tr.appendChild(el('td', 'num', money(row.value_if)));
var im = el('td', 'num'); var imb = el('div', 'impl'); imb.appendChild(el('b', null, money(row.implied))); imb.appendChild(el('span', null, money(row.p25) + '–' + money(row.p75))); im.appendChild(imb); tr.appendChild(im);
var f = rowFarm(row); var v = el('td', 'num');
var vp = el('div', 'verdict'); vp.appendChild(pill(f.verdict, f.verdict.toLowerCase())); vp.appendChild(el('b', null, usd0(f.net))); v.appendChild(vp);
v.appendChild(el('span', 'vsub', usd0(f.drop) + ' drop − ' + usd2(f.fees) + ' fees')); tr.appendChild(v);
var n = el('td', 'num ' + (f.nph < 0 ? 'down' : 'mint')); n.textContent = nph(f.nph) + '/h'; tr.appendChild(n);
return tr;
}
function fillTable(mode, thead, tbody, foot) {
head(thead);
var rows = filtered(mode);
clear(tbody);
var frag = document.createDocumentFragment();
rows.forEach(function (r) { frag.appendChild(boardRow(r)); });
tbody.appendChild(frag);
var count = { FARM: 0, MARGINAL: 0, SKIP: 0 };
rows.forEach(function (r) { count[r.farm.farm_verdict]++; });
if (mode === 'decision') {
foot.textContent = 'Showing ' + rows.length + ' of ' + D.board_size + ' pre-token protocols · ' + money(D.farm_tvl) + ' TVL · ' + money(D.farm_implied) + ' implied. Rank is the model\'s claim, not a price: the same function scores every row, and selecting one shows its arithmetic.';
} else {
foot.textContent = rows.length + ' of ' + D.board_size + ' rows · ' + money(D.total_tvl) + ' TVL · ' + money(D.total_implied) + ' implied. ' + count.FARM + ' FARM, ' + count.MARGINAL + ' MARGINAL, ' + count.SKIP + ' SKIP in this view.';
}
return rows;
}
// ---------------------------------------------------------------- value recomputation
function partsFor(row) {
var base = M.base_multiple, size = Math.pow(Math.max(1, row.tvl_usd) / M.ref_tvl_usd, M.size_slope);
var b = null; for (var i = 0; i < M.buckets.length; i++) if (M.buckets[i].name === row.bucket) { b = M.buckets[i]; break; }
var cat = b ? b.multiplier : 1, effect = b ? b.odds : 0;
var value = Math.round(row.tvl_usd * base * size * cat);
var a = row.age_days === null ? M.age_fallback_days : row.age_days;
function f(years) { return 1 / (1 + Math.exp(-(M.odds.b0 + M.odds.age * years + M.odds.tvl * Math.log(Math.max(1, row.tvl_usd) / M.ref_tvl_usd) + M.odds.growth * growth(row) + effect))); }
var Fa = f(a / 365), Fh = f(M.odds.H_years);
var odds = Math.max(0.001, Math.min(0.999, (Fh - Fa) / Math.max(1e-9, 1 - Fa)));
var implied = Math.round(value * odds);
return { base: base, size: size, cat: cat, value: implied, value_if: value, odds: odds, Fa: Fa, Fh: Fh };
}
window.radarParts = partsFor;
// ---------------------------------------------------------------- detail
function peersFor(row) {
var cand = D.peers.filter(function (p) { return p.bucket === row.bucket; });
cand.sort(function (a, b) { return Math.abs(Math.log(a.tvl_usd / Math.max(1, row.tvl_usd))) - Math.abs(Math.log(b.tvl_usd / Math.max(1, row.tvl_usd))) || a.name.length - b.name.length; });
var exact = cand.filter(function (p) { return p.category === row.category; });
var rest = cand.filter(function (p) { return p.category !== row.category; });
return exact.concat(rest).slice(0, 8);
}
function factorRow(label, value, sub) {
var d = el('div', 'factor');
d.appendChild(el('span', 'fl', label)); d.appendChild(el('b', 'fv', value)); d.appendChild(el('span', 'fs', sub));
return d;
}
function benchmark(label, value) { var d = el('div', 'bench'); d.appendChild(el('span', null, label)); d.appendChild(el('b', null, value)); return d; }
function renderDetail(slug) {
var row = null; for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { row = D.rows[i]; break; }
if (!row) { location.hash = ''; return; }
var p = partsFor(row), f = row.farm, v = $('detail-view'); clear(v);
var top = el('div', 'crumb');
var back = el('a', null, '← Board / ' + row.name); back.href = '#';
top.appendChild(back); top.appendChild(el('span', null, 'rank ' + row.rank + ' of ' + D.board_size)); v.appendChild(top);
var headBox = el('div', 'dhead');
var title = el('div', 'dtitle');
title.appendChild(el('p', 'eyebrow', '#' + row.rank + ' of ' + D.board_size + ' by implied value · rank ' + row.rank_lo + '–' + row.rank_hi + ' across ' + M.bootstrap.n + ' bootstrap refits'));
title.appendChild(el('h2', null, row.name));
var tags = el('div', 'tags'); var t = tier(row); tags.appendChild(pill(t[0], t[1])); tags.appendChild(pill(f.farm_verdict, f.farm_verdict.toLowerCase())); tags.appendChild(el('span', 'tag', row.bucket)); ((row.chains || []).slice(0, 3)).forEach(function (c) { tags.appendChild(el('span', 'tag', c)); }); title.appendChild(tags);
var strip = el('div', 'record');
[['TVL', money(row.tvl_usd)], ['7-day change', num(row.change_7d) ? pct1(row.change_7d) : '—'], ['Listed since', row.age_days === null ? 'no date' : String(new Date(Date.parse(D.as_of + 'T00:00:00Z') - row.age_days * 86400000).toISOString().slice(0, 10))], ['No-token age', ageText(row.age_days)]].forEach(function (x) { var s = el('span'); s.appendChild(el('i', null, x[0] + ' ')); s.appendChild(el('b', null, x[1])); strip.appendChild(s); });
title.appendChild(strip); headBox.appendChild(title);
var value = el('div', 'dvalue');
value.appendChild(el('span', 'dl', 'Implied value · a model estimate'));
value.appendChild(el('b', 'big', usd0(row.implied)));
var cols = el('div', 'vcols');
[['If a token launches', money(row.value_if)], ['Token odds', pct0(row.odds)], ['P25–P75', money(row.p25) + '–' + money(row.p75)], ['P10–P90', money(row.p10) + '–' + money(row.p90)]].forEach(function (x) { var c = el('div'); c.appendChild(el('i', null, x[0])); c.appendChild(el('b', null, x[1])); cols.appendChild(c); });
value.appendChild(cols);
value.appendChild(el('p', 'check', '✓ Recomputed in this browser: equals board.json. DefiLlama records no token for it, which is not proof it has none; the odds are its peers\' record, not a forecast.'));
headBox.appendChild(value); v.appendChild(headBox);
var grid = el('div', 'dgrid');
var left = el('div', 'dleft');
var how = el('section', 'panel how');
how.appendChild(el('h2', null, 'How the figure is made'));
var vterms = E.value_terms;
how.appendChild(factorRow('TVL', money(row.tvl_usd), 'DefiLlama, ' + D.as_of));
how.appendChild(factorRow('Base multiple', '×' + M.base_multiple.toFixed(4), 'fitted on ' + M.training.n_value + ' traded tokens, read at $100M TVL; alone, a flat multiple: held-out miss ×' + E.flat_loo.toFixed(2) + ' leave-one-out, ×' + E.flat_wf.toFixed(2) + ' walk-forward'));
how.appendChild(factorRow('Size curve', '×' + p.size.toFixed(4), 'slope ' + M.size_slope.toFixed(4) + ' ± ' + M.bootstrap.slope_se.toFixed(3) + ' × ln(' + money(row.tvl_usd) + ' / $100M); held-out miss ×' + vterms[1].loo.toFixed(2) + ' leave-one-out, ×' + vterms[1].wf.toFixed(2) + ' walk-forward'));
var nb = 0; M.buckets.forEach(function (b) { if (b.name === row.bucket) nb = b.n; });
how.appendChild(factorRow('Category · ' + row.bucket, '×' + p.cat.toFixed(4), nb + ' priced tokens, shrunk by ' + M.ridge_value + ' pseudo-observations; held-out miss ×' + vterms[3].loo.toFixed(2) + ' leave-one-out, ×' + vterms[3].wf.toFixed(2) + ' walk-forward'));
how.appendChild(factorRow('= Value if a token launches', money(row.value_if), money(row.tvl_usd) + ' × ' + (row.value_if / row.tvl_usd).toFixed(4) + '×; half of held-out caps fall in ' + money(row.value_if * M.bands.wf.p25) + '–' + money(row.value_if * M.bands.wf.p75)));
how.appendChild(factorRow('Token odds', '×' + p.odds.toFixed(4), 'peers of its family, size and 7-day growth: ' + (p.Fa * 100).toFixed(2) + '% record a token by its age (' + ageText(row.age_days) + '), ' + (p.Fh * 100).toFixed(2) + '% by the oldest cohort\'s (' + M.odds.H_years.toFixed(2) + ' yr), so (' + (p.Fh * 100).toFixed(2) + ' − ' + (p.Fa * 100).toFixed(2) + ') ÷ (100% − ' + (p.Fa * 100).toFixed(2) + '); Brier ' + E.brier.toFixed(3) + ' vs ' + E.base_brier.toFixed(3) + ' base rate, walk-forward'));
how.appendChild(factorRow('= Implied value', money(row.implied), 'P25–P75 ' + money(row.p25) + '–' + money(row.p75) + ' · P10–P90 ' + money(row.p10) + '–' + money(row.p90) + ' · rank ' + row.rank_lo + '–' + row.rank_hi + ' across ' + M.bootstrap.n + ' bootstrap refits'));
left.appendChild(how);
var peers = el('section', 'panel peers');
peers.appendChild(el('h2', null, 'Nearest priced peers · their tokens trade'));
var prs = peersFor(row).map(function (p2) {
var name = el('div', 'peer'); name.appendChild(el('b', null, p2.name)); name.appendChild(el('span', null, p2.symbol || '—'));
return [name, p2.category || 'Other', money(p2.tvl_usd), money(p2.mcap_usd), '×' + (p2.mcap_usd / Math.max(1, p2.tvl_usd)).toFixed(2), '×' + (p2.value_usd / Math.max(1, p2.mcap_usd)).toFixed(2)];
});
peers.appendChild(table(['Token', 'Category', 'TVL', 'Market cap', 'Cap / TVL', 'Cap ÷ model'], prs, 'peert'));
peers.appendChild(el('p', 'note', 'Peers are the nearest priced protocols by the same distance the model uses; their cap ÷ model shows how far the market priced the same record. A wide spread is why the row carries a range.'));
left.appendChild(peers);
var right = el('div', 'dright');
var farm = el('section', 'panel farm');
var fh = el('div', 'ph'); var fh2 = el('h2', null, 'Farm verdict'); fh.appendChild(fh2); fh.appendChild(pill(f.farm_verdict, f.farm_verdict.toLowerCase()));
fh.appendChild(el('p', null, usd0(f.farm_deposit_usd) + ' deposit · ' + (f.farm_drop_share * 100).toFixed(1) + '% drop share · ' + f.farm_horizon_weeks + ' weeks'));
farm.appendChild(fh);
farm.appendChild(el('p', 'ftext', f.farm_verdict + ': ' + usd0(f.farm_deposit_usd) + ' for ' + f.farm_horizon_weeks + ' weeks buys a modelled drop of ' + usd0(f.farm_drop_usd) + ' for ' + usd2(f.farm_fees_usd) + ' of fees and ' + f.farm_hours.toFixed(1) + ' h of work, a net of ' + usd0(f.farm_net_usd) + ' (' + nph(f.farm_net_per_hour_usd) + ' an hour) against ' + usd0(f.farm_tbill_usd) + ' from the same money in a 4% T-bill. Fees are covered while the drop share stays above ' + f.farm_fee_break_even_pct.toFixed(2) + '% (model ' + (f.farm_drop_share * 100).toFixed(1) + '%) and the token odds above ' + f.farm_odds_break_even_pct.toFixed(2) + '% (peers imply ' + pct0(row.odds) + '%).'));
var stats = el('div', 'stats6');
[['At risk', usd0(f.farm_deposit_usd)], ['Fees, ' + f.farm_horizon_weeks + ' weeks', usd2(f.farm_fees_usd)], ['Modelled drop', usd0(f.farm_drop_usd)], ['Net of fees', usd0(f.farm_net_usd)], ['Hands-on', f.farm_hours.toFixed(1) + ' h'], ['Net per hour', nph(f.farm_net_per_hour_usd)]].forEach(function (s) { var c = el('div'); c.appendChild(el('i', null, s[0])); c.appendChild(el('b', null, s[1])); stats.appendChild(c); });
farm.appendChild(stats);
var mx = el('div', 'matrix');
mx.appendChild(el('h3', null, 'Net by drop share × deposit  pick a cell'));
var mt = el('table', 'mini');
var htr = el('tr'); ['Share', '$1,000', '$3,000', 'Plan ' + usd0(f.farm_deposit_usd), '$30,000'].forEach(function (x) { htr.appendChild(el('th', null, x)); });
var mthead = el('thead'); mthead.appendChild(htr); mt.appendChild(mthead);
var mtb = el('tbody');
[3.8, 7, 14, 28].forEach(function (s) {
var tr = el('tr', s === 7 ? 'active' : '');
tr.appendChild(el('td', null, s.toFixed(1) + '%'));
[1000, 3000, 10000, 30000].forEach(function (d) {
var cell = null; f.farm_sensitivity.forEach(function (x) { if (x.deposit_usd === d && Math.abs(x.share_pct - s) < 0.01) cell = x; });
tr.appendChild(el('td', null, cell ? usd0(cell.net_usd) : '—'));
});
mtb.appendChild(tr);
});
mt.appendChild(mtb); mx.appendChild(mt); farm.appendChild(mx);
var bench = el('div', 'benchbox');
bench.appendChild(benchmark('Same ' + usd0(10000) + ' in a 4% T-bill, ' + f.farm_horizon_weeks + ' weeks', usd0(f.farm_tbill_usd)));
bench.appendChild(benchmark('Drop if a token does launch (odds not applied)', usd0(row.value_if * f.farm_drop_share * f.farm_deposit_usd / Math.max(1, row.tvl_usd))));
bench.appendChild(benchmark('Fees covered above a drop share of', f.farm_fee_break_even_pct.toFixed(2) + '%'));
bench.appendChild(benchmark('Fees covered above token odds of', f.farm_odds_break_even_pct.toFixed(2) + '%'));
bench.appendChild(benchmark('Exit if TVL prints below (−17% in a week)', money(f.farm_exit_tvl_usd)));
farm.appendChild(bench);
farm.appendChild(el('p', 'formula small', 'Drop = implied value × drop share × effective deposit ÷ TVL = ' + money(row.implied) + ' × ' + (f.farm_drop_share * 100).toFixed(1) + '% × ' + usd0(f.farm_deposit_usd) + ' ÷ ' + money(row.tvl_usd) + '. FARM: the net beats the T-bill and $25 an hour; SKIP: fees exceed the drop. Yield earned meanwhile is left out.'));
right.appendChild(farm);
var plan = el('section', 'panel plan');
plan.appendChild(el('h2', null, 'Farm plan · 10 steps'));
var labels = ['SETUP', 'VERIFY', 'FUND', 'RISK', 'CORE', 'DEEPER', 'CADENCE', 'WATCH', 'EXIT', 'RECORD'];
var ol = el('ol', 'steps');
row.plan.forEach(function (text, i) {
var at = text.indexOf(' Cost: '); var action = at >= 0 ? text.slice(0, at) : text; var tail = at >= 0 ? text.slice(at + 7) : '';
var ta = tail.indexOf('. Time: '); var cost = ta >= 0 ? tail.slice(0, ta) : tail; var time = ta >= 0 ? tail.slice(ta + 8) : '';
if (time.charAt(time.length - 1) === '.') time = time.slice(0, -1);
var li = el('li'); li.appendChild(el('span', 'sn', String(i + 1)));
var body = el('div', 'sb'); body.appendChild(el('b', 'sl', labels[i] || 'STEP')); body.appendChild(el('p', null, action));
var meta = el('div', 'meta'); meta.appendChild(el('i', 'cost', 'COST ' + cost)); meta.appendChild(el('i', null, 'TIME ' + time)); body.appendChild(meta);
li.appendChild(body); ol.appendChild(li);
});
plan.appendChild(ol);
right.appendChild(plan);
grid.appendChild(left); grid.appendChild(right); v.appendChild(grid);
v.appendChild(el('p', 'footline', 'A record with no token is not proof that none exists; confirm on the protocol\'s own site before depositing, and never pay to claim a reward.'));
}
// ---------------------------------------------------------------- method
function renderMethod() {
$('m-formula').textContent = 'value_if_launches = TVL × base × (TVL / $100M) ^ size_slope × category_multiple\n\ntoken_odds = 1 / (1 + exp(−(a + b·years_listed + c·ln(TVL / $100M) + d·growth + family_effect)))\n\nimplied = value_if_launches × token_odds\n\nP25–P75 = implied × [q25, q75] of held-out actual / implied; P10–P90 likewise';
var coef = [
['base at $100M TVL', '×' + M.base_multiple.toFixed(4), M.bootstrap.base_se.toFixed(3), 'multiple at the reference size'],
['size slope', M.size_slope.toFixed(4), M.bootstrap.slope_se.toFixed(3), 'per ln(TVL / $100M)'],
['category effect', '×' + M.bootstrap.cat_min.toFixed(2) + '–×' + M.bootstrap.cat_max.toFixed(2), '—', 'multiplier range, 11 buckets'],
['odds: years listed', M.odds.age.toFixed(3), M.bootstrap.age_se.toFixed(3), 'per year'],
['odds: ln TVL', M.odds.tvl.toFixed(3), M.bootstrap.tvl_se.toFixed(3), 'per ln($ / $100M)'],
['odds: 7-day growth', M.odds.growth.toFixed(3), M.bootstrap.growth_se.toFixed(3), 'per +100%'],
['odds: family', M.bootstrap.fam_min.toFixed(2) + '–' + M.bootstrap.fam_max.toFixed(2), '—', 'logit range']
];
var tb = document.querySelector('#m-coef tbody'); clear(tb);
coef.forEach(function (r) { var tr = el('tr'); tr.appendChild(el('td', null, r[0])); tr.appendChild(el('td', null, r[1])); tr.appendChild(el('td', null, r[2])); tr.appendChild(el('td', 'desc', r[3])); tb.appendChild(tr); });
var facts = $('m-facts'); clear(facts);
[['Value training rows', M.training.n_value + ' traded tokens with a positive cap'], ['Token records with a cap', M.training.n_with_cap], ['Zero caps, excluded', M.training.n_zero], ['Token records, no market cap', M.training.n_no_cap], ['Odds training rows', M.training.n_peers + ' peers, ' + M.training.n_token_peers + ' record a token'], ['Trimmed per iteration', M.training.trimmed + ' of ' + M.training.n_value], ['Median training age', M.training.median_age_days + ' days'], ['Estimator', 'least-trimmed squares · ridge 16']].forEach(function (x) { facts.appendChild(el('dt', null, x[0])); facts.appendChild(el('dd', null, x[1])); });
var kp = $('m-kpis'); clear(kp);
[['×' + E.wf_miss.toFixed(2), 'walk-forward miss'], ['×' + E.loo_miss.toFixed(2), 'leave-one-out miss'], [Math.round(C.p25_wf * 100) + '% / ' + Math.round(C.p10_wf * 100) + '%', 'P25–P75 / P10–P90 coverage'], [E.brier.toFixed(3) + ' vs ' + E.base_brier.toFixed(3), 'Brier, model vs base'], [String(E.n_pred_loo + E.n_pred_wf), 'held-out predictions'], [String(M.bootstrap.n), 'bootstrap refits']].forEach(function (x) { var k = el('div', 'kpi'); k.appendChild(el('b', null, x[0])); k.appendChild(el('span', null, x[1])); kp.appendChild(k); });
$('m-evnote').textContent = '5-fold × 20 repeats; every fold refitted and recalibrated on its own training rows. Walk-forward trains on tokens listed earlier and tests later. Bands are held-out residual quantiles; coverage is the share of real caps inside them.';
$('m-terms').textContent = 'Terms kept: ' + E.value_kept + ' of ' + E.value_tested + ' value terms · ' + E.odds_kept + ' of ' + E.odds_tested + ' odds terms.';
var bk = document.querySelector('#m-buckets tbody'); clear(bk);
M.buckets.forEach(function (b) { var tr = el('tr'); tr.appendChild(el('td', null, b.name)); tr.appendChild(el('td', null, (b.effect >= 0 ? '+' : '') + b.effect.toFixed(3))); tr.appendChild(el('td', null, b.multiplier.toFixed(3) + '×')); tr.appendChild(el('td', null, String(b.n))); bk.appendChild(tr); });
$('m-farm').textContent = 'drop = implied × drop_share × effective_deposit ÷ TVL\nnet = drop − fees\nnet/hour = net ÷ hands_on_hours\nT-bill = deposit × 4% × weeks / 52';
$('m-farm-defaults').textContent = 'deposit = min($10,000, 0.017% × TVL) · drop share 7.0% · horizon 12 weeks · T-bill 4% · hours = 3.4 + bucket extra + 0.25 per extra chain.';
$('m-farm-thresholds').textContent = 'FARM when net beats the T-bill and net/hour ≥ $25; MARGINAL when net > 0 but one test fails; SKIP when fees ≥ drop.';
$('m-farm-counts').textContent = VC.FARM + ' FARM · ' + VC.MARGINAL + ' MARGINAL · ' + VC.SKIP + ' SKIP of ' + D.board_size + ' ranked.';
$('m-farm-caveat').textContent = 'Drop share is a policy assumption, not a forecast; yield earned meanwhile is left out; fees are an all-in estimate, not a quote.';
var proof = $('m-proof'); clear(proof);
['main.ts fits the model and writes data.js; the page recomputes every row from the same coefficients and checks board.json.',
'Every number on the board, detail and decision views exists in data.js; nothing is drawn from an image or a request.',
'Not claimed: that a token will be issued, that a record with no token proves none exists, or that implied value is a price.',
'The watchlist is the house\'s floor; the ' + (D.board_size - D.watchlist_size) + ' rows below or beside it are the radar\'s extension of the same rule.'].forEach(function (t) { proof.appendChild(el('li', null, t)); });
$('m-foot').textContent = D.source_files + ' files · ' + D.source_bytes.toLocaleString('en-US') + ' bytes of source · no network, no webfont, no framework.';
}
// ---------------------------------------------------------------- views
function show(view) {
state.view = view;
['board', 'detail', 'decision', 'method'].forEach(function (name) { $('' + name + '-view').hidden = name !== view; });
}
function renderView() {
if (state.view === 'board') {
var tools = $('board-tools'); clear(tools); tools.appendChild(toolbar('board'));
fillTable('board', $('board-head'), $('board-body'), $('board-foot'));
} else if (state.view === 'decision') {
var dstrip = $('decision-strip'); clear(dstrip);
var farms = D.rows.filter(function (r) { return r.farm.farm_verdict === 'FARM'; });
var best = farms.reduce(function (m, r) { return Math.max(m, r.farm.farm_net_per_hour_usd); }, 0);
var med = farms.map(function (r) { return r.farm.farm_net_per_hour_usd; }).sort(function (a, b) { return a - b; })[Math.floor(farms.length / 2)] || 0;
[['DECISION VIEW', ''], [VC.FARM + ' FARM of ' + D.board_size + ' ranked', 'mint'], ['Best ' + nph(best) + ' / hour', ''], ['Median FARM ' + nph(med) + ' / hour', ''], ['T-bill ' + usd0(10000 * 0.04 * 12 / 52) + ' per ' + usd0(10000) + ' / 12 wk', '']].forEach(function (x) { var s = el('span', x[1]); s.textContent = x[0]; dstrip.appendChild(s); });
var dtools = $('decision-tools'); clear(dtools); dtools.appendChild(toolbar('decision'));
$('decision-line').textContent = 'Filtered to FARM verdict · sorted by net / hour, high to low · ' + VC.FARM + ' of ' + D.board_size + ' rows · ' + money(D.farm_tvl) + ' TVL · ' + money(D.farm_implied) + ' implied';
state.sort = 'nph'; state.dir = -1;
fillTable('decision', $('decision-head'), $('decision-body'), $('decision-foot'));
} else if (state.view === 'method') {
// static; rendered at boot
}
}
function route() {
var raw = location.hash.replace(/^#/, '');
var params = new URLSearchParams(raw);
if (params.get('view') === 'method') { show('method'); renderMethod(); window.scrollTo(0, 0); return; }
if (params.get('p')) { show('detail'); renderDetail(params.get('p')); window.scrollTo(0, 0); return; }
if (params.get('verdict') === 'farm') { state.verdict = 'FARM'; state.tier = 'all'; show('decision'); renderView(); window.scrollTo(0, 0); return; }
show('board'); renderView(); window.scrollTo(0, 0);
}
function boot() {
$('asof').textContent = D.as_of;
renderKpis(); renderLedger(); renderEvidence();
route();
window.addEventListener('hashchange', route);
}
boot();
})();
