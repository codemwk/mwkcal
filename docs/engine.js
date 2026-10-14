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
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return v.toExponential(6).replace(/\.?0+e/, 'e');
    let s = parseFloat(v.toPrecision(12)).toString();
    const [ip, fp] = s.split('.');
    return ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fp ? '.' + fp : '');
  }

  const api = { evaluate, evaluateAll, dependsOn, format };
  if (typeof module !== 'undefined') module.exports = api; else root.TydligEngine = api;
})(this);
