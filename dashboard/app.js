// Token Radar — window.RADAR (main.ts) carries the snapshot, model, board and live rows; every value is
// recomputed from the fitted coefficients and checked against board.json's.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !D.rows) return;
  var M = D.model;
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function shortUsd(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function usdExact(v) { return isNum(v) ? '$' + Math.round(v).toLocaleString('en-US') : '—'; }
  function pct(v) {
    if (!isNum(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  // The snapshot's 7-day change as reported, with a marker when the model clamps it to its band.
  function changeCell(row) {
    var raw = row.change_7d;
    if (!isNum(raw)) return { text: '—', cls: ' flat', title: '' };
    var capped = Math.abs(raw) > M.growth_clip_pct;
    return {
      text: pct(raw) + (capped ? '*' : ''),
      cls: (raw >= 0 ? ' up' : ' down') + (capped ? ' capped' : ''),
      title: capped ? 'the model clamps it to the ±' + M.growth_clip_pct + '% band' : ''
    };
  }
  function mult(v) { return isNum(v) ? v.toFixed(3) + '×' : '—'; }
  function whole(v) { return isNum(v) ? Math.round(v).toLocaleString('en-US') : '—'; }
  function ageText(days) {
    if (!isNum(days)) return '—';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  // lib/model.ts's scoreProtocol in the page's own words: the same coefficients, transforms and order.
  function growthFraction(change) {
    var raw = isNum(change) ? change : 0;
    return Math.min(M.growth_clip_pct, Math.max(-M.growth_clip_pct, raw)) / 100;
  }
  function ageTerm(days) {
    var d = isNum(days) ? days : M.age_fallback_days;
    return Math.log(1 + Math.max(0, d) / 365);
  }
  function bucketEffect(name) {
    for (var i = 0; i < M.buckets.length; i++) if (M.buckets[i].name === name) return M.buckets[i].effect;
    return 0;
  }
  function partsFor(row) {
    var base = Math.exp(M.coefficients.alpha) / M.calibration / M.ref_tvl_usd;
    var size = Math.pow(Math.max(1, row.tvl_usd) / M.ref_tvl_usd, M.coefficients.beta - 1);
    var growth = Math.exp(M.coefficients.gamma * growthFraction(row.change_7d));
    var age = Math.exp(M.coefficients.delta * ageTerm(row.age_days));
    var category = Math.exp(bucketEffect(row.bucket));
    var value = Math.max(1, Math.round(row.tvl_usd * base * size * growth * age * category));
    return { base: base, size: size, growth: growth, age: age, category: category, value: value };
  }
  // Plans travel in data.js; this exposes the page's arithmetic to the gate's browser check.
  window.radarParts = partsFor;
  var state = { tab: 'pre', q: '', category: 'all', chain: 'all', age: 'all', watch: false, sort: 'rank', dir: 1, open: null };
  var maxImplied = 1;
  for (var mi = 0; mi < D.rows.length; mi++) if (D.rows[mi].implied > maxImplied) maxImplied = D.rows[mi].implied;
  var CATEGORY_ORDER = (function () {
    var seen = {};
    var list = [];
    D.rows.forEach(function (r) { var c = r.category || 'Other'; if (!seen[c]) { seen[c] = 1; list.push(c); } });
    return list.sort();
  })();
  function categoryCounts() {
    var counts = {};
    D.rows.forEach(function (r) { var c = r.category || 'Other'; counts[c] = (counts[c] || 0) + 1; });
    return counts;
  }
  function chainCounts() {
    var counts = {};
    D.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return counts;
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function span(cls, text) { var node = document.createElement('span'); node.className = cls; node.textContent = text; return node; }
  function bold(text) { return el('b', null, text); }
  function matches(row) {
    var q = state.q.trim().toLowerCase();
    if (state.category !== 'all' && (row.category || 'Other') !== state.category) return false;
    if (state.watch && state.tab === 'pre' && !row.watch) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
    if (state.age !== 'all') {
      var a = row.age_days;
      if (state.age === 'none') { if (isNum(a)) return false; }
      else if (!isNum(a)) return false;
      else if (state.age === 'new' && a >= 180) return false;
      else if (state.age === 'mid' && (a < 180 || a >= 548)) return false;
      else if (state.age === 'old' && a < 548) return false;
    }
    if (!q) return true;
    var hay = [row.name, row.slug, row.category || '', row.bucket || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function sortKey(row) {
    if (state.sort === 'name') return row.name.toLowerCase();
    if (state.sort === 'tvl') return row.tvl_usd;
    if (state.sort === 'change') return isNum(row.change_7d) ? row.change_7d : -Infinity;
    if (state.sort === 'age') return isNum(row.age_days) ? row.age_days : Infinity;
    if (state.sort === 'mult') return row.implied / Math.max(1, row.tvl_usd);
    if (state.sort === 'rank') return row.rank;
    return row.implied;
  }
  function sorted(rows) {
    return rows.slice().sort(function (a, b) {
      var av = sortKey(a), bv = sortKey(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }
  function filtered() { return sorted(D.rows.filter(matches)); }
  function fillStatic() {
    document.getElementById('meta-date').textContent = D.as_of;
    document.getElementById('meta-model').textContent = D.model.version.split(' · ')[0];
    document.getElementById('hero-asof').textContent = D.as_of;
    document.getElementById('hero-floor').textContent = shortUsd(D.floor_usd);
    document.getElementById('hero-count').textContent = D.board_size;
    document.getElementById('facts').textContent = M.facts;
    document.getElementById('legend').textContent = 'Ranked by implied value · * raw change outside the ±' + M.growth_clip_pct + '% band the model clamps · above floor: off the house\'s list — wrapped, staked, bridged, CEX or versioned products, or a parent protocol · below floor: the radar\'s extension';
    document.getElementById('hero-lede').textContent =
      'The watchlist names the ' + D.watchlist_size + ' protocols at or above the floor that record no token. The same rule, applied to every no-token protocol in the snapshot, ranks ' + D.board_size +
      ' on a valuation fitted to the ' + D.model.training.n + ' protocols whose token trades.';
    document.getElementById('tab-pre-count').textContent = D.board_size;
    document.getElementById('tab-live-count').textContent = D.live_size;
    document.getElementById('foot-source').textContent = D.source;
    document.getElementById('foot-scope').textContent =
      'Floor ' + usdExact(D.floor_usd) + ' · ' + D.watchlist_size + ' watchlist protocols · ' + (D.board_size - D.watchlist_size) +
      ' more no-token · ' + D.live_size + ' live · ' + D.as_of + '.';
    var stats = document.getElementById('hero-stats');
    clear(stats);
    var A = D.audit;
    [
      ['Snapshot', whole(A.total), '= ' + A.ranked + ' ranked + ' + A.excluded + ' excluded + ' + A.token_no_cap + ' no cap + ' + A.live + ' live', 'mint'],
      ['Pre-token ranked', whole(A.ranked), A.watchlist + ' watchlist · ' + A.above_floor_others + ' above floor · ' + A.below_floor + ' below'],
      ['Watchlist covered', D.watchlist_size + ' / ' + D.watchlist_size, 'the list is the floor: a listed wrapper stays', 'mint'],
      ['Live tokens', whole(A.live), A.live_priced + ' priced · ' + (A.live - A.live_priced) + ' no cap'],
      ['Products excluded', whole(A.excluded), 'wrapped · staked · bridged · CEX · versioned'],
      ['Token id, no cap', whole(A.token_no_cap)],
    ].forEach(function (s) {
      var row = el('div', 'fact' + (s[3] ? ' ' + s[3] : ''));
      row.appendChild(el('span', null, s[0]));
      row.appendChild(el('b', null, s[1]));
      if (s[2]) row.appendChild(el('em', null, s[2]));
      stats.appendChild(row);
    });
    var coef = D.model.coefficients;
    var equation = document.getElementById('equation');
    clear(equation);
    equation.appendChild(document.createTextNode('ln(mcap) = '));
    equation.appendChild(bold(coef.alpha.toFixed(3)));
    equation.appendChild(document.createTextNode(' + ' + coef.beta.toFixed(3) + '·ln(TVL/$100M) + ' + coef.gamma.toFixed(3) + '·g + ' + coef.delta.toFixed(3) + '·ln(1+age/365) + bucket'));
  }
  function fillFilters() {
    var categories = categoryCounts();
    var cat = document.getElementById('f-category');
    cat.appendChild(new Option('All categories', 'all'));
    CATEGORY_ORDER.forEach(function (c) { cat.appendChild(new Option(c + ' (' + categories[c] + ')', c)); });
    cat.addEventListener('change', function () { state.category = cat.value; syncHash(); render(); });
    var chains = chainCounts();
    var chainNames = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || (a < b ? -1 : 1); });
    var chain = document.getElementById('f-chain');
    chain.appendChild(new Option('All chains', 'all'));
    chainNames.forEach(function (c) { chain.appendChild(new Option(c + ' (' + chains[c] + ')', c)); });
    chain.addEventListener('change', function () { state.chain = chain.value; syncHash(); render(); });
    var age = document.getElementById('f-age');
    age.addEventListener('change', function () { state.age = age.value; syncHash(); render(); });
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; syncHash(); render(); });
    var watch = document.getElementById('f-watch');
    watch.addEventListener('click', function () { state.watch = !state.watch; watch.setAttribute('aria-pressed', state.watch ? 'true' : 'false'); syncHash(); render(); });
    var emptyReset = document.querySelector('[data-reset]');
    if (emptyReset) emptyReset.addEventListener('click', resetFilters);
    document.getElementById('tab-pre').addEventListener('click', function () { switchTab('pre'); });
    document.getElementById('tab-live').addEventListener('click', function () { switchTab('live'); });
  }
  function resetFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.age = 'all';
    state.watch = false;
    document.getElementById('q').value = '';
    document.getElementById('f-category').value = 'all';
    document.getElementById('f-chain').value = 'all';
    document.getElementById('f-age').value = 'all';
    document.getElementById('f-watch').setAttribute('aria-pressed', 'false');
    syncHash();
    render();
  }
  function switchTab(tab) {
    state.tab = tab;
    document.getElementById('tab-pre').setAttribute('aria-selected', tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', tab === 'live' ? 'true' : 'false');
    document.getElementById('f-watch').hidden = tab === 'live';
    syncHash();
    render();
  }
  function filterSummary() {
    var bits = [];
    if (state.q.trim()) bits.push('search “' + state.q.trim() + '”');
    if (state.category !== 'all') bits.push('category ' + state.category);
    if (state.chain !== 'all') bits.push('chain ' + state.chain);
    if (state.age !== 'all') bits.push('age ' + { new: 'under 6 months', mid: '6 to 18 months', old: 'over 18 months', none: 'no listing date' }[state.age]);
    if (state.watch) bits.push('watchlist only');
    return bits;
  }
  var HEAD = [
    { key: 'rank', label: '#', cls: 'num c-rank' },
    { key: 'name', label: 'Protocol', cls: 'c-protocol' },
    { key: 'tvl', label: 'TVL', cls: 'num c-tvl' },
    { key: 'change', label: '7 days', cls: 'num c-change' },
    { key: 'age', label: 'Age', cls: 'num c-age' },
    { key: 'implied', label: 'Implied value', cls: 'num c-impl' },
    { key: 'mult', label: '× TVL', cls: 'num c-mult' },
    { key: 'plan', label: 'Plan', cls: 'num c-plan', plain: true }
  ];
  function buildHead() {
    var head = document.getElementById('board-head');
    clear(head);
    HEAD.forEach(function (h) {
      var th = el('th', h.cls);
      th.scope = 'col';
      if (h.plain) {
        th.textContent = h.label;
        head.appendChild(th);
        return;
      }
      var button = el('button');
      button.type = 'button';
      button.appendChild(document.createTextNode(h.label));
      if (state.sort === h.key) {
        var arrow = el('span');
        arrow.setAttribute('data-dir', '');
        arrow.textContent = state.dir > 0 ? '▲' : '▼';
        button.appendChild(arrow);
      }
      button.addEventListener('click', function () {
        if (state.sort === h.key) state.dir = -state.dir;
        else { state.sort = h.key; state.dir = h.key === 'rank' || h.key === 'implied' || h.key === 'tvl' ? -1 : 1; }
        render();
      });
      th.appendChild(button);
      head.appendChild(th);
    });
  }
  function boardRow(row) {
    var tr = el('tr');
    tr.tabIndex = 0;
    tr.setAttribute('data-slug', row.slug);
    if (state.open === row.slug) tr.className = 'is-open';
    tr.appendChild(el('td', 'num c-rank' + (row.rank <= 3 ? ' top' : ''), String(row.rank)));
    var proto = el('td', 'c-protocol');
    var name = el('div', 'p-name');
    name.appendChild(document.createTextNode(row.name));
    name.appendChild(el('span', row.watch ? 'watchdot' : 'watchdot floor', row.watch ? 'watchlist' : row.below ? 'below floor' : 'above floor'));
    name.appendChild(el('span', 'chev', '›'));
    proto.appendChild(name);
    var sub = el('div', 'p-sub');
    sub.appendChild(document.createTextNode((row.category || 'Other') + ' · ' + ((row.chains || []).slice(0, 3).join(', ') || 'unnamed chain')));
    proto.appendChild(sub);
    tr.appendChild(proto);
    tr.appendChild(el('td', 'num c-tvl', shortUsd(row.tvl_usd)));
    var change = el('td', 'num c-change');
    var cc = changeCell(row);
    change.textContent = cc.text;
    change.className += cc.cls;
    if (cc.title) change.title = cc.title;
    tr.appendChild(change);
    var age = el('td', 'num c-age');
    age.textContent = ageText(row.age_days);
    if (!isNum(row.age_days)) age.className += ' flat';
    tr.appendChild(age);
    var implied = el('td', 'num c-impl');
    var wrap = el('div', 'impl');
    var bar = el('div', 'bar');
    var fill = el('i');
    fill.style.width = Math.max(3, Math.round((row.implied / maxImplied) * 100)) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el('b', null, shortUsd(row.implied)));
    implied.appendChild(wrap);
    tr.appendChild(implied);
    tr.appendChild(el('td', 'num c-mult', mult(row.implied / Math.max(1, row.tvl_usd))));
    tr.appendChild(el('td', 'num c-plan', row.tag || ''));
    tr.addEventListener('click', function () { openDetail(row.slug); });
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row.slug); }
    });
    return tr;
  }
  function renderBoard() {
    var rows = filtered();
    var body = document.getElementById('board-body');
    clear(body);
    var fragment = document.createDocumentFragment();
    rows.forEach(function (r) { fragment.appendChild(boardRow(r)); });
    body.appendChild(fragment);
    document.getElementById('board-empty').hidden = rows.length > 0;
    var foot = document.getElementById('board-foot');
    clear(foot);
    foot.appendChild(document.createTextNode('Showing '));
    foot.appendChild(bold(rows.length + ' of ' + D.rows.length));
    foot.appendChild(document.createTextNode(" pre-token protocols. Rank is the model's claim, not a price: the same function scores every row, and selecting one shows its arithmetic."));
    var line = document.getElementById('filterline');
    var bits = filterSummary();
    line.hidden = bits.length === 0;
    if (bits.length > 0) {
      clear(line);
      line.appendChild(el('b', null, 'Filtered'));
      line.appendChild(document.createTextNode(' · ' + bits.join(' · ') + ' · ' + rows.length + ' of ' + D.rows.length + ' rows'));
      var reset = el('button', null, 'Clear');
      reset.type = 'button';
      reset.addEventListener('click', resetFilters);
      line.appendChild(reset);
    }
  }
  var LIVE_HEAD = [
    { key: 'name', label: 'Protocol', cls: 'c-protocol' },
    { key: 'tvl', label: 'TVL', cls: 'num c-tvl' },
    { key: 'change', label: '7 days', cls: 'num c-change' },
    { key: 'mcap', label: 'Market cap', cls: 'num c-tvl' },
    { key: 'fitted', label: 'Fitted value', cls: 'num c-tvl' },
    { key: 'ratio', label: 'Market / fitted', cls: 'num c-mult' }
  ];
  function liveVisible() {
    var q = state.q.trim().toLowerCase();
    return D.live.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', r.bucket || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var ra = a.mcap_usd > 0 ? Math.abs(Math.log(a.mcap_usd / partsFor(a).value)) : Infinity;
      var rb = b.mcap_usd > 0 ? Math.abs(Math.log(b.mcap_usd / partsFor(b).value)) : Infinity;
      return ra - rb || b.mcap_usd - a.mcap_usd;
    });
  }
  function renderLive() {
    var head = document.getElementById('live-head');
    clear(head);
    LIVE_HEAD.forEach(function (h) {
      var th = el('th', h.cls);
      th.scope = 'col';
      th.appendChild(document.createTextNode(h.label));
      head.appendChild(th);
    });
    var rows = liveVisible();
    var body = document.getElementById('live-body');
    clear(body);
    var fragment = document.createDocumentFragment();
    rows.forEach(function (row) {
      var tr = el('tr');
      var proto = el('td', 'c-protocol');
      var name = el('div', 'p-name', row.name);
      if (!(row.mcap_usd > 0)) name.appendChild(el('span', 'watchdot floor', 'no cap'));
      proto.appendChild(name);
      var sub = el('div', 'p-sub', (row.category || 'Other') + ' · ' + ((row.chains || []).slice(0, 3).join(', ') || 'unnamed chain'));
      proto.appendChild(sub);
      tr.appendChild(proto);
      tr.appendChild(el('td', 'num c-tvl', shortUsd(row.tvl_usd)));
      var change = el('td', 'num c-change');
      var cc = changeCell(row);
      change.textContent = cc.text;
      change.className += cc.cls;
      if (cc.title) change.title = cc.title;
      tr.appendChild(change);
      tr.appendChild(el('td', 'num c-tvl', row.mcap_usd > 0 ? shortUsd(row.mcap_usd) : '—'));
      var parts = partsFor(row);
      tr.appendChild(el('td', 'num c-tvl', shortUsd(parts.value)));
      var cell = el('td', 'num c-mult');
      if (row.mcap_usd > 0) {
        var ratio = row.mcap_usd / parts.value;
        cell.appendChild(el('span', 'ratio ' + (ratio >= 0.5 && ratio <= 2 ? 'ok' : 'off'), ratio.toFixed(2) + '×'));
      } else {
        cell.textContent = '—';
      }
      tr.appendChild(cell);
      fragment.appendChild(tr);
    });
    body.appendChild(fragment);
    var foot = document.getElementById('board-foot');
    clear(foot);
    foot.appendChild(document.createTextNode("The live set is the model's own exam: these " + D.live_size + " protocols record a market cap (" + (D.audit.live - D.audit.live_priced) + " without a positive cap, marked), so the cap is fact and the fitted value is the model's. " +
      "Sorted by how close the fit came: a ratio near 1.00 means the model priced the record like the market did; the outliers are why the median out-of-sample error is " + M.validation.median_factor + "×."));
  }
  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { row = D.rows[i]; break; }
    if (!row) return;
    state.open = slug;
    var parts = partsFor(row);
    var dialog = document.getElementById('detail');
    var body = document.getElementById('detail-body');
    clear(body);
    var top = el('div', 'd-top');
    var titleBox = el('div');
    var eyebrow = el('div', 'd-eyebrow');
    eyebrow.appendChild(el('b', null, 'Rank ' + row.rank + ' of ' + D.board_size));
    eyebrow.appendChild(document.createTextNode(' · ' + (row.watch ? 'on the watchlist' : row.below ? 'found below the floor' : 'above the floor, not on the list')));
    titleBox.appendChild(eyebrow);
    var title = el('h2', 'd-title', row.name);
    title.id = 'detail-title';
    titleBox.appendChild(title);
    titleBox.appendChild(el('div', 'd-meta', (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ') || 'unnamed chain') + ' · ' + row.bucket + ' bucket'));
    top.appendChild(titleBox);
    var close = el('button', 'd-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the detail view');
    close.addEventListener('click', function () { dialog.close(); });
    top.appendChild(close);
    body.appendChild(top);
    var value = el('div', 'd-value');
    value.appendChild(el('div', 'big', usdExact(row.implied)));
    var cap = el('div', 'cap');
    cap.appendChild(document.createTextNode('implied token value'));
    cap.appendChild(el('b', null, 'model ' + D.model.version));
    if (row.band) cap.appendChild(el('b', null, row.band));
    value.appendChild(cap);
    body.appendChild(value);
    if (row.budget) body.appendChild(el('div', 'd-budget', row.budget));
    var grid = el('div', 'd-grid');
    var left = el('div', 'd-left');
    var record = el('div', 'd-box');
    record.appendChild(el('h4', null, 'The record'));
    [
      ['TVL', usdExact(row.tvl_usd)],
      ['7-day change', isNum(row.change_7d) ? pct(row.change_7d) + (Math.abs(row.change_7d) > M.growth_clip_pct ? ' (' + pct(Math.max(-M.growth_clip_pct, Math.min(M.growth_clip_pct, row.change_7d))) + ' in the fit)' : '') : 'not reported'],
      ['Listed', row.age_days === null ? 'no listing date' : ageText(row.age_days) + ' ago'],
      ['Category', row.category || 'none'],
      ['Chains', (row.chains || []).slice(0, 3).join(', ') || 'unnamed'],
      ['Token', 'none on record']
    ].forEach(function (pair) {
      var line = el('div', 'd-row');
      line.appendChild(el('span', null, pair[0]));
      line.appendChild(el('b', null, pair[1]));
      record.appendChild(line);
    });
    left.appendChild(record);
    var model = el('div', 'd-box');
    model.appendChild(el('h4', null, 'The model'));
    [
      ['Base at $100M TVL', mult(parts.base)],
      ['Size factor', mult(parts.size)],
      ['Growth factor', mult(parts.growth)],
      ['Age factor', mult(parts.age)],
      ['Category factor', mult(parts.category)],
      ['Implied / TVL', mult(row.implied / Math.max(1, row.tvl_usd))]
    ].forEach(function (pair) {
      var line = el('div', 'd-row');
      line.appendChild(el('span', null, pair[0]));
      line.appendChild(el('b', null, pair[1]));
      model.appendChild(line);
    });
    left.appendChild(model);
    var eq = el('div', 'd-eq');
    var eqTop = el('div');
    [shortUsd(row.tvl_usd), parts.base.toFixed(4), parts.size.toFixed(3), parts.growth.toFixed(3), parts.age.toFixed(3), parts.category.toFixed(3)].forEach(function (text, at) {
      if (at > 0) { eqTop.appendChild(document.createTextNode(' ')); eqTop.appendChild(span('op', '×')); eqTop.appendChild(document.createTextNode(' ')); }
      eqTop.appendChild(document.createTextNode(text));
    });
    eq.appendChild(eqTop);
    var eqBottom = el('div');
    eqBottom.appendChild(span('op', '= '));
    eqBottom.appendChild(span('res', usdExact(parts.value)));
    eq.appendChild(eqBottom);
    left.appendChild(eq);
    var check = el('div', 'd-check');
    var diff = Math.abs(parts.value - row.implied);
    if (diff <= 1) {
      check.appendChild(document.createTextNode('Recomputed here from the fitted coefficients: '));
      check.appendChild(bold('✓ ' + usdExact(parts.value)));
      check.appendChild(document.createTextNode(', the value board.json carries.'));
    } else {
      check.className = 'd-check bad';
      check.textContent = '✗ ' + usdExact(parts.value) + ' here against ' + usdExact(row.implied) + ' in board.json: the data file is stale.';
    }
    left.appendChild(check);
    var fit = el('div', 'd-check');
    fit.appendChild(document.createTextNode('Fit: ' + M.training.n + ' live tokens · ' + M.validation.folds + '×' + M.validation.repeats + '-fold CV · median error ' + M.validation.median_factor + '× · R² ' + M.validation.r2.toFixed(2) + '.'));
    left.appendChild(fit);
    var note = el('p', 'd-note');
    note.appendChild(bold('Read this first.'));
    note.appendChild(document.createTextNode(' The plan is derived from this row\'s category, chains, TVL and age, and the same strings are in board.json. A record with no token is not proof that none exists: confirm on the protocol\'s own site before you deposit, and never pay to claim a reward.'));
    left.appendChild(note);
    var plan = row.plan || [];
    var section = el('section', 'd-plan');
    var heading = el('h3');
    heading.appendChild(document.createTextNode('Farm plan'));
    heading.appendChild(el('span', null, plan.length + ' steps · cost and time each'));
    section.appendChild(heading);
    var list = el('ol', 'steps');
    plan.forEach(function (text, i) {
      var at = text.indexOf(' Cost: ');
      var action = at >= 0 ? text.slice(0, at) : text;
      var tail = at >= 0 ? text.slice(at + 7) : '';
      var timeAt = tail.indexOf('. Time: ');
      var cost = timeAt >= 0 ? tail.slice(0, timeAt) : tail;
      var time = timeAt >= 0 ? tail.slice(timeAt + 8) : '';
      if (time.charAt(time.length - 1) === '.') time = time.slice(0, -1);
      var li = el('li', 'step');
      li.appendChild(el('span', 'step-n', String(i + 1)));
      var stepBody = el('div', 'step-body');
      stepBody.appendChild(el('b', null, action));
      var meta = el('div', 'step-meta');
      meta.appendChild(el('i', 'cost', 'Cost: ' + cost));
      meta.appendChild(el('i', null, 'Time: ' + time));
      stepBody.appendChild(meta);
      li.appendChild(stepBody);
      list.appendChild(li);
    });
    section.appendChild(list);
    grid.appendChild(left);
    grid.appendChild(section);
    body.appendChild(grid);
    state.open = slug;
    syncHash();
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function appendSeq(parent, seq) {
    seq.forEach(function (item) {
      if (item[0] === 'nl') parent.appendChild(document.createTextNode('\n'));
      else if (item[0] === 'plain') parent.appendChild(document.createTextNode(item[1]));
      else parent.appendChild(span(item[0], item[1]));
    });
  }
  function paragraph(lead, rest) {
    var p = el('p');
    p.appendChild(bold(lead));
    p.appendChild(document.createTextNode(rest));
    return p;
  }
  function renderMethod() {
    var coef = D.model.coefficients;
    var t = D.model.training;
    var v = D.model.validation;
    var formulaBox = document.getElementById('formula');
    clear(formulaBox);
    appendSeq(formulaBox, [
      ['plain', 'ln(mcap) '], ['op', '='], ['plain', ' '], ['k', coef.alpha.toFixed(6)],
      ['nl'],
      ['plain', '        '], ['op', '+'], ['plain', ' '], ['k', coef.beta.toFixed(6)], ['op', ' · '], ['plain', 'ln('], ['v', 'TVL'], ['plain', ' / $100M)'],
      ['nl'],
      ['plain', '        '], ['op', '+'], ['plain', ' '], ['k', coef.gamma.toFixed(6)], ['op', ' · '], ['v', 'g'], ['plain', '            '], ['m', 'g = clamp(7d change, ±' + M.growth_clip_pct + '%) / 100'],
      ['nl'],
      ['plain', '        '], ['op', '+'], ['plain', ' '], ['k', coef.delta.toFixed(6)], ['op', ' · '], ['plain', 'ln(1 + '], ['v', 'age'], ['plain', ' / 365d)'],
      ['nl'],
      ['plain', '        '], ['op', '+'], ['plain', ' '], ['v', 'effect'], ['plain', '['], ['v', 'bucket'], ['plain', ']   '], ['m', 'eleven categories, ridge 16'],
    ]);
    document.getElementById('formula-note').textContent =
      'The right side is a log market cap in dollars; exp() of it is the implied value. In multiplier form the page applies: implied = TVL × ' + mult(Math.exp(coef.alpha) / D.model.calibration / D.model.ref_tvl_usd) +
      ' × (TVL/$100M)^(' + (coef.beta - 1).toFixed(3) + ') × e^(' + coef.gamma.toFixed(3) + '·g) × (1+age/365)^' + coef.delta.toFixed(3) + ' × category. The base multiple is the fitted multiple at $100M of TVL.';
    var coefTable = document.querySelector('#coef-table tbody');
    clear(coefTable);
    [
      ['α · level', coef.alpha.toFixed(4), 'ln dollars at $100M TVL, no growth, new listing'],
      ['β · TVL elasticity', coef.beta.toFixed(4), 'a 10× larger TVL is ' + (Math.pow(10, coef.beta) - 1 >= 0 ? '+' : '') + Math.round((Math.pow(10, coef.beta) - 1) * 100) + '% on value'],
      ['γ · growth', coef.gamma.toFixed(4), 'per +100% of 7-day TVL change'],
      ['δ · age', coef.delta.toFixed(4), 'per log-year with no token'],
      ['calibration', D.model.calibration.toFixed(4), 'median live market cap ÷ fitted value']
    ].forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r[0]));
      tr.appendChild(el('td', null, r[1]));
      tr.appendChild(el('td', 'desc', r[2]));
      coefTable.appendChild(tr);
    });
    var facts = document.getElementById('fit-facts');
    clear(facts);
    [
      ['Training rows', t.n + ' of ' + (t.n + t.zero_market_cap) + ' with a market cap'],
      ['Zero market cap, excluded', String(t.zero_market_cap)],
      ['Token, no market cap', String(t.no_market_cap)],
      ['Trimmed per iteration', t.trimmed + ' of ' + t.n],
      ['Median training age', t.median_age_days + ' days'],
      ['Estimator', 'least-trimmed squares']
    ].forEach(function (pair) {
      facts.appendChild(el('dt', null, pair[0]));
      facts.appendChild(el('dd', null, pair[1]));
    });
    document.getElementById('validation-note').textContent =
      v.folds + '-fold cross-validation, repeated ' + v.repeats + ' times: ' + whole(v.n) + ' out-of-sample predictions, with every fold refitted and recalibrated on its own training rows. The error is in log space, so ' +
      v.median_factor + '× is the median factor between an implied value and the market cap it predicted.';
    var kpis = document.getElementById('validation-kpis');
    clear(kpis);
    [
      [v.median_factor + '×', 'median error'],
      [v.r2.toFixed(3), 'R², log space'],
      [Math.round(v.within_2x * 100) + '%', 'within 2×'],
      [whole(v.n), 'predictions']
    ].forEach(function (pair) {
      var kpi = el('div', 'kpi');
      kpi.appendChild(el('b', null, pair[0]));
      kpi.appendChild(el('span', null, pair[1]));
      kpis.appendChild(kpi);
    });
    var buckets = document.querySelector('#bucket-table tbody');
    clear(buckets);
    D.model.buckets.forEach(function (b) {
      var tr = el('tr');
      tr.appendChild(el('td', null, b.name));
      tr.appendChild(el('td', null, (b.effect >= 0 ? '+' : '') + b.effect.toFixed(3)));
      tr.appendChild(el('td', null, b.multiplier.toFixed(3) + '×'));
      tr.appendChild(el('td', null, String(b.n)));
      buckets.appendChild(tr);
    });
    var limits = document.getElementById('limitations');
    clear(limits);
    limits.appendChild(paragraph('What is fitted. ', t.n + ' protocols record both a TVL and a positive market cap; each is one observation of the market\'s own multiple. The page applies that line to the ' + D.board_size +
      ' protocols whose record carries no token. Nothing reads a protocol\'s name: the category map knows DefiLlama\'s taxonomy, not a list of winners.'));
    limits.appendChild(paragraph('Why trimmed. ', t.zero_market_cap + ' protocols record a zero market cap and cannot be logged. Of the rest, ' + t.trimmed + ' are trimmed each iteration because a few rows price a chain token or a sibling token against a pool\'s TVL. ' +
      'The median live market cap is ' + (D.model.calibration * 100).toFixed(0) + '% of the fitted value before calibration, so the intercept carries that correction.'));
    limits.appendChild(paragraph('Growth and age are small tilts. ', 'In a ' + t.n + '-row cross-section neither is a strong signal: a +10% week adds about ' + ((Math.exp(coef.gamma * 0.1) - 1) * 100).toFixed(1) +
      '% to the value, and each three years of history adds about ' + ((Math.pow(1 + 3, coef.delta) - 1) * 100).toFixed(0) + '%. Every row shows both multipliers, so the tilt is visible rather than hidden. The median out-of-sample error is ' + v.median_factor + '×: the ranking is the model\'s claim, the absolute value an estimate.'));
    limits.appendChild(paragraph('What it does not claim. ', 'A record with no token is not proof that none exists: a protocol may still carry a token DefiLlama does not record, so every plan starts by checking its own site. ' +
      'Implied value is not a price and not a prediction that a token will be issued. The watchlist is the house\'s floor; the ' + D.below_floor_size + ' rows below it are the radar\'s extension of the same rule.'));
  }
  function syncHash() {
    var params = new URLSearchParams();
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.q.trim()) params.set('q', state.q.trim());
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.age !== 'all') params.set('age', state.age);
    if (state.watch) params.set('watch', '1');
    if (state.open) params.set('p', state.open);
    var next = params.toString();
    if (next) history.replaceState(null, '', '#' + next);
    else history.replaceState(null, '', location.pathname + location.search);
  }
  function readHash() {
    var raw = location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('age')) state.age = params.get('age');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('p')) state.open = params.get('p');
  }
  function render() {
    buildHead();
    document.getElementById('pre-wrap').hidden = state.tab !== 'pre';
    document.getElementById('live-wrap').hidden = state.tab !== 'live';
    document.getElementById('f-watch').hidden = state.tab === 'live';
    if (state.tab === 'pre') renderBoard();
    else renderLive();
    document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
  }
  function boot() {
    readHash();
    fillStatic();
    fillFilters();
    if (state.q) document.getElementById('q').value = state.q;
    if (state.category !== 'all') document.getElementById('f-category').value = state.category;
    if (state.chain !== 'all') document.getElementById('f-chain').value = state.chain;
    if (state.age !== 'all') document.getElementById('f-age').value = state.age;
    document.getElementById('f-watch').setAttribute('aria-pressed', state.watch ? 'true' : 'false');
    if (state.tab === 'live') {
      document.getElementById('tab-pre').setAttribute('aria-selected', 'false');
      document.getElementById('tab-live').setAttribute('aria-selected', 'true');
    }
    renderMethod();
    render();
    var dialog = document.getElementById('detail');
    dialog.addEventListener('close', function () {
      if (state.open) {
        state.open = null;
        syncHash();
        renderBoard();
      }
    });
    if (state.open) openDetail(state.open);
    if (new URLSearchParams(location.hash.replace(/^#/, '')).get('view') === 'method') {
      document.getElementById('method').scrollIntoView({ block: 'start' });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dialog.open) dialog.close();
    });
  }
  boot();
})();