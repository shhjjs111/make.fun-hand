#!/usr/bin/env node
// Capture the entry's screenshots from the finished build, over the DevTools protocol, so the page is
// laid out at exactly the requested size before each frame (a plain --screenshot of a scrolled page can
// capture an unpainted frame). Node 24's global fetch and WebSocket, no dependency.
//
//   node tools/shoot.mjs --base file:///.../out/dashboard/index.html --out screenshots \
//     --shot 1-board.png:1440:900: --shot 2-detail.png:1440:900:#p=gauntlet
//
// A hash without '=' (such as #method) is scrolled to after load; a hash with '=' is the page's own
// routing (a protocol drawer, a filter). The tool exits non-zero if a shot cannot be written.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
function value(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
}
const base = value('base', '');
const outDir = value('out', 'screenshots');
const shots = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--shot') shots.push(args[i + 1]);
if (!base || shots.length === 0) {
  process.stderr.write('shoot: pass --base <url> and at least one --shot name:width:height:hash[:wait]\n');
  process.exit(2);
}

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = candidates.find((c) => c && existsSync(c));
if (!browser) {
  process.stderr.write('shoot: no Chromium found; pass CHROME_PATH\n');
  process.exit(2);
}

const port = 9333 + (process.pid % 200);
const profile = mkdtempSync(join(tmpdir(), 'token-radar-shoot-'));
const child = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(150);
  }
  throw new Error('DevTools did not start');
}

const page = await targets();
const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});
await new Promise((resolve) => socket.addEventListener('open', resolve));

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
let failed = 0;
for (const spec of shots) {
  const [name, width, height, hash = '', wait = '1400'] = spec.split(':');
  if (!name || !width || !height) {
    process.stderr.write(`shoot: bad --shot ${spec}\n`);
    failed += 1;
    continue;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await send('Page.navigate', { url: base + hash });
  await sleep(Number(wait));
  if (hash && !hash.includes('=')) {
    const id = hash.replace(/^#/, '');
    await send('Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'start' })` });
    await sleep(500);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (!shot.result || !shot.result.data) {
    process.stderr.write(`shoot: ${name} produced no frame\n`);
    failed += 1;
    continue;
  }
  const bytes = Buffer.from(shot.result.data, 'base64');
  writeFileSync(join(outDir, name), bytes);
  process.stdout.write(`shoot: ${name} ${width}x${height} ${Math.round(bytes.length / 1024)} KiB\n`);
}

socket.close();
child.kill();
await sleep(300);
rmSync(profile, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
