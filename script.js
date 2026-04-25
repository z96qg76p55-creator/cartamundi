// ═══════════════════════════════════════════════════════════
//  CARTAMUNDI — script.js
// ═══════════════════════════════════════════════════════════

window.addEventListener('load', () => {
  gsap.registerPlugin(ScrollTrigger);
  initStarfield();
  initLanding();
  initNav();
  initAccordions();
  initTimeline();
  initReveal();
  initCounters();
});

// ─── CANVAS STARFIELD ────────────────────────────────────
function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');

  let W, H, stars;
  let mouse   = { x: -9999, y: -9999 };
  let scrollY = 0;
  const CURSOR_RADIUS   = 120;
  const CURSOR_STRENGTH = 0.28;
  const STAR_COUNT      = 320;
  const PARALLAX_FACTOR = 0.25;

  // Star colours — mostly white/blue-white, hints of warm
  const COLORS = [
    'rgba(255,255,255,',
    'rgba(200,220,255,',
    'rgba(255,240,200,',
    'rgba(180,210,255,',
  ];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeStar() {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      ox:       Math.random() * W,   // origin x
      oy:       Math.random() * H,   // origin y
      x:        0,
      y:        0,
      r:        Math.random() * 1.4 + 0.3,
      alpha:    Math.random() * 0.6 + 0.3,
      twinkle:  Math.random() * Math.PI * 2,
      speed:    Math.random() * 0.008 + 0.003,
      color,
      vx: 0,   // cursor velocity
      vy: 0,
    };
  }

  function init() {
    resize();
    stars = Array.from({ length: STAR_COUNT }, makeStar);
    stars.forEach(s => { s.x = s.ox; s.y = s.oy; });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const parallaxOffset = scrollY * PARALLAX_FACTOR;

    stars.forEach(s => {
      // twinkle
      s.twinkle += s.speed;
      const tw = 0.5 + 0.5 * Math.sin(s.twinkle);
      const a  = s.alpha * (0.6 + 0.4 * tw);

      // cursor attraction
      const dx   = mouse.x - s.x;
      const dy   = mouse.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < CURSOR_RADIUS) {
        const force = (1 - dist / CURSOR_RADIUS) * CURSOR_STRENGTH;
        s.vx += dx * force * 0.06;
        s.vy += dy * force * 0.06;
      }

      // dampen velocity — drift back to origin
      s.vx *= 0.88;
      s.vy *= 0.88;
      s.x  += s.vx;
      s.y  += s.vy;

      // parallax: stars shift upward slightly as you scroll
      const drawY = s.y - parallaxOffset % H;

      // draw star
      const grd = ctx.createRadialGradient(s.x, drawY, 0, s.x, drawY, s.r * 2.5);
      grd.addColorStop(0, s.color + a + ')');
      grd.addColorStop(1, s.color + '0)');

      ctx.beginPath();
      ctx.arc(s.x, drawY, s.r * (1 + 0.3 * tw), 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // bright stars get a cross-hair gleam
      if (s.r > 1.2) {
        ctx.strokeStyle = s.color + (a * 0.3) + ')';
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 4, drawY);
        ctx.lineTo(s.x + s.r * 4, drawY);
        ctx.moveTo(s.x, drawY - s.r * 4);
        ctx.lineTo(s.x, drawY + s.r * 4);
        ctx.stroke();
      }
    });

    requestAnimationFrame(draw);
  }

  // events
  window.addEventListener('resize', () => { resize(); stars.forEach(s => { s.ox = Math.random() * W; s.oy = Math.random() * H; s.x = s.ox; s.y = s.oy; }); });
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });
  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

  init();
  draw();
}

// ─── LANDING ANIMATION ───────────────────────────────────
function initLanding() {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#landing',
      start: 'top top',
      end: '+=500%',
      scrub: 1.2,
      pin: true,
      anticipatePin: 1,
    }
  });

  tl
    // Beat 0→1: fan cards out
    .to('#card-1', { rotation: -44, x: -310, y: 35, scale: 0.93, duration: 1 }, 0)
    .to('#card-2', { rotation: -22, x: -155, y: 14, duration: 1 }, 0)
    .to('#card-3', { y: -28, scale: 1.07, duration: 1 }, 0)
    .to('#card-4', { rotation: 22,  x: 155,  y: 14, duration: 1 }, 0)
    .to('#card-5', { rotation: 44,  x: 310,  y: 35, scale: 0.93, duration: 1 }, 0)
    .to('#scroll-indicator', { opacity: 0, duration: 0.3 }, 0)

    // Beat 1→2: first text
    .to('#text-1', { opacity: 1, y: 0, duration: 0.5 }, 1.3)

    // Beat 2→3: swap text
    .to('#text-1', { opacity: 0, y: -24, duration: 0.4 }, 2.2)
    .to('#text-2', { opacity: 1, y: 0,   duration: 0.5 }, 2.6)

    // Beat 3→4: exit cards, reveal logo
    .to('#text-2',  { opacity: 0, y: -24, duration: 0.4 }, 3.5)
    .to('#card-1',  { y: -1000, opacity: 0, duration: 0.7 }, 3.55)
    .to('#card-5',  { y: -1000, opacity: 0, duration: 0.7 }, 3.55)
    .to('#card-2',  { y: -1000, opacity: 0, duration: 0.7 }, 3.65)
    .to('#card-4',  { y: -1000, opacity: 0, duration: 0.7 }, 3.65)
    .to('#card-3',  { y: -1000, opacity: 0, duration: 0.8 }, 3.60)
    .to('#landing-logo', { opacity: 1, duration: 0.9 }, 4.1)

    // Final pause
    .to({}, { duration: 0.6 }, 5.0);
}

// ─── NAVIGATION ──────────────────────────────────────────
function initNav() {
  const nav   = document.getElementById('main-nav');
  const links = document.querySelectorAll('.nav-link');
  const sections = ['ontstaan', 'groei', 'nu', 'toekomst'];

  ScrollTrigger.create({
    trigger: '#ontstaan',
    start: 'top 85%',
    onEnter:     () => nav.classList.add('visible'),
    onLeaveBack: () => nav.classList.remove('visible'),
  });

  sections.forEach(id => {
    ScrollTrigger.create({
      trigger: `#${id}`,
      start: 'top center',
      end:   'bottom center',
      onEnter:     () => setActive(id),
      onEnterBack: () => setActive(id),
    });
  });

  function setActive(id) {
    links.forEach(l => l.classList.toggle('active', l.dataset.section === id));
  }
}

// ─── ACCORDIONS ──────────────────────────────────────────
function initAccordions() {
  document.querySelectorAll('.accordion').forEach(accordion => {
    const sectionId = accordion.id.replace('accordion-', '');
    const img       = document.getElementById(`accordion-img-${sectionId}`);
    const fallback  = img ? img.nextElementSibling : null;

    accordion.querySelectorAll('.accordion-item').forEach(item => {
      item.querySelector('.accordion-trigger').addEventListener('click', () => {
        const wasActive = item.classList.contains('active');

        // close all
        accordion.querySelectorAll('.accordion-item').forEach(i => {
          i.classList.remove('active');
          i.querySelector('.accordion-trigger').setAttribute('aria-expanded', 'false');
        });

        if (!wasActive) {
          item.classList.add('active');
          item.querySelector('.accordion-trigger').setAttribute('aria-expanded', 'true');

          // swap image
          if (img && item.dataset.image) {
            img.style.opacity   = '0';
            img.style.transform = 'scale(1.04)';
            setTimeout(() => {
              img.src = item.dataset.image;
              img.onload = () => {
                img.style.display   = 'block';
                img.style.opacity   = '1';
                img.style.transform = 'scale(1)';
                if (fallback) fallback.style.display = 'none';
              };
              img.onerror = () => {
                img.style.display = 'none';
                if (fallback) {
                  fallback.style.background = getFallback(item.dataset.imageFallback);
                  fallback.style.display    = 'flex';
                }
                img.style.opacity   = '1';
                img.style.transform = 'scale(1)';
              };
            }, 160);
          } else if (img && !item.dataset.image) {
            // stat counter item — show fallback gradient
            img.style.display = 'none';
            if (fallback) {
              fallback.style.background = getFallback(item.dataset.imageFallback);
              fallback.style.display    = 'flex';
            }
          }

          // trigger counters if visible
          triggerCounters();
        }
      });
    });
  });
}

function getFallback(name) {
  return ({
    'grad-red':    'linear-gradient(135deg,#E30613 0%,#7a0009 100%)',
    'grad-blue':   'linear-gradient(135deg,#1a3a8f 0%,#0f2460 100%)',
    'grad-purple': 'linear-gradient(135deg,#4a1a8f 0%,#1a0460 100%)',
    'grad-gold':   'linear-gradient(135deg,#b8860b 0%,#5a4000 100%)',
    'grad-green':  'linear-gradient(135deg,#1a6b3a 0%,#0a3020 100%)',
    'grad-teal':   'linear-gradient(135deg,#0d6b6b 0%,#062020 100%)',
  })[name] || 'linear-gradient(135deg,#E30613 0%,#7a0009 100%)';
}

// ─── TIMELINE ────────────────────────────────────────────
function initTimeline() {
  const nodes = document.querySelectorAll('.timeline-node');
  if (!nodes.length) return;

  // open first by default
  nodes[0].classList.add('active');

  nodes.forEach(node => {
    node.querySelector('.node-btn').addEventListener('click', () => {
      const wasActive = node.classList.contains('active');
      nodes.forEach(n => n.classList.remove('active'));
      if (!wasActive) {
        node.classList.add('active');
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  });
}

// ─── SCROLL REVEAL ───────────────────────────────────────
function initReveal() {
  const observer = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    }),
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ─── STAT COUNTERS ────────────────────────────────────────
let countersRan = false;

function initCounters() {
  // will be triggered when the omzet accordion item opens
}

function triggerCounters() {
  if (countersRan) return;
  const omzetItem = document.querySelector('#accordion-nu .accordion-item.active [id="counter-employees"]');
  if (!omzetItem) return;
  countersRan = true;

  animateCount('counter-employees', 3000, '+');
  animateCount('counter-countries', 20,   '+');
  animateCount('counter-factories', 13,   '');
}

function animateCount(id, target, suffix) {
  const el = document.getElementById(id);
  if (!el) return;
  let start = null;
  const duration = 1800;

  function step(ts) {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target) + (progress === 1 ? suffix : '');
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
