import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('public');
const origin = 'https://art.ladyzenko.ru';
let count = 0;
for (const path of ['/', '/new/', '/new2/', '/404.html']) {
  const html = readFileSync(resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path)), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const match of html.matchAll(/\b(?:src|href|data-src)="([^"]+)"/g)) {
    const ref = match[1];
    if (ref.startsWith('#')) {
      assert(ids.has(ref.slice(1)), `${path}: missing anchor ${ref}`);
      continue;
    }
    const url = new URL(ref, origin + path);
    if (url.origin !== origin) continue;
    let file = resolve(root, '.' + url.pathname);
    if (url.pathname.endsWith('/')) file = resolve(file, 'index.html');
    assert(file.startsWith(root + '\\') || file.startsWith(root + '/'), 'Path outside public');
    assert(existsSync(file), `${path}: missing local resource ${ref}`);
    count++;
  }
}
console.log(`PASS: three pages and 404, ${count} local references, all anchors resolved`);
