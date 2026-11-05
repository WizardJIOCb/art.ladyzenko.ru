import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
mkdirSync('.scratch', { recursive: true });
mkdirSync('shots', { recursive: true });
const profile = mkdtempSync(resolve('.scratch', 'chrome-'));
const port = 9600 + Math.floor(Math.random() * 300);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
chrome.on('error', error => { console.error(error); process.exitCode = 1; });
let ws;
try {
  let version;
  for (let i = 0; i < 80; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
    catch { await sleep(100); }
  }
  assert(version, 'Chrome devtools unavailable');
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400)
      errors.push({ status: message.params.response.status, url: message.params.response.url });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 20000);
    timer.unref();
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  for (const path of ['/', '/new/', '/new2/']) {
    for (const width of [1440, 390]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
      await command('Page.navigate', { url: base + path });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        ready = await evaluate(`location.href === ${JSON.stringify(base + path)} && document.readyState === 'complete'`);
        if (ready) break;
        await sleep(100);
      }
      assert(ready, `${path}: navigation did not complete`);
      await sleep(1000);
      const name = path === '/' ? 'main' : path.slice(1, -1);
      if (path === '/new2/') {
        assert(await evaluate(`document.documentElement.dataset.swarmReady === 'true'`), 'Build engine initialized');
        assert(await evaluate(`+document.documentElement.dataset.swarmTotal > 50`), 'Build targets present');
        const buildShot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
        writeFileSync(`shots/${name}-building-${width}.png`, Buffer.from(buildShot.data, 'base64'));
        await sleep(3200);
        assert(await evaluate(`getComputedStyle(document.querySelector('h1')).opacity === '1' && [...document.querySelectorAll('h1 .swarm-letter')].every(el => getComputedStyle(el).opacity === '1')`), 'Heading finishes typing');
        const before = await evaluate(`+document.documentElement.dataset.swarmCompleted`);
        await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('directions').scrollIntoView({behavior: 'instant'})`);
        await sleep(350);
        assert(await evaluate(`+document.documentElement.dataset.swarmActive > 0`), 'Scrolling starts new builders');
        await sleep(3000);
        assert(await evaluate(`+document.documentElement.dataset.swarmCompleted > ${before}`), 'Scroll builds more content');
        await evaluate(`document.getElementById('buildStop').click()`);
        assert(await evaluate(`!document.querySelector('.swarm-pending') && document.documentElement.classList.contains('swarm-off')`), 'Stop reveals all');
        await evaluate(`document.getElementById('buildReplay').click()`);
        await sleep(350);
        assert(await evaluate(`!!document.querySelector('.swarm-pending') && document.documentElement.classList.contains('swarm-on') && +document.documentElement.dataset.swarmActive > 0`), 'Replay restarts builders');
        await evaluate(`document.getElementById('buildStop').click()`);
      }
      const state = await evaluate(`({ title: document.title, heading: !!document.querySelector('h1'), overflow: document.documentElement.scrollWidth > innerWidth + 1, styles: [...document.styleSheets].length })`);
      assert(state.heading && state.styles && !state.overflow, JSON.stringify({ path, width, state }));
      if (width === 390) {
        const toggle = path === '/' ? 'nav-toggle' : 'burger';
        assert(await evaluate(`document.getElementById('${toggle}').click(); document.getElementById('${toggle}').getAttribute('aria-expanded') === 'true'`));
        await evaluate(`document.getElementById('${toggle}').click()`);
      }
      const shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(`shots/${name}-${width}.png`, Buffer.from(shot.data, 'base64'));
      await evaluate(`document.querySelector('${path === '/' ? '.gallery-item' : '.work'}').click()`);
      assert(await evaluate(`!document.getElementById('lightbox').hidden`));
      if (path !== '/') {
        await evaluate(`document.getElementById('lightboxImg').decode()`);
        assert(await evaluate(`document.getElementById('lightboxImg').naturalWidth > 0`));
      }
      await evaluate(`document.getElementById('${path === '/' ? 'lightbox-close' : 'lightboxClose'}').click()`);
      assert(await evaluate(`document.getElementById('lightbox').hidden`));
      if (path === '/') {
        await evaluate(`document.querySelectorAll('#dots button')[1].click()`);
        assert(await evaluate(`document.querySelectorAll('#dots button')[1].classList.contains('is-active')`));
      }
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('img[src]')).filter(i => i.complete && !i.naturalWidth).map(i => i.src)`), []);
      console.log(`PASS ${base}${path} ${width}px: layout, menu, gallery, resources`);
    }
  }
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await command('Page.navigate', { url: base + '/new2/' });
  await sleep(1400);
  assert(await evaluate(`document.documentElement.classList.contains('swarm-off') && !document.querySelector('.swarm-pending') && getComputedStyle(document.querySelector('h1')).opacity === '1'`), 'Reduced motion displays finished page');
  await command('Emulation.setEmulatedMedia', { features: [] });
  await command('Emulation.setScriptExecutionDisabled', { value: true });
  await command('Page.navigate', { url: base + '/new2/' });
  await sleep(1200);
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  assert(await evaluate(`!document.documentElement.classList.contains('swarm-boot') && getComputedStyle(document.querySelector('h1')).opacity === '1' && document.getElementById('buildControls').hidden`), 'No-JS fallback displays page');
  console.log('PASS /new2/: scroll building, typing, stop, replay, reduced motion, no JavaScript');
  assert.deepEqual(errors, [], 'Browser errors');
  await send('Browser.close');
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  chrome.kill();
}
