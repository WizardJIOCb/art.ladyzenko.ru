/* ===== Школа рисования Анны Калимуллиной — скрипты ===== */

(function () {
  "use strict";

  /* ---- Липкая шапка ---- */
  const header = document.querySelector(".site-header");
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- Мобильное меню ---- */
  const navToggle = document.getElementById("nav-toggle");
  const mainNav = document.getElementById("main-nav");
  navToggle.addEventListener("click", () => {
    const open = mainNav.classList.toggle("is-open");
    navToggle.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  });
  mainNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mainNav.classList.remove("is-open");
      navToggle.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  /* ---- Появление блоков ---- */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -50px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---- Параллакс в hero ---- */
  const parallaxEls = document.querySelectorAll("[data-parallax]");
  if (window.matchMedia("(pointer: fine)").matches) {
    let ticking = false;
    window.addEventListener("mousemove", (e) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const cx = e.clientX / window.innerWidth - 0.5;
        const cy = e.clientY / window.innerHeight - 0.5;
        parallaxEls.forEach((el) => {
          const depth = parseFloat(el.dataset.parallax);
          el.style.transform = `translate(${cx * depth * 120}px, ${cy * depth * 120}px)`;
        });
        ticking = false;
      });
    });
  }

  /* ---- Слайдер отзывов ---- */
  const track = document.getElementById("track");
  const slides = Array.from(track.children);
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const dotsWrap = document.getElementById("dots");
  let current = 0;
  let autoTimer = null;

  const goTo = (index) => {
    current = (index + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle("is-active", i === current));
    dotsWrap.querySelectorAll("button").forEach((d, i) => {
      d.classList.toggle("is-active", i === current);
    });
    track.style.transform = `translateX(-${current * 100}%)`;
  };

  if (slides.length) {
    slides.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.setAttribute("aria-label", `Отзыв ${i + 1}`);
      dot.addEventListener("click", () => { goTo(i); restartAuto(); });
      dotsWrap.appendChild(dot);
    });

    const restartAuto = () => {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => goTo(current + 1), 6000);
    };
    prevBtn.addEventListener("click", () => { goTo(current - 1); restartAuto(); });
    nextBtn.addEventListener("click", () => { goTo(current + 1); restartAuto(); });
    goTo(0);
    restartAuto();
  }

  /* ---- Галерея / лайтбокс ---- */
  const lightbox = document.getElementById("lightbox");
  const lightboxBody = document.getElementById("lightbox-body");
  const lightboxClose = document.getElementById("lightbox-close");
  const galleryItems = document.querySelectorAll(".gallery-item");

  const openLightbox = (item) => {
    const art = item.querySelector(".art").cloneNode(true);
    const title = item.dataset.title || "";
    lightboxBody.innerHTML = "";
    lightboxBody.appendChild(art);
    if (title) {
      const cap = document.createElement("div");
      cap.className = "lightbox-caption";
      cap.textContent = title;
      lightboxBody.appendChild(cap);
    }
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  };
  const closeLightbox = () => {
    lightbox.hidden = true;
    document.body.style.overflow = "";
  };

  galleryItems.forEach((item) => item.addEventListener("click", () => openLightbox(item)));
  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });

  /* Форму обрабатывает /shared/leads.js. */

  /* ---- Год ---- */
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
