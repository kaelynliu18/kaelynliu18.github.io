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
    // bring the opened project up to fill the screen, wherever the visitor had scrolled to
    if (!wasOpen) {
      const navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 0;
      const el = innerWidth <= 760 ? stage : top;
      scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - navH), behavior: 'instant' });
    }
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


  // Rings: items stand on a ring that turns (the ePill app screens, and the project covers on the wall). Drag, swipe,
  // scroll sideways, tap a side item or use the arrow keys; it always settles with one item facing you, and going past
  // the last brings the first back around.
  function makeRing(spin, o = {}) {
    const { rx: RX = 1.25, rz: RZ = 1.5, lift = 0.06, turn = 0.45, back = 0.18, side = 0.4, grey = true, onTurn } = o;
    const stage = spin.querySelector('.spin-stage');
    const ring = spin.querySelector('.spin-track');
    const items = [...ring.children];
    const n = items.length, STEP = 360 / n;
    const dots = [...spin.querySelectorAll('.spin-dots i')];
    const cap = spin.querySelector('.spin-cap');
    let angle = 0, target = 0, pw = 200, cur = -1, anim = 0;
    const idx = (a) => ((Math.round(a / STEP) % n) + n) % n;
    const setCap = (k) => {
      if (k === cur) return;
      const first = cur < 0; cur = k;
      dots.forEach((d, j) => d.classList.toggle('on', j === k));
      if (onTurn) onTurn(k);
      if (!cap) return;
      const fill = () => { cap.innerHTML = `<b>${k + 1}. ${items[k].dataset.title}</b>${items[k].dataset.note}`; cap.classList.remove('fade'); };
      if (first || reduce) return fill();
      cap.classList.add('fade'); setTimeout(fill, 180);
    };
    // each item sits on an oval seen from slightly above: x from sin, depth from cos; it turns only partway so its face stays readable
    const render = () => {
      const rx = pw * RX, rz = pw * RZ;
      items.forEach((ph, i) => {
        const rel = ((i * STEP - angle) % 360 + 540) % 360 - 180;
        const t = rel * Math.PI / 180, c = Math.cos(t);
        const x = Math.sin(t) * rx, z = (c - 1) * rz, y = (1 - c) * -pw * lift;
        ph.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${(rel * turn).toFixed(1)}deg)`;
        ph.style.zIndex = String(Math.round(100 + c * 100));
        // only the item facing you is in full colour; the rest go grey and see-through, blending back in as they turn to the front
        const w = Math.max(0, Math.min(1, (c - 0.6) / 0.4)), base = back + side * (c + 1) / 2;
        ph.style.opacity = String(Math.min(1, base + (1 - base) * w).toFixed(3));
        ph.style.filter = w > 0.99 ? '' : grey ? `grayscale(${(1 - w).toFixed(3)}) brightness(${(0.92 + 0.08 * w).toFixed(3)})` : `brightness(${(0.8 + 0.2 * w).toFixed(3)}) saturate(${(0.7 + 0.3 * w).toFixed(3)})`;
        ph.style.pointerEvents = c > -0.2 ? '' : 'none';
      });
      setCap(idx(angle));
    };
    const go = (to) => {
      target = to; cancelAnimationFrame(anim);
      if (reduce) { angle = to; return render(); }
      const from = angle, t0 = performance.now(), dur = 650;
      const tick = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); angle = from + (to - from) * e; render(); if (k < 1) anim = requestAnimationFrame(tick); };
      anim = requestAnimationFrame(tick);
    };
    // turn the shortest way round to item i
    const goTo = (i) => { const rel = ((i * STEP - target) % 360 + 540) % 360 - 180; go(Math.round((target + rel) / STEP) * STEP); };
    const snap = () => go(Math.round(angle / STEP) * STEP);
    const measure = () => { if (!items[0].offsetWidth) return; pw = items[0].offsetWidth; render(); };
    // drag with mouse, pen or finger; a short tap on a side item turns it to the front
    let drag = null, frontAtDown = 0, dragged = false;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      frontAtDown = idx(angle); dragged = false;
      cancelAnimationFrame(anim); drag = { x: e.clientX, a: angle, moved: false, id: e.pointerId };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 4) { drag.moved = dragged = true; stage.classList.add('dragging'); stage.setPointerCapture(drag.id); }
      if (drag.moved) { angle = drag.a - dx * (STEP / (pw * 1.1)); render(); }
    });
    const end = (e) => {
      if (!drag) return;
      const was = drag; drag = null; stage.classList.remove('dragging');
      if (!was.moved && e.type === 'pointerup') {
        const ph = items.find((it) => it.contains(e.target));
        if (ph) { goTo(items.indexOf(ph)); return; }
      }
      snap();
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    // a drag never counts as a click on whatever was under it
    stage.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);
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
      if (o.focusFront) items[idx(target)].querySelector(o.focusFront).focus({ preventScroll: true });
    });
    // the panel may start hidden, so measure once it has a size
    new ResizeObserver(measure).observe(stage);
    render();
    return { goTo, step: (d) => goTo(idx(target) + d), front: () => idx(angle), frontAtDown: () => frontAtDown };
  }

  document.querySelectorAll('.spin').forEach((spin) => makeRing(spin));

  // the wall: covers in rows of uneven widths and heights (the wide one alternates sides row to row). Hovering one
  // (or tabbing to it) widens it and deepens its row while the others give way and fade; its role and one-liner slide
  // in. Two per row, as many rows as it takes; a lone last card just stretches to fill.
  const grid = top.querySelector('.tiles');
  if (grid) {
    const items = [...grid.children];
    const n = items.length, cols = 2, rows = Math.ceil(n / cols);
    const PATTERNS = cols === 2 ? [[1.5, 1], [1, 1.5]] : [[1.6, 1, 1.25], [1, 1.45, 1], [1.25, 1, 1.6]];
    const ROW_W = [1.12, 0.88, 1, 1.06, 0.94];
    const rowOf = (k) => Math.floor(k / cols), colOf = (k) => k % cols;
    // a line break after each full row keeps the rows separate
    items.forEach((li, k) => {
      if (colOf(k) === cols - 1 && k < n - 1) {
        const br = document.createElement('li'); br.className = 'row-break'; br.setAttribute('aria-hidden', 'true');
        li.after(br);
      }
    });
    grid.style.setProperty('--rows', rows);
    grid.style.setProperty('--rows-fit', Math.min(rows, 2)); // size rows as if two fit a screen; more rows just scroll
    let active = -2; // so the first setActive(-1) lays out the resting sizes
    const setActive = (k) => {
      if (k === active) return;
      active = k;
      grid.classList.toggle('has-active', k >= 0);
      tiles.forEach((t, j) => t.classList.toggle('on', j === k));
      const rw = Array.from({ length: rows }, (_, r) => (k >= 0 && r === rowOf(k) ? 1.55 : ROW_W[r % ROW_W.length]));
      const sum = rw.reduce((x, y) => x + y, 0);
      items.forEach((li, j) => {
        const base = PATTERNS[rowOf(j) % PATTERNS.length][colOf(j)];
        li.style.setProperty('--grow', j === k ? Math.max(...PATTERNS[rowOf(j) % PATTERNS.length]) * 1.55 : base);
        li.style.setProperty('--rh', (rw[rowOf(j)] / sum).toFixed(4));
      });
    };
    setActive(-1);
    const hoverable = matchMedia('(hover: hover) and (pointer: fine)');
    tiles.forEach((t, k) => {
      t.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' || hoverable.matches) setActive(k); });
      t.addEventListener('focus', () => { if (t.matches(':focus-visible')) setActive(k); });
      t.addEventListener('blur', () => { if (!grid.matches(':hover')) setActive(-1); });
    });
    grid.addEventListener('pointerleave', () => setActive(-1));

    // the cursor becomes a "View" bubble over the covers (mouse only)
    if (hoverable.matches) {
      const dot = document.createElement('div');
      dot.className = 'view-cursor'; dot.setAttribute('aria-hidden', 'true'); dot.textContent = 'Click to view';
      document.body.append(dot);
      let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, raf = 0;
      const follow = () => {
        cx += (x - cx) * (reduce ? 1 : 0.28); cy += (y - cy) * (reduce ? 1 : 0.28);
        dot.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
        raf = Math.abs(x - cx) + Math.abs(y - cy) > 0.3 ? requestAnimationFrame(follow) : 0;
      };
      addEventListener('pointermove', (e) => {
        x = e.clientX; y = e.clientY;
        const over = !!(e.target.closest && e.target.closest('.tiles .tile')) && !top.classList.contains('open');
        if (over && !dot.classList.contains('show')) { cx = x; cy = y; }
        dot.classList.toggle('show', over);
        if (!raf) raf = requestAnimationFrame(follow);
      }, { passive: true });
      document.addEventListener('pointerleave', () => dot.classList.remove('show'));
      tiles.forEach((t) => t.addEventListener('click', () => dot.classList.remove('show')));
    }
  }

  const start = details.findIndex((d) => '#' + d.id.slice(2) === location.hash);
  if (start >= 0) show(start);
})();

// Email links: copy the address on click (mailto still fires for people with a mail app set up)
document.querySelectorAll('.reach a[href^="mailto:"], .foot-mail').forEach((a) => {
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
      const r = smooth(clamp((vh - top - 30) / (vh * 0.35) - (i % 2) * 0.12)); // fully in by the time it's well on screen
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

/* "Back to projects" scrolls to the top of the projects grid, just under the sticky header */
document.querySelectorAll('.foot-top').forEach((a) => a.addEventListener('click', (e) => {
  const wall = document.getElementById('projects');
  if (!wall) return;
  e.preventDefault();
  const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 0;
  scrollTo({ top: wall.getBoundingClientRect().top + scrollY - navH, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  history.replaceState(null, '', location.pathname + location.search);
}));

/* ---------- Footer: a little serve on a side-view court. Hold the ball: a power bar fills and drains; release to
   hit it toward the other side of the net. Too soft finds the net, too hard slams the far wall. The ball stays where
   it lands, and you serve again from there. It never rolls under the contact links. ---------- */
(() => {
  const panel = document.querySelector('.foot-panel');
  const ball = panel && panel.querySelector('.foot-ball');
  if (!ball) return;
  const $ = (c) => panel.querySelector(c);
  const label = $('.foot-click'), net = $('.foot-net'), power = $('.foot-power');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const G = 2300, BOUNCE = 0.62, ROLL = 0.95;
  let W = 0, H = 0, F = 0, R = 15, x = 0, y = 0, vx = 0, vy = 0, rot = 0, raf = 0, prev = 0;
  let netX = -1, netTop = 0, restX = 0, rightWall = 0;
  let point = null, charging = null;

  const size = () => {
    const pr = panel.getBoundingClientRect();
    W = pr.width; H = pr.height; R = ball.offsetWidth / 2;
    F = H - (parseFloat(getComputedStyle(panel).getPropertyValue('--floor')) || 46);
    const shown = (el) => el && el.offsetParent !== null;
    if (shown(net)) { const r = net.getBoundingClientRect(); netX = r.left - pr.left + r.width / 2; netTop = r.top - pr.top; } else netX = -1;
    restX = W * (innerWidth <= 760 ? 0.62 : 0.6);
    // the right wall stops short of the contact links (desktop), so the ball never sits on top of them
    const links = panel.querySelector('.foot-links');
    rightWall = W;
    if (links && innerWidth > 760) rightWall = Math.min(W, links.getBoundingClientRect().left - pr.left - 24);
  };
  const place = (el, px, py) => { if (el) el.style.transform = `translate(${(px - el.offsetWidth / 2).toFixed(0)}px, ${py.toFixed(0)}px)`; };
  const draw = () => {
    ball.style.transform = `translate(${(x - R).toFixed(1)}px, ${(y - R).toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
    place(label, x, y - R - 22); place(power, x, y - R - 16);
  };
  const settle = () => { if (point) point.done = true; };
  const dropIn = () => { point = null; size(); x = restX; y = F - R - 90; vx = 0; vy = 0; draw(); run(); };

  const step = (now) => {
    const dt = Math.min(0.032, (now - prev) / 1000 || 0.016); prev = now;
    const px = x;
    vy += G * dt; x += vx * dt; y += vy * dt; rot += (vx * dt / R) * 57.3;
    if (x < R) { x = R; vx = -vx * BOUNCE; settle(); }
    if (x > rightWall - R) { x = rightWall - R; vx = -vx * BOUNCE; settle(); }
    if (y < R) { y = R; vy = Math.abs(vy) * 0.5; }
    if (netX > 0 && (px - netX) * (x - netX) <= 0 && y + R * 0.6 > netTop) { x = px; vx = -vx * 0.3; settle(); }
    if (y > F - R) {
      y = F - R;
      settle();
      vy = Math.abs(vy) < 90 ? 0 : -vy * BOUNCE; vx *= ROLL;
    }
    draw();
    const resting = y >= F - R - 0.5 && vy === 0 && Math.abs(vx) < 4;
    if (resting) point = null; // once it settles, it can be played again from where it lies
    if (label) label.classList.toggle('away', !resting || !!charging);
    raf = resting ? 0 : requestAnimationFrame(step);
  };
  const run = () => { if (!raf) { prev = performance.now(); raf = requestAnimationFrame(step); } };

  size(); x = restX; y = F - R; draw();
  let dropped = false;
  new IntersectionObserver((entries, io) => {
    if (!entries[0].isIntersecting || dropped) return;
    dropped = true; io.disconnect();
    if (!reduce) dropIn();
  }, { threshold: 0.45 }).observe(panel);

  // hold to charge: power goes 0 -> 1 -> 0 ... ; release to serve
  const PERIOD = 1300;
  const level = (t) => { const k = ((t - charging.t0) % PERIOD) / PERIOD; return k < 0.5 ? k * 2 : 2 - k * 2; };
  const tickPower = (t) => { if (!charging) return; const p = level(t); power.style.setProperty('--p', p.toFixed(3)); charging.raf = requestAnimationFrame(tickPower); };
  const serve = (p) => {
    size();
    if (netX < 0) { vy = -900 - p * 400; vx = (Math.random() - 0.5) * 400; point = null; return run(); } // phones: just a hop
    // serve toward the other side of the net; power picks where it would land, from well short of the net (p = 0)
    // to past the far wall (p = 1)
    const dir = x > netX ? -1 : 1, far = dir < 0 ? -340 : rightWall + 340;
    const landX = netX - dir * 400 + (far - (netX - dir * 400)) * p;
    // arc: start from the usual height; if the shot is meant to cross the net, steepen it until it clears the tape
    // (up to what the panel's ceiling allows)
    const crosses = (landX - netX) * (x - netX) < 0, need = (F - netTop) + R + 8, top = Math.sqrt(2 * G * (F - 3 * R));
    let up = 820 + p * 150;
    for (; up <= top; up += 20) {
      const t = (2 * up) / G, sx = (landX - x) / t;
      if (!crosses) break;
      const tn = Math.abs((netX - x) / sx), rise = up * tn - (G * tn * tn) / 2;
      if (rise >= need) break;
    }
    up = Math.min(up, top);
    let sx = (landX - x) / ((2 * up) / G);
    if (crosses) {
      // right up against the net even the steepest arc is too flat: slow it down so it pops up and over
      const disc = up * up - 2 * G * need;
      if (disc > 0) { const tn = (up - Math.sqrt(disc)) / G, maxS = Math.abs(netX - x) / tn; if (Math.abs(sx) > maxS) sx = Math.sign(sx) * maxS; }
    }
    vy = -up; vx = sx;
    point = { done: false }; run();
  };
  ball.addEventListener('pointerdown', (e) => {
    // a ball in flight can't be played; one rolling along the floor can be picked up
    const rolling = y >= F - R - 1 && Math.abs(vy) < 1 && Math.abs(vx) < 160;
    if (e.button || (point && !rolling)) return;
    point = null;
    e.preventDefault();
    if (raf) { cancelAnimationFrame(raf); raf = 0; } // a fresh ball still bouncing in: catch it
    y = F - R; vx = 0; vy = 0;
    ball.setPointerCapture(e.pointerId);
    charging = { t0: performance.now(), raf: 0 };
    power.classList.add('on'); label.classList.add('away'); size(); draw();
    charging.raf = requestAnimationFrame(tickPower);
  });
  const release = () => {
    if (!charging) return;
    const held = performance.now() - charging.t0, p = level(performance.now());
    cancelAnimationFrame(charging.raf); charging = null;
    power.classList.remove('on');
    if (reduce) return;
    // a quick click: a little hop in place; a hold: a serve at the charged power
    if (held < 170) { vy = -760; vx = (Math.random() - 0.5) * 140; point = { done: false }; return run(); }
    serve(Math.max(0.05, p));
  };
  ball.addEventListener('pointerup', release); ball.addEventListener('pointercancel', release);
  // keyboard: Enter or Space serves at a medium-strong pace
  ball.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && (!point || y >= F - R - 1)) { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; y = F - R; serve(0.55); } });

  addEventListener('resize', () => { size(); x = Math.max(R, Math.min(W - R, x)); y = Math.min(y, F - R); if (!raf) y = F - R; draw(); });
})();

/* ---------- Footer sky: Berkeley's weather right now (Open-Meteo, no key), drawn behind the court: clouds for cloud
   cover, rain or snow when it's falling, fog bands, a soft sun by day or a moon and stars at night, and a flash now
   and then in a storm. Preview any of them with ?sky=clear|cloudy|rain|storm|snow|fog|night. ---------- */
(() => {
  const panel = document.querySelector('.foot-panel');
  const cv = panel && panel.querySelector('.foot-sky');
  if (!cv) return;
  const caption = panel.querySelector('.foot-weather');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = cv.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, sky = null, clouds = [], drops = [], stars = [], flash = 0, raf = 0, prev = 0, visible = false;

  // WMO weather codes -> what to draw and how to say it
  const describe = (code) => {
    if (code === 0) return ['clear', 'clear'];
    if (code === 1) return ['clear', 'mostly clear'];
    if (code === 2) return ['cloudy', 'partly cloudy'];
    if (code === 3) return ['cloudy', 'overcast'];
    if (code === 45 || code === 48) return ['fog', 'foggy'];
    if (code >= 51 && code <= 57) return ['rain', 'drizzle'];
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', code === 61 || code === 80 ? 'light rain' : 'rain'];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'snow'];
    if (code >= 95) return ['storm', 'thunderstorm'];
    return ['cloudy', 'cloudy'];
  };
  const PRESETS = {
    clear: { kind: 'clear', day: true, cover: 5, rain: 0, words: 'clear', temp: 64 },
    cloudy: { kind: 'cloudy', day: true, cover: 70, rain: 0, words: 'partly cloudy', temp: 61 },
    rain: { kind: 'rain', day: true, cover: 95, rain: 1.4, words: 'rain', temp: 55 },
    storm: { kind: 'storm', day: true, cover: 100, rain: 3, words: 'thunderstorm', temp: 57 },
    snow: { kind: 'snow', day: true, cover: 90, rain: 1, words: 'snow', temp: 31 },
    fog: { kind: 'fog', day: true, cover: 100, rain: 0, words: 'foggy', temp: 54 },
    night: { kind: 'clear', day: false, cover: 10, rain: 0, words: 'clear', temp: 52 },
  };

  const size = () => {
    const r = panel.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const build = () => {
    if (!sky) return;
    const wet = sky.kind === 'rain' || sky.kind === 'storm' || sky.kind === 'snow';
    let n = Math.round((sky.cover / 100) * 7);
    if (sky.kind === 'cloudy') n = Math.max(n, 3);
    if (wet || sky.kind === 'fog') n = Math.max(n, 6);
    clouds = Array.from({ length: n }, () => ({ x: rnd(-120, W), y: rnd(26, H * 0.36), s: rnd(0.75, 1.3), v: rnd(5, 14) }));
    const count = sky.kind === 'snow' ? 70 : wet ? Math.min(240, 70 + sky.rain * 70) : 0;
    drops = Array.from({ length: count }, () => ({ x: rnd(0, W), y: rnd(0, H), v: sky.kind === 'snow' ? rnd(28, 55) : rnd(620, 820), w: rnd(-12, 12) }));
    stars = !sky.day ? Array.from({ length: 26 }, () => ({ x: rnd(0, W), y: rnd(10, H * 0.45), r: rnd(0.6, 1.4), a: rnd(0.3, 0.8) })) : [];
  };
  // one cloud = several puffs filled as a single shape, so the overlaps don't show
  const cloud = (c, dark) => {
    ctx.beginPath();
    for (const [dx, dy, r] of [[0, 4, 18], [22, -8, 24], [48, 2, 19], [26, 10, 18], [64, 8, 13], [-14, 10, 12]]) {
      ctx.moveTo(c.x + (dx + r) * c.s, c.y + dy * c.s); ctx.arc(c.x + dx * c.s, c.y + dy * c.s, r * c.s, 0, Math.PI * 2);
    }
    ctx.fillStyle = dark ? 'rgba(22, 38, 46, 0.32)' : 'rgba(238, 244, 243, 0.1)';
    ctx.fill('nonzero');
  };
  const draw = (dt) => {
    ctx.clearRect(0, 0, W, H);
    if (!sky) return;
    const wet = sky.kind === 'rain' || sky.kind === 'storm' || sky.kind === 'snow';
    // sun or moon and stars
    if (sky.kind === 'clear' || (sky.kind === 'cloudy' && sky.cover < 85)) {
      if (sky.day) {
        const gx = W * 0.5, gy = 62, g = ctx.createRadialGradient(gx, gy, 6, gx, gy, 70);
        g.addColorStop(0, 'rgba(219, 230, 106, 0.42)'); g.addColorStop(0.35, 'rgba(219, 230, 106, 0.14)'); g.addColorStop(1, 'rgba(219, 230, 106, 0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, 70, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(219, 230, 106, 0.55)'; ctx.beginPath(); ctx.arc(gx, gy, 16, 0, Math.PI * 2); ctx.fill();
      } else {
        stars.forEach((s) => { ctx.fillStyle = `rgba(238, 244, 243, ${s.a})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); });
        const mx = W * 0.5, my = 60;
        ctx.fillStyle = 'rgba(238, 244, 243, 0.75)'; ctx.beginPath(); ctx.arc(mx, my, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2f4f5a'; ctx.beginPath(); ctx.arc(mx + 7, my - 4, 13, 0, Math.PI * 2); ctx.fill();
      }
    }
    // fog: soft horizontal bands drifting
    if (sky.kind === 'fog') {
      for (let i = 0; i < 5; i++) {
        const y = H * (0.18 + i * 0.15), off = ((prev / 1000) * (8 + i * 3)) % W;
        ctx.fillStyle = 'rgba(238, 244, 243, 0.06)';
        ctx.fillRect(-W + off, y, W * 0.7, 18); ctx.fillRect(off, y + 6, W * 0.8, 14);
      }
    }
    // clouds drift right and wrap
    clouds.forEach((c) => { c.x += c.v * dt; if (c.x > W + 40) c.x = -140; cloud(c, wet); });
    // rain streaks or snowflakes
    if (drops.length) {
      if (sky.kind === 'snow') {
        ctx.fillStyle = 'rgba(238, 244, 243, 0.7)';
        drops.forEach((d) => { d.y += d.v * dt; d.x += Math.sin((d.y + d.w * 10) / 30) * 0.4; if (d.y > H) { d.y = -4; d.x = rnd(0, W); } ctx.beginPath(); ctx.arc(d.x, d.y, 1.8, 0, Math.PI * 2); ctx.fill(); });
      } else {
        ctx.strokeStyle = 'rgba(200, 222, 228, 0.38)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.beginPath();
        drops.forEach((d) => { d.y += d.v * dt; d.x -= d.v * dt * 0.12; if (d.y > H) { d.y = rnd(-40, 0); d.x = rnd(0, W + 60); } ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 2.4, d.y - 15); });
        ctx.stroke();
      }
    }
    // storm: an occasional flash
    if (sky.kind === 'storm' && !reduce) {
      if (flash <= 0 && Math.random() < dt * 0.12) flash = 1;
      if (flash > 0) { ctx.fillStyle = `rgba(238, 244, 243, ${0.18 * flash})`; ctx.fillRect(0, 0, W, H); flash -= dt * 4; }
    }
  };
  const loop = (now) => { const dt = Math.min(0.05, (now - prev) / 1000 || 0.016); prev = now; draw(dt); raf = visible ? requestAnimationFrame(loop) : 0; };
  const start = () => { if (reduce) { draw(0); return; } if (!raf && visible) { prev = performance.now(); raf = requestAnimationFrame(loop); } };

  const apply = (w) => {
    sky = w; size(); build();
    if (caption) caption.textContent = `live from Berkeley · ${Math.round(w.temp)}°F, ${w.words}`;
    draw(0); start();
  };
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) start(); }).observe(panel);
  addEventListener('resize', () => { if (sky) { size(); build(); draw(0); } });

  const forced = new URLSearchParams(location.search).get('sky');
  if (forced && PRESETS[forced]) return apply(PRESETS[forced]);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=37.8716&longitude=-122.2727&current=temperature_2m,weather_code,cloud_cover,precipitation,is_day&temperature_unit=fahrenheit';
  const ac = new AbortController(); setTimeout(() => ac.abort(), 6000);
  fetch(url, { signal: ac.signal }).then((r) => r.json()).then((d) => {
    const c = d && d.current; if (!c) return;
    const [kind, words] = describe(c.weather_code);
    apply({ kind, words, day: !!c.is_day, cover: c.cloud_cover ?? 50, rain: c.precipitation ?? 0, temp: c.temperature_2m });
  }).catch(() => {}); // no weather: the sky stays plain
})();
