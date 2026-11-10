(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const params = new URLSearchParams(location.search);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || params.has('still');
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  /* ---------------- Brush toolkit ---------------- */
  const imgCache = new Map();
  const loadImage = (src) => {
    if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; }));
    return imgCache.get(src);
  };
  const samplerCache = new Map();
  function sampler(img, sw = 240) {
    const key = img.src + sw;
    if (samplerCache.has(key)) return samplerCache.get(key);
    const sh = Math.max(2, Math.round(sw * img.naturalHeight / img.naturalWidth));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, sw, sh);
    const d = x.getImageData(0, 0, sw, sh).data; // throws on file:// (tainted); callers fall back
    const L = (j) => d[j] * .3 + d[j + 1] * .59 + d[j + 2] * .11;
    const S = {
      sw, sh, small: c,
      at(u, v) {
        const sx = Math.min(sw - 2, Math.max(1, Math.round(u * sw)));
        const sy = Math.min(sh - 2, Math.max(1, Math.round(v * sh)));
        const i = (sy * sw + sx) * 4;
        const gx = L(i + 4) - L(i - 4), gy = L(i + sw * 4) - L(i - sw * 4);
        return { r: d[i], g: d[i + 1], b: d[i + 2], gx, gy, mag: Math.abs(gx) + Math.abs(gy), lum: L(i) };
      },
    };
    samplerCache.set(key, S);
    return S;
  }
  const coverUV = (S, w, h) => {
    const ia = S.sw / S.sh, ba = w / h;
    return (x, y) => {
      let u = x / w, v = y / h;
      if (ia > ba) { const k = ba / ia; u = (1 - k) / 2 + u * k; } else { const k = ia / ba; v = (1 - k) / 2 + v * k; }
      return [u, v];
    };
  };
  // One brush mark: a slightly curved fan of uneven bristles, loaded at the head and dry at the tail.
  function bristles(ctx, x, y, a, len, wid, style, alphaBase) {
    const n = Math.max(5, Math.min(11, Math.round(wid / 1.8)));
    const cos = Math.cos(a), sin = Math.sin(a), px = -sin, py = cos;
    const bend = (Math.random() - .5) * len * .28;
    ctx.lineCap = 'round';
    ctx.strokeStyle = style;
    for (let i = 0; i < n; i++) {
      if (Math.random() < .12) continue;
      const off = ((i + .5) / n - .5) * wid + (Math.random() - .5) * wid / n;
      const l0 = len * (.38 + Math.random() * .16), l1 = len * (.3 + Math.random() * .24);
      const bx = x + px * off, by = y + py * off;
      const sx = bx - cos * l0, sy = by - sin * l0, ex = bx + cos * l1, ey = by + sin * l1;
      const cx = bx + px * bend, cy = by + py * bend;
      const mx = (sx + 2 * cx + ex) / 4, my = (sy + 2 * cy + ey) / 4;
      const w = wid / n * (.9 + Math.random() * 1.1);
      const load = alphaBase * (.55 + Math.random() * .45);
      ctx.lineWidth = w * 1.15; ctx.globalAlpha = load;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + cx) / 2, (sy + cy) / 2, mx, my); ctx.stroke();
      ctx.lineWidth = w * .7; ctx.globalAlpha = load * (.35 + Math.random() * .3);
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.quadraticCurveTo((ex + cx) / 2, (ey + cy) / 2, ex, ey); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function stroke(ctx, x, y, len, wid, s, o) {
    let { r, g, b } = s;
    const j = o.jitter ?? 26;
    r += (Math.random() - .5) * j; g += (Math.random() - .5) * j; b += (Math.random() - .5) * j;
    if (s.lum < 95) { b += 18; r -= 5; }          // shadows lean blue-violet, never black
    if (o.lighten) { const k = o.lighten; r += (250 - r) * k; g += (251 - g) * k; b += (252 - b) * k; }
    const a = o.horizontal
      ? (Math.random() - .5) * .35 + (s.mag > 14 ? (Math.atan2(s.gy, s.gx) + Math.PI / 2) * .25 : 0)
      : (s.mag < 7 ? Math.sin(x * .004 + y * .002) * 1.2 + Math.cos(y * .003) * .8 : Math.atan2(s.gy, s.gx) + Math.PI / 2 + (Math.random() - .5) * .45);
    bristles(ctx, x, y, a, len, wid, `rgb(${r | 0},${g | 0},${b | 0})`, o.alpha ?? .88);
  }
  function paintAll(ctx, w, h, S, o = {}) {
    const uv = coverUV(S, w, h);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const t = document.createElement('canvas'); t.width = 16; t.height = Math.max(2, Math.round(16 * S.sh / S.sw));
    t.getContext('2d').drawImage(S.small, 0, 0, t.width, t.height);
    ctx.drawImage(t, 0, 0, w, h);
    if (o.lighten) { ctx.fillStyle = `rgba(250,251,252,${o.lighten})`; ctx.fillRect(0, 0, w, h); }
    const base = Math.max(w, h), area = w * h, k = o.density ?? .8;
    [[.07, .03], [.04, .016], [.022, .008], [.012, .0045]].forEach(([l, wd], p) => {
      const L = base * l, W = base * wd, n = Math.round(area / (L * W) * k);
      for (let i = 0; i < n; i++) {
        let x, y, s, tries = 0;
        do { x = Math.random() * w; y = Math.random() * h; s = S.at(...uv(x, y)); tries++; }
        while (p > 1 && s.mag < 10 && Math.random() < .5 && tries < 4);
        stroke(ctx, x, y, L * (.7 + Math.random() * .6), W, s, { lighten: o.lighten, alpha: .9, horizontal: o.horizontal, jitter: o.jitter });
      }
    });
    ctx.restore();
  }
  // The painting washes away in brush-shaped strokes, sweeping left to right.
  function wash(canvas, ms, done) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, base = Math.max(w, h);
    const total = Math.round((w * h) / (base * base * .045 * .012) * 3.2);
    let n = 0, t0 = null;
    const tick = (t) => {
      if (!canvas.isConnected) return;
      if (t0 === null) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      const target = Math.round(total * (1 - Math.pow(1 - p, 2)));
      ctx.globalCompositeOperation = 'destination-out';
      while (n < target) {
        const reach = Math.min(1, (n / total) * 1.35 + .12);
        const x = Math.random() * w * reach, y = Math.random() * h;
        const a = (Math.random() - .5) * .9;
        bristles(ctx, x, y, a, base * (.03 + Math.random() * .03), base * (.008 + Math.random() * .008), '#000', .7 + Math.random() * .3);
        n++;
      }
      ctx.globalCompositeOperation = 'source-over';
      if (p < 1) requestAnimationFrame(tick); else { ctx.clearRect(0, 0, w, h); done && done(); }
    };
    requestAnimationFrame(tick);
  }
  // Fades a canvas back to clear a little each frame, then stops once nothing has been drawn for a while.
  function fader(canvas, rate = .045) {
    const ctx = canvas.getContext('2d'); let running = false, last = 0;
    const frame = (t) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${rate})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      if (t - last < 2600) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, canvas.width, canvas.height); running = false; }
    };
    return () => { last = performance.now(); if (!running) { running = true; requestAnimationFrame(frame); } };
  }
  const sizeCanvas = (c, w, h) => { c.width = Math.max(1, Math.round(w * DPR)); c.height = Math.max(1, Math.round(h * DPR)); };

  /* ---------------- Painted page: Water Lilies, washed light (static) ---------------- */
  loadImage('assets/lilies-bg.webp').then((img) => {
    let S; try { S = sampler(img); } catch { return; }
    const bg = document.createElement('canvas'); bg.id = 'bg'; bg.setAttribute('aria-hidden', 'true');
    document.body.prepend(bg);
    const paintBg = () => { sizeCanvas(bg, innerWidth, innerHeight); paintAll(bg.getContext('2d'), bg.width, bg.height, S, { lighten: .66, density: .7, horizontal: true }); };
    paintBg();
    let rt, lastW = innerWidth;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; paintBg(); } }, 200); });

    // Press and drag on the background to paint strokes that stay.
    const ink = document.createElement('canvas'); ink.id = 'ink'; ink.setAttribute('aria-hidden', 'true');
    bg.after(ink); sizeCanvas(ink, innerWidth, innerHeight);
    const ictx = ink.getContext('2d');
    addEventListener('resize', () => {
      const keep = document.createElement('canvas'); keep.width = ink.width; keep.height = ink.height;
      keep.getContext('2d').drawImage(ink, 0, 0);
      sizeCanvas(ink, innerWidth, innerHeight); ictx.drawImage(keep, 0, 0);
    });
    const NO_DRAW = 'a, button, input, textarea, select, label, .tile, .stage, .nav';
    let drawing = false, dx = 0, dy = 0;
    let dir = 0, erasing = false;
    const rub = (x, y) => {
      ictx.globalCompositeOperation = 'destination-out';
      ictx.beginPath(); ictx.arc(x, y, 16 * DPR, 0, Math.PI * 2); ictx.fill();
      ictx.globalCompositeOperation = 'source-over';
    };
    const dab = (x, y) => {
      if (erasing) return rub(x, y);
      const uv = coverUV(S, ink.width, ink.height), base = Math.max(ink.width, ink.height);
      const s = S.at(...uv(x, y)), j = 30;
      let r = s.r + (Math.random() - .5) * j, g = s.g + (Math.random() - .5) * j, b = s.b + (Math.random() - .5) * j;
      if (s.lum < 95) { b += 18; r -= 5; }
      bristles(ictx, x + (Math.random() - .5) * 3 * DPR, y + (Math.random() - .5) * 3 * DPR, dir + (Math.random() - .5) * .25,
        base * (.012 + Math.random() * .006), base * (.005 + Math.random() * .0015), `rgb(${r | 0},${g | 0},${b | 0})`, .8);
    };
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest(NO_DRAW)) return;
      e.preventDefault();                       // no text selection while painting
      drawing = true; dx = e.clientX * DPR; dy = e.clientY * DPR;
      dab(dx, dy);
      root.classList.add('painting');
    });
    addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const x = e.clientX * DPR, y = e.clientY * DPR, d = Math.hypot(x - dx, y - dy), step = 5 * DPR;
      if (d < step) return;
      dir = Math.atan2(y - dy, x - dx);
      for (let t = step; t <= d; t += step) dab(dx + (x - dx) * t / d, dy + (y - dy) * t / d);
      dx = x; dy = y;
    }, { passive: true });
    // Toolbar (appears once something is drawn): eraser toggle + clear.
    // Toolbar: Eraser + Clear, with a small hint underneath.
    const tools = document.createElement('div'); tools.className = 'ink-tools';
    tools.innerHTML = '<div class="ink-btns"><button type="button" class="erase" aria-pressed="false">Eraser</button><button type="button" class="clear">Clear drawing</button></div>';
    document.body.append(tools);
    const eraseBtn = tools.querySelector('.erase');
    const setErase = (on) => { erasing = on; eraseBtn.setAttribute('aria-pressed', String(on)); root.classList.toggle('erasing', on); };
    eraseBtn.addEventListener('click', () => setErase(!erasing));
    tools.querySelector('.clear').addEventListener('click', () => { ictx.clearRect(0, 0, ink.width, ink.height); setErase(false); });
    const stop = () => { drawing = false; root.classList.remove('painting'); };
    addEventListener('pointerup', stop); addEventListener('pointercancel', stop); addEventListener('blur', stop);

    if (reduce) return;
    // Cursor trail: Monet strokes that fade, anywhere on the page.
    const trail = document.createElement('canvas'); trail.id = 'trail'; trail.setAttribute('aria-hidden', 'true');
    bg.after(trail); sizeCanvas(trail, innerWidth, innerHeight);
    addEventListener('resize', () => sizeCanvas(trail, innerWidth, innerHeight));
    const tctx = trail.getContext('2d');
    const wake = fader(trail, .05);
    let px = -1, py = -1;
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const x = e.clientX * DPR, y = e.clientY * DPR;
      if (px >= 0 && Math.hypot(x - px, y - py) < 6) return;
      px = x; py = y;
      const uv = coverUV(S, trail.width, trail.height), base = Math.max(trail.width, trail.height);
      for (let i = 0; i < 3; i++) {
        const ox = x + (Math.random() - .5) * base * .03, oy = y + (Math.random() - .5) * base * .03;
        stroke(tctx, ox, oy, base * (.016 + Math.random() * .014), base * (.005 + Math.random() * .004), S.at(...uv(ox, oy)), { alpha: .55, lighten: .15 });
      }
      wake();
    }, { passive: true });
  }).catch(() => {});

  /* ---------------- The hang: click a cover and its project opens in place ---------------- */
  const top = document.querySelector('.top');
  if (!top) return;
  const tiles = [...top.querySelectorAll('.tile')];
  const details = [...top.querySelectorAll('.detail')];
  const stage = top.querySelector('.stage');
  let cur = -1;

  function show(i, fromTile) {
    cur = i;
    details.forEach((d, k) => d.classList.toggle('active', k === cur));
    tiles.forEach((t, k) => t.setAttribute('aria-expanded', String(k === cur)));
    const wasOpen = top.classList.contains('open');
    top.classList.add('open'); root.classList.add('project-open');
    details[cur].querySelector('h3').focus({ preventScroll: true });
    if (!wasOpen && innerWidth <= 760) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + details[cur].id.slice(2));
  }
  function close() {
    if (cur < 0) return;
    const k = cur; cur = -1;
    top.classList.remove('open'); root.classList.remove('project-open');
    tiles.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    tiles[k].focus({ preventScroll: true });
    if (innerWidth <= 760) tiles[k].scrollIntoView({ block: 'center' });
    history.replaceState(null, '', location.pathname + location.search);
  }

  tiles.forEach((t, k) => { t.setAttribute('aria-expanded', 'false'); t.addEventListener('click', () => show(k, t)); });
  stage.querySelector('.back').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (cur < 0) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  // Keep the gap under the contact line equal to the gap above it (the gap above grows with screen height)
  const contactLine = document.querySelector('.contact .reach'), foot = document.querySelector('.foot'), wall = document.querySelector('.tiles');
  if (contactLine && foot && wall) {
    const balance = () => {
      if (top.classList.contains('open')) return;
      foot.style.marginTop = '0px';
      const above = contactLine.getBoundingClientRect().top - wall.getBoundingClientRect().bottom;
      const below = foot.getBoundingClientRect().top - contactLine.getBoundingClientRect().bottom;
      foot.style.marginTop = Math.max(0, Math.round(above - below)) + 'px';
    };
    balance(); addEventListener('resize', balance); addEventListener('load', balance);
    if (document.fonts) document.fonts.ready.then(balance);
  }

  // Figure videos: honour reduced motion (show the poster with controls instead of autoplaying)
  if (reduce) document.querySelectorAll('.fig-video').forEach((v) => { v.removeAttribute('autoplay'); v.pause(); v.controls = true; });

  // Figure view tabs (e.g. ThinkClear: Glasses / System flow)
  document.querySelectorAll('.views').forEach((bar) => {
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    const pick = (t) => tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
    });
    tabs.forEach((t, k) => {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault(); e.stopPropagation();
        const n = tabs[(k + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; pick(n); n.focus();
      });
    });
  });


  // ePill app screens: five phones stand on a ring that turns. Drag, swipe, scroll sideways, tap a side phone or use the
  // arrow keys; it always settles with one phone facing you, and going past the last brings the first back around.
  document.querySelectorAll('.spin').forEach((spin) => {
    const stage = spin.querySelector('.spin-stage');
    const ring = spin.querySelector('.spin-track');
    const phones = [...ring.querySelectorAll('.spin-phone')];
    const n = phones.length, STEP = 360 / n;
    const dots = [...spin.querySelectorAll('.spin-dots i')];
    const cap = spin.querySelector('.spin-cap');
    let angle = 0, target = 0, pw = 200, cur = -1, anim = 0;
    const setCap = (k) => {
      if (k === cur) return;
      const first = cur < 0; cur = k;
      dots.forEach((d, j) => d.classList.toggle('on', j === k));
      const fill = () => { cap.innerHTML = `<b>${k + 1}. ${phones[k].dataset.title}</b>${phones[k].dataset.note}`; cap.classList.remove('fade'); };
      if (first || reduce) return fill();
      cap.classList.add('fade'); setTimeout(fill, 180);
    };
    // each phone sits on an oval seen from slightly above: x from sin, depth from cos; it turns only partway so its screen stays readable
    const render = () => {
      const rx = pw * 1.25, rz = pw * 1.5;
      phones.forEach((ph, i) => {
        const rel = ((i * STEP - angle) % 360 + 540) % 360 - 180;
        const t = rel * Math.PI / 180, c = Math.cos(t);
        const x = Math.sin(t) * rx, z = (c - 1) * rz, y = (1 - c) * -pw * 0.06;
        ph.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${(rel * 0.45).toFixed(1)}deg)`;
        ph.style.zIndex = String(Math.round(100 + c * 100));
        // only the phone facing you is in full colour; the rest go grey and see-through, blending back in as they turn to the front
        const w = Math.max(0, Math.min(1, (c - 0.6) / 0.4)), base = 0.18 + 0.4 * (c + 1) / 2;
        ph.style.opacity = String((base + (1 - base) * w).toFixed(3));
        ph.style.filter = w > 0.99 ? '' : `grayscale(${(1 - w).toFixed(3)}) brightness(${(0.92 + 0.08 * w).toFixed(3)})`;
        ph.style.pointerEvents = c > -0.2 ? '' : 'none';
      });
      setCap(((Math.round(angle / STEP) % n) + n) % n);
    };
    const go = (to) => {
      target = to; cancelAnimationFrame(anim);
      if (reduce) { angle = to; return render(); }
      const from = angle, t0 = performance.now(), dur = 650;
      const tick = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); angle = from + (to - from) * e; render(); if (k < 1) anim = requestAnimationFrame(tick); };
      anim = requestAnimationFrame(tick);
    };
    const snap = () => go(Math.round(angle / STEP) * STEP);
    const measure = () => { if (!phones[0].offsetWidth) return; pw = phones[0].offsetWidth; render(); };
    // drag with mouse, pen or finger; a short tap on a side phone turns it to the front
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      cancelAnimationFrame(anim); drag = { x: e.clientX, a: angle, moved: false, id: e.pointerId };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; stage.classList.add('dragging'); stage.setPointerCapture(drag.id); }
      if (drag.moved) { angle = drag.a - dx * (STEP / (pw * 1.1)); render(); }
    });
    const end = (e) => {
      if (!drag) return;
      const was = drag; drag = null; stage.classList.remove('dragging');
      if (!was.moved && e.type === 'pointerup') {
        const ph = e.target.closest && e.target.closest('.spin-phone');
        if (ph) { const i = phones.indexOf(ph); const rel = ((i * STEP - angle) % 360 + 540) % 360 - 180; go(Math.round((angle + rel) / STEP) * STEP); return; }
      }
      snap();
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    // trackpads: a sideways scroll turns the ring; vertical scrolling still scrolls the page
    let wheelT = 0;
    stage.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      cancelAnimationFrame(anim); stage.classList.add('dragging'); angle += e.deltaX * 0.25; render();
      clearTimeout(wheelT); wheelT = setTimeout(() => { stage.classList.remove('dragging'); snap(); }, 140);
    }, { passive: false });
    stage.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault(); e.stopPropagation();
      go(target + (e.key === 'ArrowRight' ? STEP : -STEP));
    });
    // the panel starts hidden, so measure once it has a size
    new ResizeObserver(measure).observe(stage);
    render();
  });

  const start = details.findIndex((d) => '#' + d.id.slice(2) === location.hash);
  if (start >= 0) show(start);
})();

// Email links: copy the address on click (mailto still fires for people with a mail app set up)
document.querySelectorAll('.reach a[href^="mailto:"]').forEach((a) => {
  const note = document.createElement('span');
  note.className = 'copied';
  note.setAttribute('role', 'status');
  a.after(note);
  let t;
  a.addEventListener('click', () => {
    const addr = a.href.replace('mailto:', '');
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(addr).then(() => {
      note.textContent = 'Copied to clipboard';
      note.classList.add('on');
      clearTimeout(t);
      t = setTimeout(() => note.classList.remove('on'), 1800);
    }).catch(() => {});
  });
});

/* ---------- Scroll scene: the name lands in the header, the painting zooms, the cards paint in ---------- */
(() => {
  const $ = (s) => document.querySelector(s);
  const nm = $('.nm'), h1 = $('#name'), brand = $('.brand'), hero = $('.hero');
  if (!nm || !hero) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cue = document.createElement('a');
  cue.className = 'scroll-cue'; cue.href = '#projects';
  cue.innerHTML = 'Projects<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4"/></svg>';
  hero.appendChild(cue);
  // the intro plays once; hiding the hero for a project and showing it again must not replay it
  setTimeout(() => document.documentElement.classList.add('intro-done'), 2600);
  if (reduce) return;

  document.documentElement.classList.add('scene');
  const fades = [...document.querySelectorAll('.name-row .year, .hero .edu, .hero-pitch'), cue];
  const frames = [...document.querySelectorAll('.tiles .frame')];
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  // brushstroke wipe mask: solid on the left, ragged bristle edge, clear on the right
  let streaks = '';
  for (let k = 0; k < 30; k++) {
    const y = k * 3.35, len = 4 + ((k * 53) % 31) + (k % 4) * 3;
    streaks += `<rect x="140" y="${y}" width="${len + 6}" height="${2.6 + (k % 3) * 0.5}" rx="1.4" opacity="${0.55 + (k % 3) * 0.2}"/>`;
  }
  const mask = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 100" preserveAspectRatio="none"><g fill="#000"><rect width="145" height="100"/>${streaks}</g></svg>`)}")`;
  frames.forEach((f) => { f.style.webkitMaskImage = mask; f.style.maskImage = mask; });

  let base = null;
  function measure() {
    if ($('.top.open')) return;
    nm.style.transform = '';
    const s = scrollY, r = nm.getBoundingClientRect(), b = brand.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(brand).fontSize) / parseFloat(getComputedStyle(h1).fontSize);
    base = { x: r.left, y: r.top + s, h: r.height, bx: b.left, by: b.top + b.height / 2, k, heroH: hero.offsetHeight };
  }

  function frame() {
    const s = scrollY, vh = innerHeight;
    const max = Math.max(1, document.documentElement.scrollHeight - vh);

    // the name pins, shrinks and lands in the header; the other hero lines drift up and fade
    if ($('.top.open')) brand.style.opacity = 1;
    else if (base) {
      const e = smooth(clamp(s / (base.heroH * 0.7)));
      const X = lerp(base.x, base.bx, e), Y = lerp(base.y, base.by - (base.h * base.k) / 2, e);
      nm.style.transform = `translate(${X - base.x}px, ${Y - (base.y - s)}px) scale(${lerp(1, base.k, e)})`;
      const swap = clamp((e - 0.92) / 0.08);
      nm.style.opacity = 1 - swap;
      brand.style.opacity = swap;
      const f = clamp(s / (base.heroH * 0.35));
      fades.forEach((el, i) => { el.style.filter = `opacity(${1 - f})`; el.style.translate = `0 ${-f * (24 + i * 10)}px`; });
    }

    // the painting slowly zooms and drifts as you go down
    const bg = document.getElementById('bg');
    if (bg) bg.style.transform = `scale(${1 + 0.28 * (s / max)}) translateY(${-3 * (s / max)}%)`;

    // each card is painted in by a brushstroke as it rises into view
    frames.forEach((f, i) => {
      const top = f.getBoundingClientRect().top + (parseFloat(f.style.translate.split(' ')[1]) || 0);
      const r = smooth(clamp((vh - top - 30) / (vh * 0.5) - (i % 2) * 0.12));
      const pos = `${(1 - r) * 100}% 0`;
      f.style.webkitMaskPosition = pos; f.style.maskPosition = pos;
      f.style.translate = `0 ${(1 - r) * 40}px`;
    });
  }

  let ticking = false;
  const tick = () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; frame(); }); } };
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', () => { measure(); frame(); });
  // re-measure once a project closes, since the hero was hidden while it was open
  let wasOpen = false;
  new MutationObserver(() => {
    const open = !!$('.top.open');
    if (wasOpen && !open) {
      // back from a project: land on the gallery, where the visitor came from
      const wall = document.getElementById('projects');
      measure();
      scrollTo(0, wall.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')));
    }
    wasOpen = open; measure(); frame();
  }).observe($('.top'), { attributes: true, attributeFilter: ['class'] });
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(() => { measure(); frame(); }, 50));
  measure(); frame();
})();
