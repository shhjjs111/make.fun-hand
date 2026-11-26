// Token Radar v14: the entry's program.
//
//   node main.ts --input /input/snapshot.json
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input D:/.../input/snapshot.json
//
// Reads the sealed snapshot, fits the launch-radar value and odds models, scores every pre-token
// protocol, derives the farm verdict and ten-step plan, and writes board.json, data.js, the dashboard,
// the screenshots and the dossier. Node 22, standard library only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildRadar, dataScript, fitModel, fnv1a, parseSnapshot } from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';
import { farmPlan, farmVerdict, shortUsd } from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAP_BYTES = 524_288;
const SCREENSHOT_MAX = 4;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304;
const LONG_SIDE_MAX = 1440;
const SHORT_SIDE_MIN = 800;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const equals = process.argv.find((a: string) => a.startsWith(`--${name}=`));
  return equals === undefined ? fallback : equals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
  throw new Error(message);
}

function snapshotPath(): string {
  const input = arg('input', '/input');
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

function copyFiles(from: string, to: string, what: string): string[] {
  if (!existsSync(from)) fail(`no ${what}/ directory at ${from}`);
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (!PLAIN_NAME.test(name)) fail(`${what}/${name}: a file name is letters, digits and . _ -, starting with a letter, digit or _`);
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  if (copied.length === 0) fail(`${what}/ is empty`);
  return copied;
}

function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue; }
      const marker = bytes[at + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = bytes.readUInt16BE(at + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      if (length < 2) break;
      at += 2 + length;
    }
  }
  return null;
}

function checkScreenshots(dir: string, names: string[]): void {
  if (names.length < 3 || names.length > SCREENSHOT_MAX) fail(`screenshots/ holds ${names.length} images: hand in 3 or 4`);
  for (const name of names) {
    const bytes = readFileSync(join(dir, name));
    if (bytes.length > SCREENSHOT_CAP_BYTES) fail(`screenshots/${name} is ${bytes.length} bytes: the cap is ${SCREENSHOT_CAP_BYTES}`);
    const size = imageSize(bytes);
    if (size === null) fail(`screenshots/${name} is not a whole PNG or JPEG`);
    const longSide = Math.max(size.width, size.height);
    const shortSide = Math.min(size.width, size.height);
    if (longSide > LONG_SIDE_MAX || shortSide < SHORT_SIDE_MIN) fail(`screenshots/${name} is ${size.width}x${size.height}: the long side may be at most ${LONG_SIDE_MAX} and the short side at least ${SHORT_SIDE_MIN}`);
  }
}

function reportBoard(board: BoardRow[], snapshot: Snapshot, hash8: string, boardBytes: number): void {
  const onWatch = board.filter((row) => row.watchlist).length;
  const counts: Record<string, number> = {};
  for (const row of board) counts[row.farm_verdict] = (counts[row.farm_verdict] ?? 0) + 1;
  const top = board.slice(0, 5).map((row) => `#${row.rank} ${row.name} ${shortUsd(row.implied_value_usd)}`).join(' | ');
  const farms = board.filter((row) => row.farm_verdict === 'FARM').slice().sort((a, b) => b.farm_net_per_hour_usd - a.farm_net_per_hour_usd);
  process.stdout.write(
    `token radar: fit on ${snapshot.protocols.length} protocols; ${board.length} ranked (${onWatch} watchlist, ${board.length - onWatch} extension)\n` +
    `token radar: top 5: ${top}\n` +
    `token radar: verdicts ${counts.FARM ?? 0} FARM / ${counts.MARGINAL ?? 0} MARGINAL / ${counts.SKIP ?? 0} SKIP; top farm ${farms.slice(0, 5).map((r) => `${r.name} $${r.farm_net_per_hour_usd.toFixed(1)}/h`).join(', ')}\n` +
    `token radar: board.json ${boardBytes} bytes, fnv1a ${hash8} = dashboard ledger\n`,
  );
}

const inputFile = snapshotPath();
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const fit = fitModel(snapshot);
const board = buildBoard(snapshot, fit);

for (const row of board) {
  const input = {
    name: row.name, category: row.category, bucket: row.bucket, chains: row.chains,
    tvl_usd: row.tvl_usd, age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    value_if_launches_usd: row.value_if_launches_usd, as_of: snapshot.as_of,
  };
  row.farm_steps = farmPlan(input);
  Object.assign(row, farmVerdict(input));
}

const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

const boardText = `${JSON.stringify({ rows: board }, null, 0)}\n`;
const boardBytes = Buffer.byteLength(boardText, 'utf8');
const hash8 = fnv1a(Buffer.from(boardText, 'utf8'));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardText);

const radar = buildRadar(snapshot, fit, board, hash8);
const sourceNames = readdirSync(join(here, 'dashboard')).filter((n: string) => /\.(?:html|css|js|json|mjs|svg|md|txt)$/.test(n));
radar.source_files = sourceNames.length;
radar.source_bytes = sourceNames.reduce((sum: number, n: string) => sum + statSync(join(here, 'dashboard', n)).size, 0);
// The page does not need the 195 bootstrap ranges as a map: each row carries its own pair.
const serialized = JSON.parse(JSON.stringify(radar));
delete serialized.model.bootstrap.ranges;
writeFileSync(join(out, 'data.js'), dataScript(serialized));

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'), 'dashboard');
if (!dashboardFiles.includes('index.html')) fail('dashboard/ has no index.html');
for (const name of dashboardFiles) if (statSync(join(out, 'dashboard', name)).size > DASHBOARD_MAX_BYTES) fail(`dashboard/${name} is over the 4 MiB cap`);
if (dashboardFiles.length > DASHBOARD_MAX_FILES) fail(`dashboard/ holds ${dashboardFiles.length} files: the cap is ${DASHBOARD_MAX_FILES}`);

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'), 'screenshots');
checkScreenshots(join(out, 'screenshots'), shots);

const TEXT_SOURCE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
let sourceBytes = 0;
for (const name of dashboardFiles) if (TEXT_SOURCE.test(name)) sourceBytes += statSync(join(out, 'dashboard', name)).size;
if (sourceBytes + 600 > TEXT_MAX_BYTES) fail(`the dashboard's text source is ${sourceBytes} bytes: the dossier would cut it`);

const dossier = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_CAP_BYTES },
  dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
});
writeFileSync(join(out, 'dossier.json'), dossier);
const dossierText = JSON.parse(Buffer.from(dossier).toString('utf8')).text.length;
reportBoard(board, snapshot, hash8, boardBytes);
process.stdout.write(
  `token radar: model ${fit.version}; base ${fit.base_multiple.toFixed(6)}, slope ${fit.size_slope.toFixed(6)}, odds b0 ${fit.odds.b0.toFixed(6)}\n` +
  `token radar: miss ${fit.evidence.loo_miss}x LOO / ${fit.evidence.wf_miss}x WF vs flat ${fit.evidence.flat_loo}x / ${fit.evidence.flat_wf}x; Brier ${fit.evidence.brier} / ${fit.evidence.brier_wf}\n` +
  `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files, ${sourceBytes} bytes of source), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes, ${dossierText} bytes of text)\n`,
);
