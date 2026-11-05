/* A small, dependency-free build choreography for real responsive HTML.
   Inspired by https://califa.github.io/swarm-site/; independently implemented. */
(function () {
  'use strict';
  const html = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controls = document.getElementById('buildControls');
  const canvas = document.getElementById('buildOverlay');
  const ctx = canvas.getContext('2d');
  if (!ctx || !('IntersectionObserver' in window)) {
    html.classList.remove('swarm-boot');
    return;
  }
  const status = document.getElementById('buildStatus');
  const count = document.getElementById('buildCount');
  const stop = document.getElementById('buildStop');
  const replay = document.getElementById('buildReplay');
  const colors = ['#B5482B', '#256F70', '#967024', '#786398', '#357953', '#C66786'];
  const roles = ['Композиция', 'Типографика', 'Акварель', 'Детали', 'Ритм', 'Палитра'];
  const selector = [
    '.site-header .brand', '.hero-copy > *', '.art-stack > *', '.hero-bottom',
    '.marquee', '.section-head', '.portrait-card', '.quote-card', '.about-text > *',
    '.card', '.steps > li', '.process-note', '.work', '.review', '.price-card',
    '.price-extra', '.faq-item', '.contact-copy > *', '.contact-form-wrap',
    '.footer-inner > *', '.footer-bottom'
  ].join(',');
  const tasks = Array.from(document.querySelectorAll(selector)).map((el, index) => {
    el.classList.add('swarm-piece');
    const heading = el.matches('h1,h2') ? el : el.querySelector('h1,h2');
    return { el, index, heading, letters: [], state: 'pending', elapsed: 0,
      kind: heading ? 'text' : el.matches('.canvas,.portrait-card,.work') ? 'image' : 'layout',
      duration: heading ? 1.6 : el.matches('.canvas,.work') ? 1.45 : 1.1 };
  });
  const byElement = new Map(tasks.map(task => [task.el, task]));
  let queue = [], workers = [], enabled = false, frame = 0, last = 0, completed = 0, observer;
  let vw = innerWidth, vh = innerHeight;

  function splitHeading(task) {
    if (!task.heading || task.letters.length) return;
    const originalText = task.heading.innerText.replace(/\s+/g, ' ').trim();
    const walker = document.createTreeWalker(task.heading, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('svg') || !node.textContent.trim()
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const fragment = document.createDocumentFragment();
      // Keep word spacing and the original markup, including line breaks and SVGs.
      for (const letter of node.textContent) {
        if (/\s/.test(letter)) fragment.appendChild(document.createTextNode(letter));
        else {
          const span = document.createElement('span');
          span.className = 'swarm-letter';
          span.setAttribute('aria-hidden', 'true');
          span.textContent = letter;
          task.letters.push(span);
          fragment.appendChild(span);
        }
      }
      node.replaceWith(fragment);
    });
    const accessibleText = document.createElement('span');
    accessibleText.className = 'swarm-sr';
    accessibleText.textContent = originalText;
    task.heading.appendChild(accessibleText);
  }

  function resize() {
    vw = innerWidth; vh = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wake();
  }

  function updateStatus() {
    html.dataset.swarmCompleted = String(completed);
    html.dataset.swarmActive = String(workers.length);
    controls.classList.toggle('is-resting', !workers.length);
    status.textContent = !enabled ? 'Мастерская собрана' : workers.length ? 'Собираем мастерскую' : 'Листайте — продолжим ниже';
    count.textContent = completed + ' / ' + tasks.length + ' деталей на своих местах';
  }

  function finish(task) {
    if (task.state === 'done') return;
    task.state = 'done'; completed++;
    task.el.classList.remove('swarm-pending', 'swarm-working', 'swarm-typing');
    task.el.classList.add('swarm-complete');
    ['opacity', 'translate', 'clip-path'].forEach(property => task.el.style.removeProperty(property));
    task.letters.forEach(letter => letter.style.removeProperty('opacity'));
    if (observer) observer.unobserve(task.el);
  }

  function enqueue(task) {
    if (!enabled || task.state !== 'pending') return;
    task.state = 'queued'; queue.push(task);
    wake();
  }

  function observe() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const task = byElement.get(entry.target);
        if (entry.isIntersecting) enqueue(task);
      });
    }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
    tasks.forEach(task => { if (task.state === 'pending') observer.observe(task.el); });
  }

  function begin(task) {
    task.state = 'working'; task.elapsed = 0;
    task.el.classList.remove('swarm-pending');
    task.el.classList.add('swarm-working');
    if (task.heading) task.el.classList.add('swarm-typing');
    const slot = task.index % colors.length;
    const bounds = task.el.getBoundingClientRect();
    workers.push({ task, color: colors[slot], role: roles[slot],
      startX: Math.max(18, Math.min(vw - 24, bounds.left + bounds.width * .5 + (slot % 2 ? 100 : -100))),
      startY: Math.max(100, Math.min(vh - 60, bounds.top - 80)) });
  }

  const ease = value => 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);
  const mix = (a, b, p) => a + (b - a) * p;

  function drawCursor(x, y, worker, alpha, pressing) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(Math.max(4, Math.min(vw - 14, x)), Math.max(4, Math.min(vh - 20, y)));
    ctx.scale(pressing ? .87 : 1, pressing ? .87 : 1);
    ctx.shadowColor = '#1B191730'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, 22); ctx.lineTo(10, 14);
    ctx.lineTo(20, 12); ctx.closePath(); ctx.fillStyle = worker.color;
    ctx.fill(); ctx.strokeStyle = '#FBF8F2'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    const label = worker.role;
    ctx.font = '600 10px system-ui, sans-serif';
    const width = ctx.measureText(label).width + 14;
    const left = x + width + 24 > vw ? -width - 8 : 14;
    ctx.fillStyle = worker.color;
    ctx.beginPath(); ctx.roundRect(left, 24, width, 21, 3); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(label, left + 7, 38);
    ctx.restore();
  }

  function drawWork(worker, p, rect) {
    const task = worker.task;
    const x = rect.left, y = rect.top, w = rect.width, h = rect.height;
    const alpha = Math.min(1, p * 8, (1 - p) * 7);
    const draw = Math.max(0, Math.min(1, (p - .1) / .5));
    // Drafting guides and a selection box track the real responsive DOM bounds.
    ctx.save(); ctx.globalAlpha = alpha * .7; ctx.strokeStyle = worker.color;
    ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    if (vw > 700) {
      ctx.globalAlpha = alpha * .18;
      ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(vw - 24, y);
      ctx.moveTo(x, 88); ctx.lineTo(x, vh - 24); ctx.stroke();
      ctx.globalAlpha = alpha * .7;
    }
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    ctx.setLineDash([]);
    const perimeter = 2 * (w + h + 12);
    ctx.setLineDash([perimeter * draw, perimeter]);
    ctx.lineWidth = 1.5; ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    ctx.setLineDash([]); ctx.fillStyle = '#FBF8F2';
    [[x - 5, y - 5], [x + w + 1, y - 5], [x - 5, y + h + 1], [x + w + 1, y + h + 1]].forEach(([cx, cy]) => {
      ctx.fillRect(cx, cy, 4, 4); ctx.strokeRect(cx, cy, 4, 4);
    });
    ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = worker.color;
    if (w > 120 && y > 110) ctx.fillText(Math.round(w) + ' × ' + Math.round(h), x + 3, y - 10);
    ctx.restore();

    let targetX, targetY;
    if (task.kind === 'text' && task.letters.length && p > .2) {
      const typed = Math.min(task.letters.length, Math.floor((p - .2) / .65 * task.letters.length));
      if (typed !== task.typed) {
        task.letters.forEach((letter, index) => { letter.style.opacity = index < typed ? '1' : '0'; });
        task.typed = typed;
      }
      const caret = task.letters[Math.max(0, typed - 1)].getBoundingClientRect();
      targetX = caret.right + 3; targetY = caret.bottom - 4;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = worker.color;
      ctx.fillRect(caret.right + 2, caret.top + 2, 2, Math.max(12, caret.height - 4)); ctx.restore();
    } else {
      const trace = draw * 4;
      if (trace < 1) { targetX = x + w * trace; targetY = y; }
      else if (trace < 2) { targetX = x + w; targetY = y + h * (trace - 1); }
      else if (trace < 3) { targetX = x + w * (3 - trace); targetY = y + h; }
      else { targetX = x; targetY = y + h * (4 - trace); }
      if (p > .65) { targetX = x + w * .72; targetY = y + Math.min(h * .6, 120); }
    }
    const arrival = ease(p / .2);
    drawCursor(mix(worker.startX, targetX, arrival), mix(worker.startY, targetY, arrival), worker, alpha, p > .55 && p < .62);
    if (task.kind === 'text') task.el.style.opacity = p < .18 ? '0' : '1';
    else {
      const reveal = ease((p - .2) / .6);
      task.el.style.opacity = String(reveal);
      task.el.style.translate = '0 ' + ((1 - reveal) * 18).toFixed(2) + 'px';
      if (task.kind === 'image') task.el.style.clipPath = 'inset(0 ' + ((1 - reveal) * 100).toFixed(2) + '% 0 0)';
    }
  }

  function tick(now) {
    frame = 0;
    if (!enabled || document.hidden) return;
    const dt = last ? Math.min((now - last) / 1000, .05) : 0;
    last = now;
    const limit = vw < 700 ? 3 : 6;
    while (workers.length < limit && queue.length) {
      const task = queue.shift();
      if (task.state !== 'queued') continue;
      const rect = task.el.getBoundingClientRect();
      if (rect.bottom < 0) { finish(task); continue; }
      if (rect.top > vh) { task.state = 'pending'; continue; }
      begin(task);
    }
    ctx.clearRect(0, 0, vw, vh);
    workers = workers.filter(worker => {
      const task = worker.task;
      const rect = task.el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh || task.state === 'done') { finish(task); return false; }
      task.elapsed += dt;
      const p = Math.min(1, task.elapsed / task.duration);
      if (p === 1) { finish(task); return false; }
      drawWork(worker, p, rect);
      return true;
    });
    updateStatus();
    if (workers.length || queue.length) frame = requestAnimationFrame(safeTick);
    else { last = 0; ctx.clearRect(0, 0, vw, vh); }
  }

  function wake() {
    if (enabled && !frame && !document.hidden) { last = 0; frame = requestAnimationFrame(safeTick); }
  }

  function safeTick(now) {
    try { tick(now); }
    catch (error) { showAll(); controls.hidden = true; console.error('Build animation:', error); }
  }

  function showAll() {
    enabled = false;
    if (observer) observer.disconnect();
    cancelAnimationFrame(frame); frame = 0; last = 0;
    queue = []; workers = [];
    tasks.forEach(finish);
    ctx.clearRect(0, 0, vw, vh);
    html.classList.remove('swarm-boot', 'swarm-on');
    html.classList.add('swarm-off');
    stop.disabled = true;
    updateStatus();
  }

  function start() {
    html.dataset.swarmTotal = String(tasks.length);
    if (motion.matches) { showAll(); controls.hidden = true; return; }
    enabled = true; completed = 0; queue = []; workers = [];
    cancelAnimationFrame(frame); frame = 0; last = 0;
    tasks.forEach(task => {
      splitHeading(task);
      task.state = 'pending'; task.elapsed = 0; task.typed = -1;
      task.el.classList.remove('swarm-working', 'swarm-typing', 'swarm-complete');
      task.el.classList.add('swarm-pending');
      ['opacity', 'translate', 'clip-path'].forEach(property => task.el.style.removeProperty(property));
      task.letters.forEach(letter => letter.style.removeProperty('opacity'));
    });
    html.classList.remove('swarm-boot', 'swarm-off');
    html.classList.add('swarm-on');
    html.dataset.swarmReady = 'true';
    html.dataset.swarmTotal = String(tasks.length);
    controls.hidden = false; stop.disabled = false;
    resize(); observe(); updateStatus();
  }

  stop.addEventListener('click', showAll);
  replay.addEventListener('click', () => {
    if (motion.matches) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    start();
  });
  document.addEventListener('focusin', event => {
    const piece = event.target.closest('.swarm-piece');
    if (piece && enabled) { finish(byElement.get(piece)); updateStatus(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0; }
    else wake();
  });
  window.addEventListener('resize', resize, { passive: true });
  motion.addEventListener('change', () => { if (motion.matches) { showAll(); controls.hidden = true; } });
  // Fail open: initialization errors must never leave the school's content hidden.
  try { start(); } catch (error) { showAll(); controls.hidden = true; console.error('Build animation:', error); }
})();
