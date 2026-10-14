(function () {
  'use strict';
  const E = window.TydligEngine, KEY = 'mwkcal-v2', OLD = 'tydlig-state-v1';
  const $ = s => document.querySelector(s);
  const canvas = $('#canvas'), sizer = $('#sizer'), world = $('#world'), pad = $('#pad'), fab = $('#padFab'), hint = $('#hint');
  const menu = $('#menu'), svg = $('#linkLayer'), ghost = $('#ghost');
  const LINKC = ['#4cc08f', '#e8643c', '#6058f0', '#e0508a', '#2fb2d6', '#c99a1c'], GHOST_DY = 44;
  const PALETTE = ['#2f80ed', '#ff9500', '#27ae60', '#eb5757', '#9b51e0', '#00a3a3'];
  const OPS = { '+': '+', '-': '−', '*': '×', '/': '/', '^': '^' };
  let state = load(), cur = null, lastDone = null, vals = new Map(), lastVals = new Map(), clip = null, sliding = false;
  const els = new Map(), gels = new Map();

  function load() {
    for (const k of [KEY, OLD]) { try { const s = JSON.parse(localStorage.getItem(k)); if (s && Array.isArray(s.calcs)) return norm(s); } catch (e) {} }
    return norm({});
  }
  function norm(s) { return { calcs: s.calcs || [], graphs: s.graphs || [], nextId: s.nextId || 1, padOpen: s.padOpen !== false, colors: s.colors || {}, nextColor: s.nextColor || 0, lastId: s.lastId == null ? null : s.lastId, zoom: s.zoom || 1, sx: s.sx || 0, sy: s.sy || 0 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  const get = id => state.calcs.find(c => c.id === id);
  // each linked source result gets the next link color in sequence (green, red-orange, indigo, ...)
  const peekColor = id => LINKC[(state.colors[id] != null ? state.colors[id] : state.nextColor) % LINKC.length];
  function colorOf(id) { if (state.colors[id] == null) state.colors[id] = state.nextColor++; return LINKC[state.colors[id] % LINKC.length]; }
  // ---- zoom: world is scaled with a CSS transform; sizer gives the scroll area its scaled size ----
  const ZMIN = 0.4, ZMAX = 3, WORLD = 4000; let Z = 1;
  function setZoom(z) {
    Z = Math.min(ZMAX, Math.max(ZMIN, z)); state.zoom = Z;
    world.style.transform = `scale(${Z})`; sizer.style.width = sizer.style.height = WORLD * Z + 'px';
    canvas.style.backgroundSize = `${28 * Z}px ${28 * Z}px`; ghost.style.fontSize = 30 * Z + 'px';
  }
  function toWorld(cx, cy) { const r = world.getBoundingClientRect(); return [(cx - r.left) / Z, (cy - r.top) / Z]; }
  const getG = id => state.graphs.find(g => g.id === id);
  const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  function fmtNum(s) { const neg = s[0] === '-'; if (neg) s = s.slice(1); const [a, b] = s.split('.'); return (neg ? '−' : '') + a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b !== undefined ? '.' + b : ''); }
  const fmtVal = v => E.format(v).replace(/^-/, '−');

  // ---------------- rendering ----------------
  function rowHTML(c, linked) {
    const r = vals.get(c.id) || {}, act = cur && cur.id === c.id;
    const typing = act && cur.tok == null, lastI = c.tokens.length - 1;
    let h = '<span class="expr">';
    c.tokens.forEach((t, i) => {
      const sel = act && cur.tok === i ? ' sel' : typing && i === lastI ? ' cur' : '';
      if (t.t === 'num') h += `<span class="tok num${t.graphVar ? ' gvar' : ''}${sel}" data-i="${i}">${esc(fmtNum(t.v))}</span>`;
      else if (t.t === 'ref') { const rv = vals.get(t.id); h += `<span class="tok ref${sel}" data-i="${i}"${sel ? '' : ` style="color:${colorOf(t.id)}"`}>${rv && rv.value != null ? fmtVal(rv.value) : '?'}</span>`; }
      else if (t.t === 'op') h += `<span class="op${sel}">${t.v === '^' ? '^' : OPS[t.v]}</span>`;
      else h += `<span class="op${sel}">${t.t}</span>`;
    });
    if (typing && !c.tokens.length) h += '<span class="caret"></span>';
    h += '</span>';
    if (typing) return h; // like Tydlig: no result until = (or until an earlier number is edited)
    if (r.error) h += `<span class="eqs">=</span><span class="res err" data-res="${c.id}">${r.error === 'incomplete' ? '…' : '?'}</span>`;
    else if (r.value != null) {
      const fl = !sliding && lastVals.has(c.id) && lastVals.get(c.id) !== r.value && !act ? ' flash' : '';
      const lk = linked.has(c.id), pill = !lk && c.id === state.lastId;
      h += `<span class="eqs">=</span><span class="res${lk ? ' linked' : ''}${pill ? ' pill' : ''}${fl}" data-res="${c.id}"${lk ? ` style="border-color:${colorOf(c.id)};color:${colorOf(c.id)}"` : ''}>${fmtVal(r.value)}</span>`;
    }
    return h;
  }
  function syncSliders(el, c) {
    let box = el.querySelector('.sliders');
    const want = c.tokens.map((t, i) => (t.t === 'num' && t.slider ? i : -1)).filter(i => i >= 0);
    if (!want.length) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.className = 'sliders'; el.appendChild(box); }
    const have = new Map([...box.children].map(s => [+s.dataset.i, s]));
    for (const [i, s] of have) if (!want.includes(i)) s.remove();
    for (const i of want) {
      const t = c.tokens[i]; let s = have.get(i);
      if (!s) { s = document.createElement('input'); s.type = 'range'; s.className = 'slider'; s.dataset.i = i; s.dataset.calc = c.id; box.appendChild(s); }
      s.min = t.slider.min; s.max = t.slider.max; s.step = t.slider.step;
      if (!sliding) s.value = parseFloat(t.v);
    }
  }
  function render() {
    vals = E.evaluateAll(state.calcs);
    const linked = new Set(); state.calcs.forEach(c => c.tokens.forEach(t => t.t === 'ref' && linked.add(t.id)));
    const seen = new Set();
    for (const c of state.calcs) {
      seen.add(c.id); let el = els.get(c.id);
      if (!el) { el = document.createElement('div'); el.className = 'calc'; el.dataset.id = c.id; el.innerHTML = '<div class="row"></div>'; world.appendChild(el); els.set(c.id, el); }
      el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
      el.classList.toggle('active', !!(cur && cur.id === c.id));
      el.firstChild.innerHTML = rowHTML(c, linked);
      syncSliders(el, c);
    }
    for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); }
    renderGraphs();
    lastVals = new Map([...vals].map(([k, v]) => [k, v.value]));
    hint.style.display = state.calcs.length || state.graphs.length ? 'none' : '';
    pad.classList.toggle('collapsed', !state.padOpen);
    fab.classList.toggle('show', !state.padOpen);
    save();
  }

  // ---------------- graphs ----------------
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
  function renderGraphs() {
    const seen = new Set();
    for (const g of state.graphs) {
      seen.add(g.id); let el = gels.get(g.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'graph'; el.dataset.g = g.id;
        el.innerHTML = '<div class="gbar"><span>Graph</span><span><button data-z="out" aria-label="축소">−</button><button data-z="in" aria-label="확대">+</button><button data-z="fit" aria-label="원점">⌂</button></span></div><canvas></canvas>';
        world.appendChild(el); gels.set(g.id, el);
      }
      el.style.left = g.x + 'px'; el.style.top = g.y + 'px'; el.style.width = g.w + 'px';
      drawGraph(g, el);
    }
    for (const [id, el] of gels) if (!seen.has(id)) { el.remove(); gels.delete(id); }
  }
  function drawGraph(g, el) {
    const cv = el.querySelector('canvas'), W = g.w, H = g.h, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim();
    const ys = g.ys || g.s, sx = x => W / 2 + (x - g.cx) * g.s, sy = y => H / 2 - (y - g.cy) * ys, ix = px => g.cx + (px - W / 2) / g.s;
    const step = niceStep(56 / g.s), ystep = niceStep(40 / ys), x0 = ix(0), x1 = ix(W), y0 = g.cy - H / 2 / ys, y1 = g.cy + H / 2 / ys;
    ctx.lineWidth = 1; ctx.strokeStyle = col('--grid'); ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const p = Math.round(sx(x)) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.ceil(y0 / ystep) * ystep; y <= y1; y += ystep) { const p = Math.round(sy(y)) + .5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
    const ax = Math.min(Math.max(sx(0), 0), W - 1), ay = Math.min(Math.max(sy(0), 0), H - 1);
    ctx.strokeStyle = col('--axis'); ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, H); ctx.moveTo(0, ay); ctx.lineTo(W, ay); ctx.stroke();
    ctx.fillStyle = col('--mut'); ctx.font = '10px system-ui'; const lab = v => E.format(Math.abs(v) < step / 1e6 ? 0 : v);
    ctx.textAlign = 'center'; for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (Math.abs(x) > step / 2) ctx.fillText(lab(x), sx(x), Math.min(Math.max(ay + 12, 10), H - 3));
    ctx.textAlign = 'left'; for (let y = Math.ceil(y0 / ystep) * ystep; y <= y1; y += ystep) if (Math.abs(y) > ystep / 2) ctx.fillText(lab(y), Math.min(Math.max(ax + 4, 2), W - 30), sy(y) - 2);
    g.series = g.series.filter(s => get(s.calcId));
    for (const s of g.series) {
      const c = get(s.calcId), idx = c.tokens.findIndex(t => t.graphVar === g.id);
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.2; ctx.beginPath();
      if (idx < 0) { const r = vals.get(c.id); if (r && r.value != null) { ctx.moveTo(0, sy(r.value)); ctx.lineTo(W, sy(r.value)); } ctx.stroke(); continue; }
      const f = E.plotFn(c, idx, vals); let pen = false, prev = 0;
      for (let px = 0; px <= W; px += 1.5) {
        const py = sy(f(ix(px)));
        if (!isFinite(py) || Math.abs(py) > 1e5 || (pen && Math.abs(py - prev) > H * 2)) { pen = false; continue; }
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py); pen = true; prev = py;
      }
      ctx.stroke();
      const xv = parseFloat(c.tokens[idx].v), yv = f(xv);
      if (isFinite(yv)) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(sx(xv), sy(yv), 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = col('--card'); ctx.lineWidth = 2; ctx.stroke(); }
    }
  }

  // frame every series: x over each variable's slider range (or around its value), y over sampled values
  function fitGraph(g) {
    let xa = Infinity, xb = -Infinity; const fns = [], hl = [];
    for (const s of g.series) {
      const c = get(s.calcId); if (!c) continue; const idx = c.tokens.findIndex(t => t.graphVar === g.id);
      if (idx < 0) { const r = vals.get(c.id); if (r && r.value != null) hl.push(r.value); continue; }
      const t = c.tokens[idx], v = parseFloat(t.v) || 0;
      const [a, b] = t.slider ? [t.slider.min, t.slider.max] : [Math.min(0, v - Math.abs(v) - 5), Math.max(0, v + Math.abs(v) + 5)];
      xa = Math.min(xa, a); xb = Math.max(xb, b); fns.push(E.plotFn(c, idx, vals));
    }
    if (!isFinite(xa)) { xa = -10; xb = 10; }
    let ya = Math.min(0, ...hl), yb = Math.max(0, ...hl);
    for (const f of fns) for (let i = 0; i <= 100; i++) { const y = f(xa + (xb - xa) * i / 100); if (isFinite(y)) { ya = Math.min(ya, y); yb = Math.max(yb, y); } }
    if (yb - ya < 1e-9) { ya -= 1; yb += 1; }
    const px = (xb - xa) * 0.08, py = (yb - ya) * 0.12; xa -= px; xb += px; ya -= py; yb += py;
    g.cx = (xa + xb) / 2; g.cy = (ya + yb) / 2; g.s = g.w / (xb - xa); g.ys = g.h / (yb - ya);
  }
  function newGraph(x, y) {
    const w = Math.round(Math.min(360, canvas.clientWidth / Z - 32));
    const g = { id: state.nextId++, x: Math.max(4, Math.round(x)), y: Math.max(4, Math.round(y)), w, h: Math.round(w * 0.72), cx: 0, cy: 0, s: 20, series: [] };
    state.graphs.push(g); return g;
  }
  function addSeries(g, calcId) { if (!g.series.some(s => s.calcId === calcId)) g.series.push({ calcId, color: PALETTE[g.series.length % PALETTE.length] }); }
  function toggleGraph(c, i) {
    const t = c.tokens[i];
    if (t.graphVar) { const g = getG(t.graphVar); delete t.graphVar; if (g) g.series = g.series.filter(s => s.calcId !== c.id); return; }
    const el = els.get(c.id); let g = null, best = Infinity;
    for (const gg of state.graphs) { const d = Math.hypot(gg.x - c.x, gg.y - c.y); if (d < best) { best = d; g = gg; } }
    if (!g) g = newGraph(c.x, c.y + (el ? el.offsetHeight : 50) + 44);
    c.tokens.forEach(tt => { if (tt.graphVar === g.id) delete tt.graphVar; });
    t.graphVar = g.id; addSeries(g, c.id);
    fitGraph(g);
  }

  // ---------------- editing ----------------
  function newCalc(x, y, tokens) {
    const c = { id: state.nextId++, x: Math.max(4, Math.round(x)), y: Math.max(4, Math.round(y)), tokens: tokens || [] };
    state.calcs.push(c); cur = { id: c.id, tok: null, fresh: false }; state.lastId = c.id; return c;
  }
  function finish() { const c = cur && get(cur.id); cur = null; if (c && !c.tokens.length) removeCalc(c.id); }
  function removeCalc(id) {
    state.calcs = state.calcs.filter(c => c.id !== id);
    state.graphs.forEach(g => (g.series = g.series.filter(s => s.calcId !== id)));
    if (cur && cur.id === id) cur = null;
  }
  function freeSpot() { // below the lowest item visible in the viewport
    const vx = canvas.scrollLeft / Z, vy = canvas.scrollTop / Z, vw = canvas.clientWidth / Z, vh = canvas.clientHeight / Z;
    let x = vx + 20, best = -1;
    const items = state.calcs.map(c => [c.x, c.y, els.get(c.id)]).concat(state.graphs.map(g => [g.x, g.y, gels.get(g.id)]));
    for (const [ix, iy, el] of items) {
      const w = el ? el.offsetWidth : 120, h = el ? el.offsetHeight : 44;
      if (iy + h > vy && iy < vy + vh && ix < vx + vw && ix + w > vx && iy + h > best) { best = iy + h; x = Math.max(vx + 8, ix); }
    }
    const y = best >= 0 ? best + 18 : vy + 20;
    if (y + 60 > vy + vh) canvas.scrollTop = (y - vh / 3) * Z;
    return { x, y };
  }
  function openPad() { if (!state.padOpen) state.padOpen = true; }
  function press(k) {
    hideMenu();
    if (k === 'collapse') { state.padOpen = false; return render(); }
    if (k === '=') { const id = cur && cur.id; finish(); lastDone = id && get(id) ? id : null; if (lastDone) state.lastId = lastDone; return render(); }
    if (!cur) {
      if (['back', 'C', ')'].includes(k)) return;
      const prev = lastDone != null && get(lastDone); lastDone = null;
      if (prev) { // Tydlig chaining: new line directly below the finished calc
        const el = els.get(prev.id), x = prev.x, y = prev.y + (el ? el.offsetHeight : 44) + 10, r = vals.get(prev.id);
        if (/^[+\-*/^%]$/.test(k) && r && r.value != null) { colorOf(prev.id); newCalc(x, y, [{ t: 'ref', id: prev.id }, k === '%' ? { t: '%' } : { t: 'op', v: k }]); return render(); }
        newCalc(x, y);
      } else { const p = freeSpot(); newCalc(p.x, p.y); }
    }
    const c = get(cur.id); if (!c) { cur = null; return; }
    E.applyKey(c, cur, k); render();
  }
  function select(id, tok) {
    if (cur && cur.id !== id) finish();
    const c = get(id); if (!c) return;
    const t = tok != null ? c.tokens[tok] : null;
    cur = t && (t.t === 'num' || t.t === 'ref') ? { id, tok, fresh: true } : { id, tok: null, fresh: false };
    openPad(); render();
  }
  function insertRef(id) {
    const src = get(id); if (!src) return;
    if (!cur) { const el = els.get(id); colorOf(id); newCalc(src.x, src.y + (el ? el.offsetHeight : 44) + 12, [{ t: 'ref', id }]); openPad(); return render(); }
    const c = get(cur.id);
    if (cur.tok != null) { if (E.link(state.calcs, id, c.id, cur.tok)) { cur.fresh = true; colorOf(id); } return render(); }
    if (cur.id === id || E.dependsOn(state.calcs, id, cur.id)) return;
    if (E.isValueEnd(c.tokens[c.tokens.length - 1])) c.tokens.push({ t: 'op', v: '+' });
    c.tokens.push({ t: 'ref', id }); colorOf(id); render();
  }

  // ---------------- context menu ----------------
  function hideMenu() { menu.classList.remove('show'); }
  function copy(v) { if (v == null || !isFinite(v)) return; clip = v; try { navigator.clipboard && navigator.clipboard.writeText(E.numStr(v)).catch(() => {}); } catch (e) {} }
  function paste(c, i) {
    if (clip == null) return; const v = E.numStr(clip), t = i != null ? c.tokens[i] : null;
    if (t && (t.t === 'num' || t.t === 'ref')) { c.tokens[i] = Object.assign(t.t === 'num' ? t : {}, { t: 'num', v }); delete c.tokens[i].id; return; }
    if (E.isValueEnd(c.tokens[c.tokens.length - 1])) c.tokens.push({ t: 'op', v: '+' });
    c.tokens.push({ t: 'num', v });
  }
  function toggleSlider(t) {
    if (t.slider) { delete t.slider; return; }
    const v = parseFloat(t.v) || 0, a = Math.abs(v) || 5, max = v < 0 ? 0 : a * 2, min = v < 0 ? -a * 2 : 0, span = max - min;
    t.slider = { min, max, step: span >= 50 ? 1 : span >= 5 ? 0.1 : 0.01 };
  }
  function openMenu(p, x, y) {
    const items = [], c = p.calcId != null ? get(p.calcId) : null, t = c && p.tok != null ? c.tokens[p.tok] : null;
    if (c) {
      items.push(['Delete', () => removeCalc(c.id)]);
      items.push(['Copy', () => copy(t && t.t === 'num' ? parseFloat(t.v) : t && t.t === 'ref' ? (vals.get(t.id) || {}).value : (vals.get(c.id) || {}).value)]);
      if (clip != null) items.push(['Paste', () => paste(c, p.tok)]);
      if (c.tokens.some(tt => tt.t === 'ref' || tt.graphVar) || state.calcs.some(o => o.tokens.some(tt => tt.t === 'ref' && tt.id === c.id)))
        items.push(['Unlink All', () => { E.unlinkAll(state.calcs, c.id, vals); state.graphs.forEach(g => (g.series = g.series.filter(s => s.calcId !== c.id))); }]);
      if (t && t.t === 'num') {
        items.push([t.graphVar ? 'Unlink Graph' : 'Link with Graph', () => toggleGraph(c, p.tok)]);
        items.push([t.slider ? 'Remove Slider' : 'Slider...', () => toggleSlider(t)]);
      }
    } else if (p.g != null) {
      items.push(['Delete', () => { state.graphs = state.graphs.filter(g => g.id !== p.g); state.calcs.forEach(cc => cc.tokens.forEach(tt => { if (tt.graphVar === p.g) delete tt.graphVar; })); }]);
    } else {
      const [wx, wy] = toWorld(x, y);
      if (clip != null) items.push(['Paste', () => { finish(); newCalc(wx - 10, wy - 20, [{ t: 'num', v: E.numStr(clip) }]); }]);
      items.push(['Graph', () => { finish(); newGraph(wx - 20, wy - 20); }]);
    }
    menu.innerHTML = items.map((it, i) => `<button data-m="${i}">${it[0]}</button>`).join('');
    menu._items = items; menu.classList.add('show');
    const mw = menu.offsetWidth, vw = document.documentElement.clientWidth;
    menu.style.left = Math.max(6, Math.min(vw - mw - 6, x - mw / 2)) + 'px';
    menu.style.top = Math.max(6, y - 64) + 'px';
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
  }
  menu.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const f = menu._items[+b.dataset.m][1]; hideMenu(); f(); render(); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#menu')) hideMenu(); }, true);
  document.addEventListener('contextmenu', e => e.preventDefault());

  // ---------------- pointer interaction ----------------
  let P = null, dropEl = null;
  function setDrop(el) { if (dropEl === el) return; if (dropEl) dropEl.classList.remove('drop'); dropEl = el; if (el) el.classList.add('drop'); }
  function dropTarget(x, y, src) {
    const t = document.elementFromPoint(x, y); if (!t) return null;
    const tok = t.closest('.tok'), cEl = t.closest('.calc'), gEl = t.closest('.graph');
    if (tok && cEl && +cEl.dataset.id !== src) return tok;
    if (gEl) return gEl;
    return null;
  }
  function drawLink(p, x, y) {
    const resEl = els.get(p.res) && els.get(p.res).querySelector('.res'), r0 = vals.get(p.res); if (!resEl || !r0 || r0.value == null) return;
    const col = peekColor(p.res), gx = x, gy = y - GHOST_DY;
    ghost.textContent = fmtVal(r0.value); ghost.style.background = col; ghost.style.left = gx + 'px'; ghost.style.top = gy + 'px'; ghost.classList.add('show');
    const r = resEl.getBoundingClientRect(), x1 = r.left + r.width / 2, y1 = r.bottom;
    const curve = (xa, ya, xb, yb) => { const k = Math.max(30, Math.abs(yb - ya) * 0.5); return `M${xa} ${ya} C${xa} ${ya + k} ${xb} ${yb - k} ${xb} ${yb}`; };
    let d = `<path stroke="${col}" d="${curve(x1, y1, gx, gy - 18)}"/>`;
    els.forEach((el, id) => { if (id === p.res) return; el.querySelectorAll('.tok.ref').forEach(te => {
      const c = get(id), t = c && c.tokens[+te.dataset.i]; if (!t || t.id !== p.res) return;
      const tr = te.getBoundingClientRect(); d += `<path stroke="${col}" d="${curve(x1, y1, tr.left + tr.width / 2, tr.top)}"/>`; }); });
    svg.innerHTML = d; svg.style.display = 'block';
    setDrop(nearActive(p.res, gx, gy) ? els.get(cur.id) : dropTarget(gx, gy, p.res));
  }
  function endLink() { svg.style.display = 'none'; svg.innerHTML = ''; ghost.classList.remove('show'); setDrop(null); }
  function nearActive(src, x, y) { // dropping next to / onto the equation being typed
    if (!cur || cur.tok != null || cur.id === src) return false;
    const el = els.get(cur.id); if (!el) return false; const r = el.getBoundingClientRect();
    return x >= r.left - 24 && x <= r.right + 160 && y >= r.top - 32 && y <= r.bottom + 32;
  }
  function dropLink(src, gx, gy) {
    if (nearActive(src, gx, gy)) {
      const c = get(cur.id); if (E.dependsOn(state.calcs, src, c.id)) return;
      if (E.isValueEnd(c.tokens[c.tokens.length - 1])) c.tokens.push({ t: 'op', v: '*' });
      c.tokens.push({ t: 'ref', id: src }); colorOf(src); return;
    }
    const tgt = dropTarget(gx, gy, src);
    if (tgt && tgt.classList.contains('tok')) { if (E.link(state.calcs, src, +tgt.closest('.calc').dataset.id, +tgt.dataset.i)) colorOf(src); return; }
    if (tgt) { const g = getG(+tgt.dataset.g); addSeries(g, src); vals = E.evaluateAll(state.calcs); fitGraph(g); return; }
    const hit = document.elementFromPoint(gx, gy); if (hit && hit.closest('.calc, .graph')) return;
    // empty canvas: pending linked value; the next operator continues the equation from it
    const [wx, wy] = toWorld(gx, gy), gw = ghost.offsetWidth / Z;
    finish(); colorOf(src); newCalc(wx - gw / 2 - 11, wy - 24, [{ t: 'ref', id: src }]); openPad();
  }
  world.addEventListener('pointerdown', e => {
    lastDone = null;
    if (e.button > 0 || e.target.closest('.slider, button')) return;
    const cEl = e.target.closest('.calc'), gEl = e.target.closest('.graph'), resEl = e.target.closest('.res'), tokEl = e.target.closest('.tok');
    P = { sx: e.clientX, sy: e.clientY, pid: e.pointerId, moved: false, mode: null, long: false, el: cEl || gEl,
      calcId: cEl ? +cEl.dataset.id : null, res: resEl && !resEl.classList.contains('err') ? +resEl.dataset.res : null,
      tok: tokEl ? +tokEl.dataset.i : null, g: gEl ? +gEl.dataset.g : null, onBar: !!e.target.closest('.gbar') };
    if (P.calcId != null) { const c = get(P.calcId); P.ox = c.x; P.oy = c.y; }
    if (P.g != null) { const g = getG(P.g); P.ox = g.x; P.oy = g.y; P.gcx = g.cx; P.gcy = g.cy; }
    if (P.el) { try { P.el.setPointerCapture(e.pointerId); } catch (err) {} }
    const p = P; p.timer = setTimeout(() => { if (P === p && !p.moved) { p.long = true; openMenu(p, p.sx, p.sy); } }, 500);
  });
  world.addEventListener('pointermove', e => {
    const p = P; if (!p || e.pointerId !== p.pid) return;
    const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
    if (!p.moved) {
      if (Math.hypot(dx, dy) < 10) return;
      if (p.long && p.calcId == null && p.g == null) return; // empty-canvas menu stays
      p.moved = true; p.long = false; hideMenu(); clearTimeout(p.timer);
      p.mode = p.res != null ? 'link' : p.calcId != null ? 'move' : p.g != null ? (p.onBar ? 'gmove' : 'gpan') : 'scroll';
      if (p.mode === 'scroll') { p.sl = canvas.scrollLeft; p.st = canvas.scrollTop; return; }
      try { p.el.setPointerCapture(e.pointerId); } catch (err) {}
      if (p.mode === 'move') p.el.classList.add('dragging');
    }
    if (p.mode === 'scroll') { canvas.scrollLeft = p.sl - dx; canvas.scrollTop = p.st - dy; }
    else if (p.mode === 'link') drawLink(p, e.clientX, e.clientY);
    else if (p.mode === 'move') { const c = get(p.calcId); c.x = Math.max(0, p.ox + dx / Z); c.y = Math.max(0, p.oy + dy / Z); p.el.style.left = c.x + 'px'; p.el.style.top = c.y + 'px'; }
    else if (p.mode === 'gmove') { const g = getG(p.g); g.x = Math.max(0, p.ox + dx / Z); g.y = Math.max(0, p.oy + dy / Z); p.el.style.left = g.x + 'px'; p.el.style.top = g.y + 'px'; }
    else if (p.mode === 'gpan') { const g = getG(p.g); g.cx = p.gcx - dx / Z / g.s; g.cy = p.gcy + dy / Z / (g.ys || g.s); drawGraph(g, p.el); }
  });
  world.addEventListener('pointerup', e => {
    const p = P; if (!p || e.pointerId !== p.pid) return; P = null; clearTimeout(p.timer);
    if (p.long) return;
    if (p.mode === 'link') {
      endLink(); dropLink(p.res, e.clientX, e.clientY - GHOST_DY); return render();
    }
    if (p.mode) { if (p.el) p.el.classList.remove('dragging'); return save(); }
    if (p.g != null) return;
    if (p.res != null && !(cur && cur.id === p.res)) return insertRef(p.res);
    if (p.calcId != null) return select(p.calcId, p.tok);
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    finish(); newCalc(wx - 10, wy - 22); openPad(); render();
  });
  // ---- two-finger pinch zoom + pan about the midpoint ----
  const touches = new Map(); let pinch = null;
  const two = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  function abortItemGesture() {
    const p = P; P = null; if (!p) return; clearTimeout(p.timer); hideMenu(); endLink();
    if (p.mode === 'move') { const c = get(p.calcId); if (c) { c.x = p.ox; c.y = p.oy; } }
    if (p.mode === 'gmove') { const g = getG(p.g); if (g) { g.x = p.ox; g.y = p.oy; } }
    if (p.el) p.el.classList.remove('dragging'); render();
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) { touches.clear(); pinch = null; }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      abortItemGesture(); const t = two(), cr = canvas.getBoundingClientRect();
      pinch = { d0: t.d, z0: Z, wx: (canvas.scrollLeft + t.mx - cr.left) / Z, wy: (canvas.scrollTop + t.my - cr.top) / Z };
    }
    if (touches.size >= 2) e.stopPropagation();
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size < 2) return; e.stopPropagation();
    const t = two(), cr = canvas.getBoundingClientRect(); setZoom(pinch.z0 * t.d / pinch.d0);
    canvas.scrollLeft = pinch.wx * Z - (t.mx - cr.left); canvas.scrollTop = pinch.wy * Z - (t.my - cr.top);
  }, true);
  const lift = e => { if (!touches.delete(e.pointerId)) return; if (pinch) { e.stopPropagation(); if (touches.size < 2) { pinch = null; saveView(); } } };
  window.addEventListener('pointerup', lift, true); window.addEventListener('pointercancel', lift, true);
  // trackpad pinch / ctrl+wheel zoom about the cursor
  canvas.addEventListener('wheel', e => {
    if (!e.ctrlKey || e.defaultPrevented) return; e.preventDefault(); const cr = canvas.getBoundingClientRect(), mx = e.clientX - cr.left, my = e.clientY - cr.top;
    const wx = (canvas.scrollLeft + mx) / Z, wy = (canvas.scrollTop + my) / Z; setZoom(Z * Math.exp(-e.deltaY * 0.01));
    canvas.scrollLeft = wx * Z - mx; canvas.scrollTop = wy * Z - my; saveView();
  }, { passive: false });
  let viewT = null; function saveView() { clearTimeout(viewT); viewT = setTimeout(() => { state.sx = canvas.scrollLeft; state.sy = canvas.scrollTop; save(); }, 150); }
  canvas.addEventListener('scroll', saveView, { passive: true });
  canvas.addEventListener('touchmove', e => { if (!e.target.closest('.slider')) e.preventDefault(); }, { passive: false });
  world.addEventListener('touchmove', e => { if (P && P.el) e.preventDefault(); }, { passive: false });
  world.addEventListener('touchstart', e => { if (e.target.closest('.calc, .graph') && !e.target.closest('.slider, button')) e.preventDefault(); }, { passive: false });
  world.addEventListener('pointercancel', () => { if (P) { clearTimeout(P.timer); if (P.el) P.el.classList.remove('dragging'); } P = null; endLink(); });
  world.addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return; const g = getG(+b.closest('.graph').dataset.g);
    const z = b.dataset.z === 'in' ? 1.5 : b.dataset.z === 'out' ? 1 / 1.5 : 0; if (z) { g.s *= z; g.ys = (g.ys || g.s / z) * z; } else fitGraph(g);
    render();
  });
  world.addEventListener('wheel', e => { const gEl = e.target.closest('.graph'); if (!gEl) return; e.preventDefault(); const g = getG(+gEl.dataset.g); const z = e.deltaY < 0 ? 1.15 : 1 / 1.15; g.ys = (g.ys || g.s) * z; g.s *= z; drawGraph(g, gEl); save(); }, { passive: false });
  world.addEventListener('input', e => {
    const s = e.target; if (!s.classList || !s.classList.contains('slider')) return;
    const c = get(+s.dataset.calc), t = c && c.tokens[+s.dataset.i]; if (!t) return;
    t.v = E.numStr(+s.value); sliding = true; render(); sliding = false;
  });

  const backBtn = pad.querySelector('[data-k="back"]'); let armed = false, armT = null, bs = null, swallow = false, upT = 0;
  function arm() { armed = true; backBtn.classList.add('armed'); clearTimeout(armT); armT = setTimeout(disarm, 3000); }
  function disarm() { armed = false; backBtn.classList.remove('armed'); clearTimeout(armT); }
  backBtn.addEventListener('pointerdown', e => { swallow = false; bs = { x: e.clientX, y: e.clientY }; try { backBtn.setPointerCapture(e.pointerId); } catch (err) {} });
  backBtn.addEventListener('pointermove', e => { if (!bs) return; const dx = Math.abs(e.clientX - bs.x), dy = Math.abs(e.clientY - bs.y); if (dx > 24 && dx > dy) { bs = null; swallow = true; arm(); } });
  backBtn.addEventListener('pointerup', () => { const tapped = !!bs; bs = null; if (tapped) backTap(); });
  backBtn.addEventListener('pointercancel', () => { bs = null; });
  function backTap() { if (armed) { disarm(); return clearAll(); } press('back'); }
  document.addEventListener('pointerdown', e => { if (armed && !backBtn.contains(e.target)) disarm(); }, true);
  function clearAll() { state.calcs = []; state.graphs = []; state.colors = {}; state.nextColor = 0; state.lastId = null; cur = null; lastDone = null; render(); }
  // keys fire on pointerdown (each pointer independently): Chrome drops `click` when another finger is down or the finger slides
  pad.addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b || b === backBtn) return;
    e.preventDefault(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 110);
    press(b.dataset.k);
  });
  pad.addEventListener('click', e => { // keyboard activation only (Enter/Space on a focused key)
    const b = e.target.closest('button'); if (!b || e.detail !== 0) return;
    if (b === backBtn) backTap(); else press(b.dataset.k);
  });
  fab.addEventListener('pointerdown', e => { e.preventDefault(); state.padOpen = true; render(); });
  document.addEventListener('keydown', e => {
    const m = { Enter: '=', Backspace: 'back', Escape: '=', x: '*', X: '*', Delete: 'C' }; const k = m[e.key] || e.key;
    if (/^[0-9.+\-*/^%()]$/.test(k) || ['=', 'back', 'C'].includes(k)) { e.preventDefault(); press(k); }
  });

  setZoom(state.zoom); render(); canvas.scrollLeft = state.sx; canvas.scrollTop = state.sy;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
