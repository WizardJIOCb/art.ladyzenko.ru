/* =========================================================
   Школа рисования Анны Калимуллиной — behaviour
   Vanilla JS, no dependencies. Progressive enhancement.
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Header + scroll progress ---------- */
  var header = document.getElementById('siteHeader');
  var bar = document.getElementById('scrollBar');

  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (header) header.classList.toggle('is-scrolled', y > 24);

    if (bar) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, y / max) : 0;
      bar.style.width = (p * 100).toFixed(2) + '%';
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 2. Reveal on scroll ---------- */
  var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  revealItems.forEach(function (el) {
    var delay = el.getAttribute('data-delay');
    if (delay) el.style.setProperty('--d', delay);
  });

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    revealItems.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- 3. Active nav link ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var sections = navLinks.map(function (link) {
    return document.querySelector(link.getAttribute('href'));
  }).filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (section) { sectionObserver.observe(section); });
  }

  /* ---------- 4. Mobile menu ---------- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');

  function closeMenu() {
    if (!nav || !burger) return;
    nav.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Открыть меню');
    if (header) header.classList.remove('is-menu-open');
    document.body.classList.remove('is-locked');
  }

  function openMenu() {
    if (!nav || !burger) return;
    nav.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Закрыть меню');
    if (header) header.classList.add('is-menu-open');
    document.body.classList.add('is-locked');
  }

  if (burger && nav) {
    burger.addEventListener('click', function () {
      if (burger.getAttribute('aria-expanded') === 'true') closeMenu();
      else openMenu();
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  }

  /* ---------- 5. Gallery lightbox ---------- */
  var lightbox = document.getElementById('lightbox');
  var lightboxImg = document.getElementById('lightboxImg');
  var lightboxCap = document.getElementById('lightboxCap');
  var lightboxClose = document.getElementById('lightboxClose');
  var works = Array.prototype.slice.call(document.querySelectorAll('.work'));
  var lastFocused = null;

  function openLightbox(button) {
    if (!lightbox || !lightboxImg) return;
    lastFocused = button;
    lightboxImg.src = button.getAttribute('data-src');
    lightboxImg.alt = button.querySelector('img') ? button.querySelector('img').alt : '';
    lightboxCap.textContent = button.getAttribute('data-title') || '';
    lightbox.hidden = false;
    document.body.classList.add('is-locked');
    if (lightboxClose) lightboxClose.focus();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    document.body.classList.remove('is-locked');
    if (lastFocused) lastFocused.focus();
  }

  works.forEach(function (button) {
    button.addEventListener('click', function () { openLightbox(button); });
  });

  if (lightbox) {
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });
  }
  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lightbox && !lightbox.hidden) closeLightbox();
  });

  /* ---------- 6. FAQ: one open at a time ---------- */
  var faqItems = Array.prototype.slice.call(document.querySelectorAll('.faq-item'));
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ---------- 7. Booking form ---------- */
  var form = document.getElementById('bookingForm');

  function digits(value) { return (value || '').replace(/\D/g, ''); }

  function setInvalid(field, invalid) {
    if (!field) return;
    field.classList.toggle('is-invalid', invalid);
    var input = field.querySelector('input, select, textarea');
    if (input) input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  }

  if (form) {
    var nameField = document.getElementById('name');
    var phoneField = document.getElementById('phone');

    /* light phone mask: +7 XXX XXX-XX-XX */
    if (phoneField) {
      phoneField.addEventListener('input', function () {
        var d = digits(phoneField.value);
        if (d[0] === '8') d = '7' + d.slice(1);
        if (d[0] !== '7') d = '7' + d;
        d = d.slice(0, 11);

        var out = '+7';
        if (d.length > 1) out += ' ' + d.slice(1, 4);
        if (d.length >= 5) out += ' ' + d.slice(4, 7);
        if (d.length >= 8) out += '-' + d.slice(7, 9);
        if (d.length >= 10) out += '-' + d.slice(9, 11);
        phoneField.value = out;
      });
    }

    [nameField, phoneField].forEach(function (input) {
      if (!input) return;
      input.addEventListener('input', function () {
        setInvalid(input.closest('.field'), false);
      });
    });
  }

  /* ---------- 8. Hero art parallax ---------- */
  var stack = document.getElementById('artStack');
  if (stack && !reduceMotion && window.matchMedia('(hover: hover) and (min-width: 981px)').matches) {
    var layers = [
      { el: stack.querySelector('.canvas--main'), depth: 14 },
      { el: stack.querySelector('.canvas--back'), depth: 26 },
      { el: stack.querySelector('.canvas--small'), depth: 34 },
      { el: stack.querySelector('.paper-note'), depth: 42 }
    ].filter(function (l) { return l.el; });

    var rx = 0, ry = 0, tx = 0, ty = 0, frame = null;

    function render() {
      rx += (tx - rx) * 0.08;
      ry += (ty - ry) * 0.08;
      layers.forEach(function (l) {
        l.el.style.transform = 'translate3d(' + (rx * l.depth).toFixed(2) + 'px,' +
          (ry * l.depth).toFixed(2) + 'px,0)';
      });
      if (Math.abs(rx - tx) > 0.001 || Math.abs(ry - ty) > 0.001) {
        frame = requestAnimationFrame(render);
      } else {
        frame = null;
      }
    }

    function kick() { if (!frame) frame = requestAnimationFrame(render); }

    window.addEventListener('mousemove', function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      kick();
    }, { passive: true });
  }

  /* ---------- 9. Year in footer ---------- */
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
