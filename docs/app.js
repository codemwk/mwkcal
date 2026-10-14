(function () {
  'use strict';
  const E = window.TydligEngine, KEY = 'tydlig-state-v1';
  const world = document.getElementById('world'), canvas = document.getElementById('canvas');
  const pad = document.getElementById('pad'), hint = document.getElementById('hint');
  let state = load(), active = null, lastVals = new Map();

  function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.calcs)) return s; } catch (e) {} return { calcs: [], nextId: 1 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  const get = id => state.calcs.find(c => c.id === id);
  const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^' };

  function exprHTML(c, vals) {
    let h = '';
    for (let i = 0; i < c.tokens.length; i++) {
      const t = c.tokens[i];
      if (t.t === 'num') h += esc(fmtNum(t.v));
      else if (t.t === 'ref') { const r = vals.get(t.id); h += `<span class="ref">${r && r.value !== null ? E.format(r.value) : '?'}</span>`; }
      else if (t.t === 'op') h += t.v === '^' ? '<span class="op">^</span>' : `<span class="op">${OPS[t.v]}</span>`;
      else h += t.t;
    }
    if (c.id === active) h += '<span class="caret"></span>';
    return h;
  }
  function fmtNum(s) { const [a, b] = s.split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b !== undefined ? '.' + b : ''); }
  function esc(s) { return s.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

  function render() {
    const vals = E.evaluateAll(state.calcs);
    world.innerHTML = '';
    for (const c of state.calcs) {
      const r = vals.get(c.id) || {};
      const el = document.createElement('div');
      el.className = 'calc' + (c.id === active ? ' active' : ''); el.dataset.id = c.id;
      el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
      let res = '';
      if (r.error) res = `<span class="eqs">=</span><span class="res err">${r.error === 'incomplete' ? '…' : '오류'}</span>`;
      else if (r.value !== null && r.value !== undefined) {
        const changed = lastVals.has(c.id) && lastVals.get(c.id) !== r.value && c.id !== active;
        res = `<span class="eqs">=</span><span class="res${changed ? ' flash' : ''}" data-res="${c.id}">${E.format(r.value)}</span>`;
      }
      el.innerHTML = `<span class="expr">${exprHTML(c, vals)}</span>${res}`;
      world.appendChild(el);
    }
    lastVals = new Map([...vals].map(([k, v]) => [k, v.value]));
    hint.style.display = state.calcs.length ? 'none' : '';
    pad.classList.toggle('hidden', active === null);
    save();
  }

  function newCalc(x, y, tokens) {
    const c = { id: state.nextId++, x: Math.max(4, Math.round(x)), y: Math.max(4, Math.round(y)), tokens: tokens || [] };
    state.calcs.push(c); active = c.id; return c;
  }
  function finish() {
    const c = get(active); active = null;
    if (c && !c.tokens.length) removeCalc(c.id);
  }
  function removeCalc(id) { state.calcs = state.calcs.filter(c => c.id !== id); if (active === id) active = null; }
  function isValueEnd(t) { return t && (t.t === 'num' || t.t === 'ref' || t.t === ')' || t.t === '%'); }

  function press(k) {
    if (k === 'done' || k === '=') { finish(); return render(); }
    if (k === 'del-calc') { if (active !== null) removeCalc(active); return render(); }
    const c = get(active); if (!c) return;
    const T = c.tokens, last = T[T.length - 1];
    if (/^[0-9.]$/.test(k)) {
      if (last && last.t === 'num') { if (k === '.' && last.v.includes('.')) return; if (last.v === '0' && k !== '.') last.v = k; else last.v += k; }
      else { if (isValueEnd(last)) T.push({ t: 'op', v: '*' }); T.push({ t: 'num', v: k === '.' ? '0.' : k }); }
    } else if ('+-*/^'.includes(k)) {
      if (!last || last.t === '(') { if (k === '-') T.push({ t: 'op', v: '-' }); }
      else if (last.t === 'op') { if (k === '-' && last.v !== '-' && last.v !== '+') T.push({ t: 'op', v: '-' }); else if (T.length > 1 && T[T.length - 2].t !== 'op') last.v = k; }
      else T.push({ t: 'op', v: k });
    } else if (k === '%') { if (isValueEnd(last) && last.t !== '%') T.push({ t: '%' }); }
    else if (k === '(') { if (isValueEnd(last)) T.push({ t: 'op', v: '*' }); T.push({ t: '(' }); }
    else if (k === ')') { const open = T.filter(t => t.t === '(').length - T.filter(t => t.t === ')').length; if (open > 0 && isValueEnd(last)) T.push({ t: ')' }); }
    else if (k === 'back') { if (last && last.t === 'num' && last.v.length > 1) last.v = last.v.slice(0, -1); else T.pop(); }
    else if (k === 'C') { c.tokens = []; }
    render();
  }
  function insertRef(id) {
    const src = get(id); if (!src) return;
    if (active === null) { newCalc(src.x, src.y + 56, [{ t: 'ref', id }]); return render(); }
    if (active === id || E.dependsOn(state.calcs, id, active)) return; // would create a cycle
    const T = get(active).tokens, last = T[T.length - 1];
    if (isValueEnd(last)) T.push({ t: 'op', v: '+' });
    T.push({ t: 'ref', id }); render();
  }

  pad.addEventListener('click', e => { const b = e.target.closest('button'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', e => {
    const m = { Enter: '=', Backspace: 'back', Escape: 'done', x: '*', X: '*', Delete: 'C' }; const k = m[e.key] || e.key;
    if (/^[0-9.+\-*/^%()]$/.test(k) || ['=', 'back', 'done', 'C'].includes(k)) { e.preventDefault(); press(k); }
  });

  // Pointer: tap empty → new calc, tap calc → edit, tap result → reference, drag calc → move
  let drag = null;
  world.addEventListener('pointerdown', e => {
    const el = e.target.closest('.calc');
    drag = { el, id: el ? +el.dataset.id : null, sx: e.clientX, sy: e.clientY, moved: false, resId: e.target.dataset && e.target.dataset.res ? +e.target.dataset.res : null, pid: e.pointerId };
    if (el) { const c = get(drag.id); drag.ox = c.x; drag.oy = c.y; }
  });
  world.addEventListener('pointermove', e => {
    if (!drag || !drag.el || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 8) { drag.moved = true; drag.el.setPointerCapture(e.pointerId); drag.el.classList.add('dragging'); }
    if (drag.moved) { const c = get(drag.id); c.x = Math.max(0, drag.ox + dx); c.y = Math.max(0, drag.oy + dy); drag.el.style.left = c.x + 'px'; drag.el.style.top = c.y + 'px'; }
  });
  world.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.pid) return; const d = drag; drag = null;
    if (d.moved) { save(); d.el.classList.remove('dragging'); return; }
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) return; // was a scroll
    if (d.resId !== null && d.resId !== active) return insertRef(d.resId);
    if (d.id !== null) { if (active !== d.id) { finish(); active = d.id; } return render(); }
    const r = world.getBoundingClientRect();
    if (active !== null) finish();
    newCalc(e.clientX - r.left - 10, e.clientY - r.top - 20); render();
  });
  world.addEventListener('pointercancel', () => { if (drag && drag.el) drag.el.classList.remove('dragging'); drag = null; });

  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
