// Tydlig engine: tokenizer-free token model, recursive-descent evaluator, dependency graph. No eval.
(function (root) {
  'use strict';
  // token: {t:'num',v:'12.5'} | {t:'op',v:'+-*/^'} | {t:'(' } | {t:')'} | {t:'%'} | {t:'ref',id}
  function evaluate(tokens, resolveRef) {
    let i = 0;
    const peek = () => tokens[i];
    const err = (m) => { throw new Error(m); };
    function primary() {
      const tk = tokens[i];
      if (!tk) err('incomplete');
      if (tk.t === 'num') { i++; const v = parseFloat(tk.v); if (!isFinite(v)) err('bad number'); return v; }
      if (tk.t === 'ref') { i++; return resolveRef(tk.id); }
      if (tk.t === '(') { i++; const r = addExpr(); const v = r.pct ? r.v / 100 : r.v; if (!peek() || peek().t !== ')') { if (!peek()) return v; err('expected )'); } i++; return v; }
      if (tk.t === 'op' && tk.v === '-') { i++; return -unaryPow(); }
      if (tk.t === 'op' && tk.v === '+') { i++; return unaryPow(); }
      err('unexpected ' + (tk.v || tk.t));
    }
    function unaryPow() { // power, right-assoc, binds tighter than unary minus on its left
      const base = primary();
      if (peek() && peek().t === 'op' && peek().v === '^') { i++; return Math.pow(base, unaryPow()); }
      return base;
    }
    function postfix() { // returns {v, pct}
      const v = unaryPow();
      if (peek() && peek().t === '%') { i++; return { v, pct: true }; }
      return { v, pct: false };
    }
    function mulExpr() {
      let f = postfix(), first = true, acc = f.v;
      while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        if (first && f.pct) acc = f.v / 100;
        first = false;
        const op = tokens[i++].v; const r = postfix(); const rv = r.pct ? r.v / 100 : r.v;
        if (op === '*') acc *= rv; else { if (rv === 0) err('÷0'); acc /= rv; }
      }
      return first ? f : { v: acc, pct: false };
    }
    function addExpr() {
      let l = mulExpr(); let acc = l.pct ? l.v / 100 : l.v; let only = true;
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        only = false;
        const op = tokens[i++].v; const r = mulExpr();
        const rv = r.pct ? acc * r.v / 100 : r.v; // 200+10% = 220
        acc = op === '+' ? acc + rv : acc - rv;
      }
      return only ? l : { v: acc, pct: false };
    }
    if (!tokens.length) return null;
    const r = addExpr();
    if (i < tokens.length) err('unexpected ' + (tokens[i].v || tokens[i].t));
    const v = r.pct ? r.v / 100 : r.v;
    if (!isFinite(v)) err('overflow');
    return v;
  }

  // Evaluate all calcs; returns map id -> {value, error}
  function evaluateAll(calcs) {
    const byId = new Map(calcs.map(c => [c.id, c]));
    const out = new Map(); const visiting = new Set();
    function calc(id) {
      if (out.has(id)) { const o = out.get(id); if (o.error) throw new Error('ref error'); return o.value; }
      const c = byId.get(id); if (!c) throw new Error('missing ref');
      if (visiting.has(id)) throw new Error('cycle');
      visiting.add(id);
      let res;
      try { const v = evaluate(c.tokens, calc); res = { value: v, error: null }; }
      catch (e) { res = { value: null, error: e.message }; }
      visiting.delete(id); out.set(id, res);
      if (res.error) throw new Error('ref error');
      if (res.value === null) throw new Error('empty ref');
      return res.value;
    }
    for (const c of calcs) { try { calc(c.id); } catch (e) { if (!out.has(c.id)) out.set(c.id, { value: null, error: e.message }); } }
    return out;
  }

  function dependsOn(calcs, id, target) { // does calc id (transitively) reference target?
    const byId = new Map(calcs.map(c => [c.id, c])); const seen = new Set(); const st = [id];
    while (st.length) { const x = st.pop(); if (x === target) return true; if (seen.has(x)) continue; seen.add(x);
      const c = byId.get(x); if (c) c.tokens.forEach(t => t.t === 'ref' && st.push(t.id)); }
    return false;
  }

  function format(v) {
    if (v === null || v === undefined) return '';
    if (Object.is(v, -0)) v = 0;
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e15 || a < 1e-6)) return v.toExponential(3).replace(/\.?0+e/, 'e');
    // Tydlig style: max 4 decimals; below 1, 4 significant digits (1042/1065 → 0.9784)
    let s = parseFloat(a < 1 ? v.toPrecision(4) : v.toFixed(4)).toString();
    const [ip, fp] = s.split('.');
    return ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fp ? '.' + fp : '');
  }


  // ---------- editing helpers (pure, mutate calc tokens) ----------
  const isValueEnd = t => !!t && (t.t === 'num' || t.t === 'ref' || t.t === ')' || t.t === '%');
  // cur = {tok: index|null, fresh: bool}; tok!=null means a specific number token is selected
  function applyKey(c, cur, k) {
    const T = c.tokens;
    if (cur.tok != null) {
      const t = T[cur.tok];
      if (!t) cur.tok = null;
      else if (/^[0-9.]$/.test(k)) {
        if (t.t !== 'num') { T[cur.tok] = { t: 'num', v: k === '.' ? '0.' : k }; cur.fresh = false; return cur; }
        if (cur.fresh) { t.v = k === '.' ? '0.' : k; cur.fresh = false; return cur; }
        if (k === '.' && t.v.includes('.')) return cur;
        if ((t.v === '0' || t.v === '-0') && k !== '.') t.v = t.v.replace('0', k); else t.v += k;
        return cur;
      } else if (k === 'back') {
        if (t.t === 'num') { const nv = t.v.slice(0, -1); if (nv === '' || nv === '-') { t.v = '0'; cur.fresh = true; } else { t.v = nv; cur.fresh = false; } }
        else { T[cur.tok] = { t: 'num', v: '0' }; cur.fresh = true; }
        return cur;
      } else if (k === 'neg') { if (t.t === 'num') t.v = t.v[0] === '-' ? t.v.slice(1) : '-' + t.v; return cur; }
      else if (k === 'C') { if (t.t === 'num') t.v = '0'; else T[cur.tok] = { t: 'num', v: '0' }; cur.fresh = true; return cur; }
      else cur.tok = null; // operators etc. continue at the end of the expression
    }
    const last = T[T.length - 1];
    if (/^[0-9.]$/.test(k)) {
      if (last && last.t === 'num') { if (k === '.' && last.v.includes('.')) return cur; if ((last.v === '0' || last.v === '-0') && k !== '.') last.v = last.v.replace('0', k); else last.v += k; }
      else { if (isValueEnd(last)) T.push({ t: 'op', v: '*' }); T.push({ t: 'num', v: k === '.' ? '0.' : k }); }
    } else if ('+-*/^'.includes(k) && k.length === 1) {
      if (!last || last.t === '(') { if (k === '-') T.push({ t: 'op', v: '-' }); }
      else if (last.t === 'op') { if (k === '-' && last.v !== '-' && last.v !== '+') T.push({ t: 'op', v: '-' }); else if (T.length > 1 && T[T.length - 2].t !== 'op') last.v = k; }
      else T.push({ t: 'op', v: k });
    } else if (k === '%') { if (isValueEnd(last) && last.t !== '%') T.push({ t: '%' }); }
    else if (k === '(') { if (isValueEnd(last)) T.push({ t: 'op', v: '*' }); T.push({ t: '(' }); }
    else if (k === ')') { const open = T.filter(t => t.t === '(').length - T.filter(t => t.t === ')').length; if (open > 0 && isValueEnd(last)) T.push({ t: ')' }); }
    else if (k === 'back') { if (last && last.t === 'num' && last.v.replace('-', '').length > 1) last.v = last.v.slice(0, -1); else T.pop(); }
    else if (k === 'neg') { if (last && last.t === 'num') last.v = last.v[0] === '-' ? last.v.slice(1) : '-' + last.v; else if (!last || last.t === 'op' || last.t === '(') T.push({ t: 'num', v: '-0' }); }
    else if (k === 'C') { T.length = 0; }
    return cur;
  }
  // replace token idx of calc dstId with a live reference to srcId; refuses self/cycles
  function link(calcs, srcId, dstId, idx) {
    const dst = calcs.find(c => c.id === dstId);
    if (!dst || srcId === dstId || !dst.tokens[idx] || dependsOn(calcs, srcId, dstId)) return false;
    const t = dst.tokens[idx]; if (t.t !== 'num' && t.t !== 'ref') return false;
    dst.tokens[idx] = { t: 'ref', id: srcId }; return true;
  }
  const numStr = v => String(parseFloat(v.toPrecision(12)));
  // freeze every link touching calc id (its refs and refs to it) into plain numbers; drop graph vars
  function unlinkAll(calcs, id, vals) {
    for (const c of calcs) c.tokens.forEach((t, i) => {
      if (t.t === 'ref' && (c.id === id || t.id === id)) { const r = vals.get(t.id); c.tokens[i] = { t: 'num', v: r && r.value != null ? numStr(r.value) : '0' }; }
      if (c.id === id && t.graphVar) delete t.graphVar;
    });
  }
  // y = f(x) where token idx of calc c is replaced by x; refs resolved from vals
  function plotFn(c, idx, vals) {
    return x => {
      const T = c.tokens.slice(); T[idx] = { t: 'num', v: String(x) };
      try { const v = evaluate(T, id => { const r = vals.get(id); if (!r || r.value == null) throw new Error('ref'); return r.value; }); return v == null ? NaN : v; }
      catch (e) { return NaN; }
    };
  }

  const api = { evaluate, evaluateAll, dependsOn, format, applyKey, link, unlinkAll, plotFn, isValueEnd, numStr };
  if (typeof module !== 'undefined') module.exports = api; else root.TydligEngine = api;
})(this);
