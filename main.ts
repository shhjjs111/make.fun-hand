// Token Radar: the entry's program.
//
//   node main.ts --input /input/snapshot.json          (the grader mounts /input and /output)
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input D:/.../input/snapshot.json   (a local run)
//
// It reads the sealed snapshot, fits the valuation model to the protocols whose token already trades,
// scores every protocol whose record carries no token, and writes:
//
//   /output/board.json       the ranked board, one row per protocol, farm plan included
//   /output/data.js          the same inputs for the dashboard, so the page recomputes each value
//   /output/dashboard/       the static page (index.html, app.css, app.js)
//   /output/screenshots/     the three captured views
//   /output/dossier.json     what buildDossier writes from the four above, written last
//
// Node 22, the standard library only, erasable TypeScript: no build step and nothing installed.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildRadar, dataScript, fitModel, parseSnapshot } from './lib/model.ts';
import type { BoardRow, Snapshot } from './lib/model.ts';
import { farmPlan, shortUsd } from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text cap shapes the dossier's bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAP_BYTES = 524_288;
const SCREENSHOT_MAX = 4;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4_194_304;
const LONG_SIDE_MAX = 1440;
const SHORT_SIDE_MIN = 800;
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const equals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return equals === undefined ? fallback : equals.slice(name.length + 3);
}

/** Fail loudly with one line on stderr: the grader reads the exit code, not a stack trace. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** The snapshot's path: --input may name the file or the directory that holds it. */
function snapshotPath(): string {
  const input = arg('input', '/input');
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/** Copy one directory's regular, plainly named files into `to`, and return their names. */
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

/** A PNG's or a JPEG's pixel size, from its own header, or null when the file is not one. */
function imageSize(bytes: Buffer): { width: number; height: number; kind: string } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { kind: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = bytes[at + 1]!;
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

/**
 * The screenshots are the judge's first look at the page, so the program checks their shape itself:
 * three or four whole images, each inside the byte and pixel limits, before the dossier is written.
 */
function checkScreenshots(dir: string, names: string[]): void {
  if (names.length < 3 || names.length > SCREENSHOT_MAX) fail(`screenshots/ holds ${names.length} images: hand in 3 or 4`);
  for (const name of names) {
    const bytes = readFileSync(join(dir, name));
    if (bytes.length > SCREENSHOT_CAP_BYTES) fail(`screenshots/${name} is ${bytes.length} bytes: the cap is ${SCREENSHOT_CAP_BYTES}`);
    const size = imageSize(bytes);
    if (size === null) fail(`screenshots/${name} is not a whole PNG or JPEG`);
    const longSide = Math.max(size.width, size.height);
    const shortSide = Math.min(size.width, size.height);
    if (longSide > LONG_SIDE_MAX || shortSide < SHORT_SIDE_MIN) {
      fail(`screenshots/${name} is ${size.width}x${size.height}: the long side may be at most ${LONG_SIDE_MAX} and the short side at least ${SHORT_SIDE_MIN}`);
    }
  }
}

/** The board's own summary, printed so a local run shows what it ranked. */
function reportBoard(board: BoardRow[], snapshot: Snapshot): void {
  const onWatch = board.filter((row) => row.watchlist).length;
  const lines = [
    `token radar: fit on ${snapshot.protocols.length} protocols, ${onWatch} watchlist rows covered, ${board.length - onWatch} rows from below the floor`,
    `token radar: top 5: ${board.slice(0, 5).map((row) => `#${row.rank} ${row.name} ${shortUsd(row.implied_value_usd)}`).join(' | ')}`,
    `token radar: range ${shortUsd(board[board.length - 1]!.implied_value_usd)} to ${shortUsd(board[0]!.implied_value_usd)}, ${board.length} rows, ${board.filter((row) => row.watchlist).length} on the watchlist`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

const inputFile = snapshotPath();
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const fit = fitModel(snapshot);
const board = buildBoard(snapshot, fit);

// The farm plans are the board's own work: one plan per row, derived from the row.
for (const row of board) {
  row.farm_steps = farmPlan({
    name: row.name,
    category: row.category,
    bucket: row.bucket,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    age_days: row.age_days,
    rank: row.rank,
    implied_value_usd: row.implied_value_usd,
    as_of: snapshot.as_of,
    watchlist: row.watchlist,
  });
}

const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

const radar = buildRadar(snapshot, fit, board);
if (radar.rows.length !== board.length) fail(`the dashboard's data holds ${radar.rows.length} rows and the board ${board.length}`);
for (let i = 0; i < board.length; i++) {
  const row = radar.rows[i]!;
  if (row.slug !== board[i]!.slug) fail(`data row ${i + 1} is ${row.slug}, the board's is ${board[i]!.slug}`);
  if (row.plan.length !== board[i]!.farm_steps.length) fail(`${row.slug}: the page's plan and board.json's plan differ in length`);
  if (row.plan.some((step, at) => step !== board[i]!.farm_steps[at])) fail(`${row.slug}: the page's plan and board.json's plan differ`);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 0)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'), 'dashboard');
if (!dashboardFiles.includes('index.html')) fail('dashboard/ has no index.html');
for (const name of dashboardFiles) {
  if (statSync(join(out, 'dashboard', name)).size > DASHBOARD_MAX_BYTES) fail(`dashboard/${name} is over the 4 MiB cap`);
}
if (dashboardFiles.length > DASHBOARD_MAX_FILES) fail(`dashboard/ holds ${dashboardFiles.length} files: the cap is ${DASHBOARD_MAX_FILES}`);

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'), 'screenshots');
checkScreenshots(join(out, 'screenshots'), shots);

/** The page's own text files, the ones the dossier shows: their bytes are the budget the judge reads. */
const TEXT_SOURCE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;
let sourceBytes = 0;
for (const name of dashboardFiles) if (TEXT_SOURCE.test(name)) sourceBytes += statSync(join(out, 'dashboard', name)).size;
if (sourceBytes + 1_000 > TEXT_MAX_BYTES) fail(`the dashboard's text source is ${sourceBytes} bytes: the dossier would cut it`);

// The dossier goes last: the scorer rebuilds it from this /output and compares the bytes.
const dossier = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_CAP_BYTES },
  dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
});
writeFileSync(join(out, 'dossier.json'), dossier);

reportBoard(board, snapshot);
const dossierText = JSON.parse(Buffer.from(dossier).toString('utf8')).text.length;
process.stdout.write(
  `token radar: ${fit.version}; alpha ${fit.coefficients.alpha}, beta ${fit.coefficients.beta}, gamma ${fit.coefficients.gamma}, delta ${fit.coefficients.delta}; ${fit.training.n} training rows, ${fit.training.trimmed} trimmed\n` +
    `token radar: validation ${fit.validation.folds}-fold x ${fit.validation.repeats} on n=${fit.validation.n}: median error ${fit.validation.median_factor}x, R2 ${fit.validation.r2}, within 2x ${Math.round(fit.validation.within_2x * 100)}%\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files, ${sourceBytes} bytes of source), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes, ${dossierText} bytes of text)\n`,
);
