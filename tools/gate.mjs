#!/usr/bin/env node
// @ts-nocheck — a local Node tool run by node itself; the repo installs no type packages.
// The entry's local gate: the seven rows make.fun's scorer checks, plus the two checks this bounty
// asks the builder to run locally — that the rendered page recomputes every row's value and farm plan
// from its own code, and that the dossier's source text fits whole.
//
//   node tools/gate.mjs --snapshot <input/snapshot.json> [--out out] [--browser <chrome|edge>]
//
// Node 22, the standard library only. The browser step needs a local Chromium (Edge or Chrome); without
// one the static checks still run and the arithmetic check is reported as skipped, never as a pass.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const TEXT_MAX_BYTES = 65_536;
const DOSSIER_MAX_BYTES = 1_572_864;
const SCREENSHOT_MAX_BYTES = 524_288;
const SCREENSHOT_MAX = 4;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304;
const MAX_VALUE_USD = 100_000_000_000_000;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const TEXT_FILE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;

/** --name <value> or --name=<value>, else the fallback. */
function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const equals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return equals === undefined ? fallback : equals.slice(name.length + 3);
}

const outDir = arg('out', 'out');
const snapshotPath = arg('snapshot', join(outDir, '..', 'input', 'snapshot.json'));
if (!existsSync(snapshotPath)) {
  process.stderr.write(`gate: no snapshot at ${snapshotPath}: pass --snapshot <input/snapshot.json>\n`);
  process.exit(2);
}
if (!existsSync(join(outDir, 'board.json'))) {
  process.stderr.write(`gate: no board.json in ${outDir}: run main.ts first\n`);
  process.exit(2);
}

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok, detail });
  return ok;
}

/** Every regular file under `dir`, as paths relative to it, sorted. */
function walk(dir) {
  const found = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) found.push(relative(dir, path).split('\\').join('/'));
    }
  };
  visit(dir);
  return found;
}

/** A PNG's or JPEG's pixel size, or null when the bytes are not a whole image of either kind. */
function imageSize(bytes) {
  const isPng = bytes.length > 32 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG';
  if (isPng) {
    const iend = bytes.lastIndexOf(Buffer.from('IEND', 'ascii'));
    if (iend < 0 || bytes.readUInt32BE(iend - 4) !== 0) return null;
    return { kind: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = bytes[at + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = bytes.readUInt16BE(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { kind: 'jpeg', height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      if (length < 2) break;
      at += 2 + length;
    }
  }
  return null;
}

// ---------------------------------------------------------------- board_file, sorted, coverage, farm_steps

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const knownSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = new Set(snapshot.watchlist);
const boardBytes = statSync(join(outDir, 'board.json')).size;
const boardDoc = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const rows = Array.isArray(boardDoc) ? boardDoc : boardDoc.rows;

const boardProblems = [];
if (!Array.isArray(rows)) boardProblems.push('board.json has no rows array');
else {
  if (rows.length < 100 || rows.length > 4000) boardProblems.push(`${rows.length} rows: the gate wants 100 to 4000`);
  if (boardBytes > 8_388_608) boardProblems.push(`board.json is ${boardBytes} bytes: the cap is 8 MiB`);
  const seen = new Set();
  for (const [i, row] of rows.entries()) {
    const at = `row ${i + 1}`;
    if (typeof row?.slug !== 'string' || !knownSlugs.has(row.slug)) boardProblems.push(`${at}: slug ${JSON.stringify(row?.slug)} is not in the snapshot`);
    else if (seen.has(row.slug)) boardProblems.push(`${at}: slug ${row.slug} repeats`);
    else seen.add(row.slug);
    if (typeof row?.name !== 'string' || row.name.trim() === '') boardProblems.push(`${at}: no name`);
    if (!Number.isSafeInteger(row?.rank) || row.rank < 1) boardProblems.push(`${at}: rank ${row?.rank}`);
    if (!Number.isSafeInteger(row?.implied_value_usd) || row.implied_value_usd <= 0) boardProblems.push(`${at}: implied value ${row?.implied_value_usd}`);
    else if (row.implied_value_usd > MAX_VALUE_USD) boardProblems.push(`${at}: implied value over the cap`);
  }
}
check('board_file', boardProblems.length === 0, boardProblems.slice(0, 5).join('; ') || `${rows.length} rows, ${boardBytes} bytes, every slug a snapshot protocol, every value a positive integer`);

const orderProblems = [];
if (Array.isArray(rows)) {
  const byRank = rows.slice().sort((a, b) => a.rank - b.rank);
  const ranks = byRank.map((r) => r.rank);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) {
    orderProblems.push(`rank ${i + 1} is ${ranks[i]}`);
    break;
  }
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) {
      orderProblems.push(`rank ${byRank[i].rank} is worth more than rank ${byRank[i - 1].rank}`);
      break;
    }
  }
  if (byRank.length > 1 && new Set(byRank.map((r) => r.implied_value_usd)).size === 1) orderProblems.push('every row carries the same value');
}
check('sorted_by_value', orderProblems.length === 0, orderProblems.join('; ') || (rows.length ? `ranks 1..${rows.length} once each, value non-increasing from rank 1 ($${rows[0].implied_value_usd.toLocaleString('en-US')})` : ''));

const present = new Set((rows ?? []).map((r) => r.slug));
const missing = snapshot.watchlist.filter((s) => !present.has(s));
const outside = (rows ?? []).filter((r) => !watchlist.has(r.slug)).length;
check('coverage', missing.length === 0, missing.length === 0 ? `all ${snapshot.watchlist.length} watchlist slugs ranked, ${outside} rows from outside the watchlist` : `${missing.length} missing: ${missing.slice(0, 4).join(', ')}`);

const stepProblems = [];
for (const row of rows ?? []) {
  const steps = row.farm_steps;
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
    stepProblems.push(`${row.slug}: ${Array.isArray(steps) ? steps.length : 'no'} steps`);
    continue;
  }
  for (const [i, step] of steps.entries()) {
    const length = typeof step === 'string' ? step.trim().length : -1;
    if (length < 20 || length > 600) stepProblems.push(`${row.slug} step ${i + 1}: ${length} characters`);
  }
}
const stepCounts = (rows ?? []).map((r) => (Array.isArray(r.farm_steps) ? r.farm_steps.length : 0));
check('farm_steps', stepProblems.length === 0, stepProblems.slice(0, 4).join('; ') || `${rows.length} plans of ${Math.min(...stepCounts)} to ${Math.max(...stepCounts)} steps, every step 20 to 600 characters`);

// ---------------------------------------------------------------- dashboard_files

const dashboardDir = join(outDir, 'dashboard');
const dashboardProblems = [];
let dashboardFiles = [];
let dashboardBytes = 0;
if (!existsSync(dashboardDir)) dashboardProblems.push('no dashboard/ directory');
else {
  dashboardFiles = walk(dashboardDir);
  if (dashboardFiles.length > DASHBOARD_MAX_FILES) dashboardProblems.push(`${dashboardFiles.length} files`);
  for (const rel of dashboardFiles) {
    const parts = rel.split('/');
    if (parts.some((p) => p.startsWith('.'))) dashboardProblems.push(`${rel}: a dot path`);
    if (!PLAIN_NAME.test(parts[parts.length - 1])) dashboardProblems.push(`${rel}: a name a dossier refuses`);
    dashboardBytes += statSync(join(dashboardDir, rel)).size;
  }
  if (dashboardBytes > DASHBOARD_MAX_BYTES) dashboardProblems.push(`${dashboardBytes} bytes`);
  if (!dashboardFiles.includes('index.html')) dashboardProblems.push('no index.html');
  if (!dashboardFiles.some((f) => f.endsWith('.css'))) dashboardProblems.push('no .css file');
  if (!dashboardFiles.some((f) => f.endsWith('.js'))) dashboardProblems.push('no .js file');

  // The gate refuses an http:// or https:// address in an HTML attribute, a <style> body, a CSS file,
  // or a JavaScript import, export-from, require or dynamic-import specifier.
  const address = /https?:\/\//i;
  for (const rel of dashboardFiles) {
    const text = readFileSync(join(dashboardDir, rel), 'utf8');
    if (rel.endsWith('.html') || rel.endsWith('.svg')) {
      const tags = text.match(/<[a-z][^>]*>/gi) ?? [];
      for (const tag of tags) {
        const attrs = tag.match(/[a-z-:]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi) ?? [];
        for (const attr of attrs) if (address.test(attr)) dashboardProblems.push(`${rel}: ${attr.slice(0, 60)}`);
      }
      const styles = text.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
      for (const style of styles) if (address.test(style)) dashboardProblems.push(`${rel}: an address in a <style> body`);
    }
    if (rel.endsWith('.css')) {
      if (address.test(text)) dashboardProblems.push(`${rel}: an address in the stylesheet`);
      for (const at of text.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/gi)) if (address.test(at[1])) dashboardProblems.push(`${rel}: @import ${at[1]}`);
    }
    if (rel.endsWith('.js') || rel.endsWith('.mjs')) {
      for (const spec of text.matchAll(/\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gi)) {
        if (address.test(spec[1])) dashboardProblems.push(`${rel}: import ${spec[1]}`);
      }
      for (const spec of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gi)) if (address.test(spec[1])) dashboardProblems.push(`${rel}: dynamic import ${spec[1]}`);
      for (const spec of text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gi)) if (address.test(spec[1])) dashboardProblems.push(`${rel}: require ${spec[1]}`);
    }
  }
}
if (dashboardProblems.length === 0) {
  dashboardProblems.detail = `${dashboardFiles.length} files (${dashboardFiles.join(', ')}), ${dashboardBytes} bytes, no network address in any attribute, stylesheet or import`;
}
check('dashboard_files', dashboardProblems.length === 0, dashboardProblems.slice(0, 4).join('; ') || dashboardProblems.detail);

// The dossier's text must show every source file whole: it caps the text at 64 KiB, so the page's own
// text files have to stay under it. This is not a gate row, but a cut dossier is a judge who reads half
// the page's code.
let sourceBytes = 0;
for (const rel of dashboardFiles) {
  if (TEXT_FILE.test(rel)) sourceBytes += statSync(join(dashboardDir, rel)).size;
}
check('dossier_text_fits', sourceBytes + 600 < TEXT_MAX_BYTES, `${sourceBytes} bytes of text source (+ ~600 for the dossier's file list) against the ${TEXT_MAX_BYTES}-byte cap`);

// ---------------------------------------------------------------- screenshots

const shotsDir = join(outDir, 'screenshots');
const shotProblems = [];
const shots = existsSync(shotsDir) ? walk(shotsDir).filter((rel) => !rel.split('/').some((p) => p.startsWith('.'))) : [];
const shotSizes = [];
if (shots.length < 3 || shots.length > SCREENSHOT_MAX) shotProblems.push(`${shots.length} images`);
for (const rel of shots) {
  const bytes = readFileSync(join(shotsDir, rel));
  const size = imageSize(bytes);
  shotSizes.push(`${rel} ${size ? `${size.width}x${size.height}` : '?'} ${Math.round(bytes.length / 1024)} KiB`);
  if (!PLAIN_NAME.test(rel.split('/').pop())) shotProblems.push(`${rel}: a name a dossier refuses`);
  if (bytes.length > SCREENSHOT_MAX_BYTES) shotProblems.push(`${rel}: ${bytes.length} bytes`);
  if (!size) {
    shotProblems.push(`${rel}: not a whole PNG or JPEG`);
    continue;
  }
  if (Math.max(size.width, size.height) > 1440) shotProblems.push(`${rel}: long side ${Math.max(size.width, size.height)}`);
  if (Math.min(size.width, size.height) < 800) shotProblems.push(`${rel}: short side ${Math.min(size.width, size.height)}`);
}
check('screenshots', shotProblems.length === 0, shotProblems.slice(0, 4).join('; ') || shotSizes.join(' · '));

// ---------------------------------------------------------------- dossier_matches

const dossierPath = join(outDir, 'dossier.json');
let dossierOk = false;
let dossierDetail = '';
try {
  const written = readFileSync(dossierPath);
  const rebuilt = buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES });
  const same = Buffer.isBuffer(rebuilt) ? written.equals(rebuilt) : written.equals(Buffer.from(rebuilt));
  const dossier = JSON.parse(written.toString('utf8'));
  const text = typeof dossier.text === 'string' ? dossier.text : '';
  const cut = /lines? (?:are )?not shown|files? left out/i.test(text);
  dossierOk = same && written.length > 0;
  dossierDetail = `${Math.round(written.length / 1024)} KiB, ${dossier.images?.length ?? 0} images, ${text.length} bytes of source text${same ? ', byte-for-byte what buildDossier writes' : ', DIFFERS from buildDossier'}`;
  if (!same) dossierOk = false;
  if (written.length > DOSSIER_MAX_BYTES) {
    dossierOk = false;
    dossierDetail += `, over the ${DOSSIER_MAX_BYTES}-byte cap`;
  }
  if (cut) dossierDetail += ', but the text is cut';
} catch (error) {
  dossierDetail = String(error && error.message ? error.message : error);
  dossierOk = false;
}
check('dossier_matches', dossierOk, dossierDetail);

// ---------------------------------------------------------------- the page's own arithmetic (browser)

/** The browsers this machine might have, in the order a local check should try them. */
function findBrowser() {
  const explicit = arg('browser', process.env.CHROME_PATH ?? '');
  const candidates = [
    explicit,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

/** Unescape the entities Chromium writes when it dumps a text node. */
function unescapeHtml(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function browserCheck() {
  const browser = findBrowser();
  if (browser === null) return { ok: null, detail: 'no local Chromium found: pass --browser <path> to run the page check' };
  const dir = mkdtempSync(join(tmpdir(), 'token-radar-gate-'));
  try {
    mkdirSync(join(dir, 'dashboard'));
    copyFileSync(join(outDir, 'data.js'), join(dir, 'data.js'));
    for (const rel of walk(join(outDir, 'dashboard'))) copyFileSync(join(outDir, 'dashboard', rel), join(dir, 'dashboard', rel));
    const probe = [
      '<script>',
      "window.addEventListener('load', function () {",
      '  setTimeout(function () {',
      '    var rows = (window.RADAR && window.RADAR.rows) || [];',
      '    var out = { values: [], plans: [] };',
      '    for (var i = 0; i < rows.length; i++) {',
      '      var row = rows[i];',
      '      out.values.push([row.slug, window.radarParts(row).value, row.implied]);',
      '      out.plans.push([row.slug, row.plan]);',
      '    }',
      "    var pre = document.createElement('pre');",
      "    pre.id = 'probe';",
      '    pre.textContent = JSON.stringify(out);',
      '    document.body.appendChild(pre);',
      '  }, 30);',
      '});',
      '</script>',
    ].join('\n');
    const html = readFileSync(join(dir, 'dashboard', 'index.html'), 'utf8').replace('</body>', `${probe}\n</body>`);
    writeFileSync(join(dir, 'dashboard', 'index.html'), html);
    const url = `file:///${join(dir, 'dashboard', 'index.html').split('\\').join('/')}`;
    const dom = execFileSync(
      browser,
      ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--virtual-time-budget=8000', '--dump-dom', url],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 },
    );
    const match = dom.match(/<pre id="probe">([\s\S]*?)<\/pre>/);
    if (!match) return { ok: false, detail: 'the page did not report its numbers: the probe did not run' };
    const report = JSON.parse(unescapeHtml(match[1]));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const valueProblems = [];
    for (const [slug, pageValue, boardValue] of report.values) {
      if (Math.abs(pageValue - boardValue) > 1) valueProblems.push(`${slug}: page ${pageValue}, board ${boardValue}`);
    }
    const planProblems = [];
    for (const [slug, plan] of report.plans) {
      const row = bySlug.get(slug);
      if (!row) {
        planProblems.push(`${slug}: not in board.json`);
        continue;
      }
      if (JSON.stringify(plan) !== JSON.stringify(row.farm_steps)) planProblems.push(`${slug}: the page's plan differs from board.json's`);
    }
    const ok = valueProblems.length === 0 && planProblems.length === 0 && report.values.length === rows.length && report.plans.length === rows.length;
    return {
      ok,
      detail: ok
        ? `${report.values.length}/${rows.length} values recomputed from the fitted model and matched, ${report.plans.length}/${rows.length} rendered plans identical to board.json`
        : `${valueProblems.length} value mismatches, ${planProblems.length} plan mismatches: ${[...valueProblems, ...planProblems].slice(0, 3).join('; ')}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let page = { ok: null, detail: 'not run' };
try {
  page = browserCheck();
} catch (error) {
  page = { ok: false, detail: `the browser check failed: ${error && error.message ? error.message : error}` };
}
check('page_arithmetic', page.ok === true, page.ok === null ? `skipped: ${page.detail}` : page.detail);

// ---------------------------------------------------------------- report

const pad = (text, width) => (text.length >= width ? text : text + ' '.repeat(width - text.length));
let failed = 0;
process.stdout.write('\n');
for (const item of checks) {
  const label = item.ok === null ? 'SKIP' : item.ok ? 'PASS' : 'FAIL';
  if (item.ok === false) failed += 1;
  process.stdout.write(`${label}  ${pad(item.id, 18)} ${item.detail}\n`);
}
process.stdout.write(`\n${checks.filter((c) => c.ok === true).length}/${checks.filter((c) => c.ok !== null).length} run checks passed${failed ? `, ${failed} failed` : ''}.\n`);
process.exit(failed === 0 ? 0 : 1);
