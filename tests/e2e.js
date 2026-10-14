// Browser e2e: node tests/e2e.js  (URL env overrides http://localhost:8765/)
const { chromium } = require('playwright-core');
const center = async (p, sel) => { const bb = await p.locator(sel).first().boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
const G = 44; // ghost pill floats this far above the finger
const URL = process.env.URL || 'http://localhost:8765/';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const errs = [];
  for (const [w, h, name, dark] of [[412, 915, 'folded', false], [884, 1104, 'unfolded', true]]) {
    console.log(name);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
    const p = await ctx.newPage(); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.screenshot({ path: `screens/${name}-empty.png` });
    const k = async s => { for (const c of (Array.isArray(s) ? s : [...s])) await p.click(`#pad button[data-k="${c}"]`); };
    const res = id => p.textContent(`[data-res="${id}"]`);
    const centerOld = async sel => { const bb = await p.locator(sel).first().boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
    const longPress = async sel => { const [x, y] = await center(p, sel); await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.up(); };
    const menuClick = async label => { await p.click(`#menu button:text-is("${label}")`); };

    // 1. type without selecting anything
    await k('2+3='); ok(await p.locator('.calc').count() === 1 && (await res(1)) === '5', 'type-without-select creates calc 2+3=5');
    await k('=');
    await k('1/0='); ok((await res(2)) === '?', 'auto-spot second calc; 1/0 shows ?');
    const [y1, y2] = await p.evaluate(() => [...document.querySelectorAll('.calc')].map(e => e.offsetTop)); ok(y2 > y1, 'auto-placed below previous');
    await k('='); await longPress('.calc[data-id="2"] .op'); await menuClick('Delete'); ok(await p.locator('.calc').count() === 1, 'long-press Delete');

    // tap empty canvas → new calc
    await p.mouse.click(40, 230); await k('100/4='); ok((await res(3)) === '25', 'tap-empty new calc 100/4=25');

    // 2. drag-to-link: result of #1 onto the "4" of #3
    const [sx, sy] = await center(p, '[data-res="1"]'), [tx, ty] = await center(p, '.calc[data-id="3"] .tok[data-i="2"]');
    await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx + 20, sy + 30, { steps: 4 }); await p.mouse.move(tx, ty + G, { steps: 8 });
    ok(await p.locator('#linkLayer').isVisible(), 'blue bezier visible while dragging');
    await p.mouse.up();
    ok((await res(3)) === '20' && await p.locator('.calc[data-id="3"] .tok.ref').count() === 1, 'drag-link replaced 4 with live ref → 20');
    ok(await p.locator('[data-res="1"].linked').count() === 1, 'source result shows linked outline');

    // 3. direct number edit + cascade
    await p.click('.calc[data-id="1"] .tok[data-i="0"]'); ok(await p.locator('.tok.sel').count() === 1, 'number token selected (orange)');
    await k('7'); ok((await res(1)) === '10' && (await res(3)) === '10', 'edit 2→7 cascades: #1=10, #3=10');
    await k('=');

    // 4 + 6. long-press menu + slider on "100"
    await longPress('.calc[data-id="3"] .tok[data-i="0"]');
    const items = await p.$$eval('#menu button', bs => bs.map(b => b.textContent)); ok(['Delete', 'Copy', 'Unlink All', 'Link with Graph', 'Slider...'].every(x => items.includes(x)), 'menu items: ' + items.join(' | '));
    await p.screenshot({ path: `screens/${name}-menu.png` });
    await menuClick('Slider...'); ok(await p.locator('.slider').count() === 1, 'slider spawned');
    await p.locator('.slider').fill('50'); ok((await res(3)) === '5', 'slider 50 → 50/10 = 5');

    // 5. graph: link "100" var with graph, then drop #1 result as horizontal line
    await longPress('.calc[data-id="3"] .tok[data-i="0"]'); await menuClick('Link with Graph');
    ok(await p.locator('.graph').count() === 1 && await p.locator('.tok.gvar').count() === 1, 'graph created, var purple');
    await p.locator('.graph').scrollIntoViewIfNeeded();
    const [s2x, s2y] = await center(p, '[data-res="1"]'), [gx, gy] = await center(p, '.graph canvas');
    await p.mouse.move(s2x, s2y); await p.mouse.down(); await p.mouse.move(gx, gy + G, { steps: 10 }); await p.mouse.up();
    const series = await p.evaluate(() => JSON.parse(localStorage['mwkcal-v2']).graphs[0].series.length); ok(series === 2, 'result dropped on graph → 2 series');
    await p.locator('.slider').fill('80'); ok((await res(3)) === '8', 'slider scrub after graph link → 8');
    await p.screenshot({ path: `screens/${name}-graph.png` });

    // keypad collapse
    await k(['collapse']); ok(await p.locator('#padFab').isVisible() && !(await p.locator('#pad').isVisible()), 'keypad collapses'); await p.screenshot({ path: `screens/${name}-collapsed.png` });
    await p.click('#padFab');

    await p.reload(); ok(await p.locator('.calc').count() === 2 && await p.locator('.graph').count() === 1 && (await res(3)) === '8', 'state persists after reload');
    ok(await p.evaluate(async () => !!(await navigator.serviceWorker.ready)), 'service worker ready');
    await ctx.close();
  }

  // ---- real touch (CDP Input.dispatchTouchEvent) + Tydlig chaining, fresh page per viewport ----
  for (const [w, h, name] of [[412, 915, 'folded'], [884, 1104, 'unfolded']]) {
    console.log(name + ' (touch + chaining)');
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); const cdp = await ctx.newCDPSession(p);
    const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const touchDrag = async (x1, y1, x2, y2, hold = 0) => { await T('touchStart', x1, y1); if (hold) await p.waitForTimeout(hold);
      for (let i = 1; i <= 12; i++) { await T('touchMove', x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12); await p.waitForTimeout(16); } await T('touchEnd'); await p.waitForTimeout(50); };
    const tap = async (x, y) => { await T('touchStart', x, y); await p.waitForTimeout(40); await T('touchEnd'); await p.waitForTimeout(50); };
    const k = async s => { for (const c of (Array.isArray(s) ? s : [...s])) { const [x, y] = await center(p, `#pad button[data-k="${c}"]`); await tap(x, y); } };
    const res = id => p.textContent(`[data-res="${id}"]`);
    const pos = id => p.evaluate(i => { const e = document.querySelector(`.calc[data-id="${i}"]`); return [e.offsetLeft, e.offsetTop, e.offsetHeight]; }, id);

    await k('12+3='); ok((await res(1)) === '15', 'touch keypad 12+3=15');
    await k('+'); const t2 = await p.evaluate(() => JSON.parse(localStorage['mwkcal-v2']).calcs[1].tokens);
    ok(t2.length === 2 && t2[0].t === 'ref' && t2[0].id === 1 && t2[1].v === '+', 'operator after = starts new line: [ref#1, +]');
    await k('5='); ok((await res(2)) === '20', 'chained 15+5=20');
    const [x1, y1, h1] = await pos(1), [x2, y2] = await pos(2); ok(x2 === x1 && y2 >= y1 + h1, 'chained line directly below');
    await k('*2='); ok((await res(3)) === '40', 'second chain ×2 = 40');
    await k('7='); const c4 = await p.evaluate(() => JSON.parse(localStorage['mwkcal-v2']).calcs[3].tokens);
    ok(c4.length === 1 && c4[0].t === 'num' && (await res(4)) === '7', 'digit after = starts fresh line');
    const [, y3, h3] = await pos(3), [, y4] = await pos(4); ok(y4 >= y3 + h3, 'fresh line below previous');
    let [tx, ty] = await center(p, '.calc[data-id="1"] .tok[data-i="0"]'); await tap(tx, ty); await k('2');
    ok((await res(1)) === '5' && (await res(2)) === '10' && (await res(3)) === '20', 'touch number edit cascades through chain 5→10→20');
    await k('=');

    // touch drag calc body → moves
    const [bx, by] = await center(p, '.calc[data-id="4"] .tok'); const [ox, oy] = await pos(4);
    await touchDrag(bx, by, bx + 60, by + 90); const [nx, ny] = await pos(4);
    ok(Math.abs(nx - ox - 60) < 3 && Math.abs(ny - oy - 90) < 3, `touch drag moves calc (${nx - ox},${ny - oy})`);
    // touch press-hold-drag from a result → link (hold longer than the menu delay)
    await tap(30, Math.min(h - 420, ny + 160)); await k('100/4='); const id5 = await p.evaluate(() => Math.max(...JSON.parse(localStorage['mwkcal-v2']).calcs.map(c => c.id)));
    const [rx, ry] = await center(p, '[data-res="1"]'); [tx, ty] = await center(p, `.calc[data-id="${id5}"] .tok[data-i="2"]`);
    await touchDrag(rx, ry, tx, ty + G, 700);
    ok((await res(id5)) === '20' && !(await p.locator('#menu.show').count()), 'touch hold+drag from result links (100/5=20), menu dismissed');
    [tx, ty] = await center(p, `[data-res="${id5}"]`); const [ex, ey] = await center(p, '.calc[data-id="4"] .tok');
    await touchDrag(tx, ty, ex, ey + G); ok((await res(4)) === '20', 'touch quick drag from result links too');
    await p.screenshot({ path: `screens/${name}-chain-touch.png` });
    await ctx.close();
  }

  // ---- exact replay of user_v2.mp4 (real Tydlig) with touch, + backspace swipe-to-clear (user_v1.mp4) ----
  for (const [w, h, name] of [[884, 1104, 'unfolded'], [412, 915, 'folded']]) {
    console.log(name + ' (video replay)');
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); const cdp = await ctx.newCDPSession(p);
    const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const drag = async (x1, y1, x2, y2, shot) => { await T('touchStart', x1, y1); for (let i = 1; i <= 14; i++) { await T('touchMove', x1 + (x2 - x1) * i / 14, y1 + (y2 - y1) * i / 14); await p.waitForTimeout(16); }
      let ghost = await p.textContent('#ghost'), lines = await p.locator('#linkLayer path').count(); if (shot) await p.screenshot({ path: shot }); await T('touchEnd'); await p.waitForTimeout(60); return { ghost, lines }; };
    const tap = async (x, y) => { await T('touchStart', x, y); await p.waitForTimeout(40); await T('touchEnd'); await p.waitForTimeout(40); };
    const k = async s => { for (const c of (Array.isArray(s) ? s : [...s])) { const [x, y] = await center(p, `#pad button[data-k="${c}"]`); await tap(x, y); } };
    const res = id => p.textContent(`[data-res="${id}"]`);
    const toks = id => p.evaluate(i => JSON.parse(localStorage['mwkcal-v2']).calcs.find(c => c.id === i).tokens, id);
    const css = (sel, prop) => p.$eval(sel, (e, pr) => getComputedStyle(e)[pr], prop);
    const box = async sel => p.locator(sel).first().boundingBox();

    await k('987+32'); ok(!(await p.locator('[data-res="1"]').count()), 'no result shown while typing (like Tydlig)');
    ok(await p.locator('.calc[data-id="1"] .tok.cur').count() === 1, 'number being typed is highlighted');
    await k('='); ok((await res(1)) === '1,019' && await p.locator('[data-res="1"].pill').count() === 1, '987+32 = 1,019 in orange pill');
    let rb = await box('[data-res="1"]');
    let d = await drag(rb.x + rb.width / 2, rb.y + rb.height / 2, 70, rb.y + 130 + G, `screens/video-${name}-drag1.png`);
    ok(d.ghost === '1,019' && d.lines >= 1, `dragging shows floating copy "${d.ghost}" (comma format) + curve`);
    ok(!(await p.locator('#linkLayer').isVisible()), 'no persistent line after drop (as in video)');
    let t2 = await toks(2); ok(t2.length === 1 && t2[0].t === 'ref' && t2[0].id === 1, 'drop on empty canvas → pending linked value');
    await k('+23='); ok((await res(2)) === '1,042', '1,019 + 23 = 1,042');
    await k('+23='); let t3 = await toks(3); ok((await res(3)) === '1,065' && t3[0].t === 'ref' && t3[0].id === 2, 'implicit chain + 23 = 1,065 (linked first operand)');
    await k('+55='); ok((await res(4)) === '1,120', 'chain + 55 = 1,120');
    const cb = await box('.calc[data-id="4"]'); rb = await box('[data-res="2"]');
    const cv = await box('#canvas'); await drag(rb.x + rb.width / 2, rb.y + rb.height / 2, 90, Math.min(cb.y + cb.height + 110, cv.y + cv.height - 40) + G);
    await k('/');
    const eb = await box('.calc[data-id="5"]'); rb = await box('[data-res="3"]');
    d = await drag(rb.x + rb.width / 2, rb.y + rb.height / 2, eb.x + eb.width + 50, eb.y + eb.height / 2 + G, `screens/video-${name}-drag2.png`);
    ok(d.lines >= 2, `dragging 1,065 also shows its existing link line (${d.lines} curves)`);
    let t5 = await toks(5); ok(t5.length === 3 && t5[0].id === 2 && t5[1].v === '/' && t5[2].id === 3, 'drop next to active equation snaps in as operand');
    await k('='); ok((await res(5)) === '0.9784' && await p.locator('[data-res="5"].pill').count() === 1, '1,042 / 1,065 = 0.9784 (pill)');
    const [g1, g2, g3] = [await css('[data-res="1"]', 'borderTopColor'), await css('[data-res="2"]', 'borderTopColor'), await css('[data-res="3"]', 'borderTopColor')];
    ok(g1 === 'rgb(76, 192, 143)' && g2 === 'rgb(232, 100, 60)' && g3 === 'rgb(96, 88, 240)', `link colors in sequence green/red-orange/indigo: ${g1} ${g2} ${g3}`);
    ok((await css('.calc[data-id="3"] .tok.ref', 'color')) === g2 && (await css('.calc[data-id="5"] .tok.ref', 'color')) === g2, 'linked operands take source color');
    ok(await p.locator('[data-res="4"]:not(.pill):not(.linked)').count() === 1, 'older unlinked result is plain text');
    await p.screenshot({ path: `screens/video-${name}-final.png` });
    // edit cascades through the whole chain
    const [ex, ey] = await center(p, '.calc[data-id="1"] .tok[data-i="0"]'); await tap(ex, ey); await k('1'); ok((await res(5)) === '0.7089' && (await res(1)) === '33', 'edit 987→1 cascades to 0.7089'); await k('=');
    // backspace: tap deletes one char; horizontal swipe arms (red); tap while armed clears canvas
    await k('56'); await k(['back']); let t6 = await toks(6); ok(t6.length === 1 && t6[0].v === '5', 'backspace tap deletes one char');
    const bb = await box('#pad button[data-k="back"]'); const by = bb.y + bb.height / 2;
    await drag(bb.x + 10, by, bb.x + bb.width - 10, by); ok(await p.locator('button[data-k="back"].armed').count() === 1 && (await toks(6))[0].v === '5', 'swipe on ⌫ arms it (red), deletes nothing');
    ok((await css('button[data-k="back"]', 'backgroundColor')) === 'rgb(232, 68, 58)', 'armed key is solid red');
    await p.screenshot({ path: `screens/video-${name}-armed.png` });
    await k('7'); ok(await p.locator('button[data-k="back"].armed').count() === 0, 'tapping elsewhere disarms');
    await drag(bb.x + 10, by, bb.x + bb.width - 10, by); const dbg = [await p.locator('button[data-k="back"].armed').count(), await p.locator('.calc').count()]; await k(['back']); await p.waitForTimeout(100);
    ok(await p.locator('.calc').count() === 0 && await p.locator('button[data-k="back"].armed').count() === 0, 'tap armed ⌫ clears entire canvas ' + dbg + ' → ' + (await p.locator('.calc').count()));
    await ctx.close();
  }

  // ---- two-finger pinch zoom / pan (CDP multi-touch) ----
  for (const [w, h, name] of [[412, 915, 'folded'], [884, 1104, 'unfolded']]) {
    console.log(name + ' (pinch)');
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
    const tap = async (x, y) => { await T('touchStart', [[x, y]]); await p.waitForTimeout(40); await T('touchEnd', []); await p.waitForTimeout(40); };
    const k = async s => { for (const c of (Array.isArray(s) ? s : [...s])) { const [x, y] = await center(p, `#pad button[data-k="${c}"]`); await tap(x, y); } };
    const drag1 = async (x1, y1, x2, y2) => { await T('touchStart', [[x1, y1]]); for (let i = 1; i <= 12; i++) { await T('touchMove', [[x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12]]); await p.waitForTimeout(16); } await T('touchEnd', []); await p.waitForTimeout(60); };
    const pinch = async (cx, cy, d0, d1, pan = [0, 0]) => {
      await T('touchStart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
      for (let i = 1; i <= 15; i++) { const d = d0 + (d1 - d0) * i / 15, ox = pan[0] * i / 15, oy = pan[1] * i / 15; await T('touchMove', [[cx - d / 2 + ox, cy + oy], [cx + d / 2 + ox, cy + oy]]); await p.waitForTimeout(16); }
      await T('touchEnd', []); await p.waitForTimeout(250); };
    const res = id => p.textContent(`[data-res="${id}"]`);
    const zoom = () => p.evaluate(() => JSON.parse(localStorage['mwkcal-v2']).zoom);
    const cv = await p.locator('#canvas').boundingBox();
    await k('12+3='); await k('7*2=');
    // pinch about a point: world point under the midpoint stays put
    const c2b = await p.locator('.calc[data-id="2"]').boundingBox(); const mid = [c2b.x + 60, c2b.y + 10];
    const before = await p.evaluate(([x, y]) => { const r = document.getElementById('world').getBoundingClientRect(), z = parseFloat(getComputedStyle(document.getElementById('world')).transform.split(',')[3]) || 1; return [(x - r.left) / z, (y - r.top) / z]; }, mid);
    await pinch(mid[0], mid[1], 100, 200); const z1 = await zoom(); ok(z1 > 1.8 && z1 < 2.2, `pinch out → zoom ${z1.toFixed(2)} (~2x)`);
    const after = await p.evaluate(([x, y]) => { const r = document.getElementById('world').getBoundingClientRect(), z = JSON.parse(localStorage['mwkcal-v2']).zoom; return [(x - r.left) / z, (y - r.top) / z]; }, mid);
    ok(Math.abs(after[0] - before[0]) < 3 && Math.abs(after[1] - before[1]) < 3, `zoom anchored at pinch midpoint (Δ ${(after[0] - before[0]).toFixed(1)}, ${(after[1] - before[1]).toFixed(1)})`);
    ok(await p.evaluate(() => window.visualViewport.scale) === 1, 'no browser page zoom');
    await p.screenshot({ path: `screens/pinch-${name}-zoomed.png` });
    // drag-link still lands correctly at 2x: drop 15 onto the "2" of 7×2
    let rb = await p.locator('[data-res="1"]').boundingBox(), tb = await p.locator('.calc[data-id="2"] .tok[data-i="2"]').boundingBox();
    await drag1(rb.x + rb.width / 2, rb.y + rb.height / 2, tb.x + tb.width / 2, tb.y + tb.height / 2 + G);
    ok((await res(2)) === '105', 'drag-link at 2x replaces 2 with 15 → 105');
    // move a calc at 2x: world delta = finger delta / zoom
    const p0 = await p.evaluate(() => JSON.parse(localStorage['mwkcal-v2']).calcs[1]);
    const eb = await p.locator('.calc[data-id="2"] .op').first().boundingBox();
    await drag1(eb.x + eb.width / 2, eb.y + eb.height / 2, eb.x + eb.width / 2 + 80, eb.y + eb.height / 2 + 40);
    const p1 = await p.evaluate(() => JSON.parse(localStorage['mwkcal-v2']).calcs[1]); const zz = await zoom();
    ok(Math.abs((p1.x - p0.x) - 80 / zz) < 2 && Math.abs((p1.y - p0.y) - 40 / zz) < 2, `item drag scaled by zoom (${(p1.x - p0.x).toFixed(1)}, ${(p1.y - p0.y).toFixed(1)})`);
    // tap empty at zoom creates calc at the tapped world spot
    await tap(cv.x + 40, cv.y + cv.height - 60); await k('9='); const nb = await p.locator('.calc').last().boundingBox();
    ok(Math.abs(nb.y + nb.height / 2 - (cv.y + cv.height - 60)) < 30 * zz, 'tap-empty at zoom places calc under finger');
    // two-finger pan (no zoom change) and pinch-in clamped at 0.4
    const s0 = await p.evaluate(() => [canvas.scrollLeft, canvas.scrollTop]);
    await pinch(cv.x + cv.width / 2, cv.y + 200, 120, 120, [-60, -80]); const s1 = await p.evaluate(() => [canvas.scrollLeft, canvas.scrollTop]);
    ok(Math.abs(s1[0] - s0[0] - 60) < 4 && Math.abs(s1[1] - s0[1] - 80) < 4, `two-finger pan scrolls (${s1[0] - s0[0]}, ${s1[1] - s0[1]})`);
    await pinch(cv.x + cv.width / 2, cv.y + 200, 300, 20); ok(Math.abs((await zoom()) - 0.4) < 0.01, 'pinch-in clamps at 0.4x');
    await pinch(cv.x + cv.width / 2, cv.y + 200, 20, 300); await pinch(cv.x + cv.width / 2, cv.y + 200, 20, 300); ok(Math.abs((await zoom()) - 3) < 0.01, 'pinch-out clamps at 3x');
    await pinch(cv.x + cv.width / 2, cv.y + 200, 300, 120);
    // one-finger pan on empty canvas
    const s2 = await p.evaluate(() => [canvas.scrollLeft, canvas.scrollTop]); await drag1(cv.x + cv.width - 30, cv.y + cv.height - 30, cv.x + cv.width - 130, cv.y + cv.height - 130);
    const s3 = await p.evaluate(() => [canvas.scrollLeft, canvas.scrollTop]); ok(s3[0] - s2[0] === 100 && s3[1] - s2[1] === 100, 'one-finger pan on empty canvas');
    // persistence
    const zs = await zoom(); await p.waitForTimeout(300); await p.reload(); await p.waitForTimeout(200);
    const [zr, s4] = await p.evaluate(() => [JSON.parse(localStorage['mwkcal-v2']).zoom, [canvas.scrollLeft, canvas.scrollTop], getComputedStyle(document.getElementById('world')).transform]);
    ok(Math.abs(zr - zs) < 1e-6 && Math.abs(s4[0] - s3[0]) < 2 && Math.abs(s4[1] - s3[1]) < 2, `zoom ${zr.toFixed(2)} + scroll persist after reload`);
    await p.screenshot({ path: `screens/pinch-${name}-reloaded.png` });
    await ctx.close();
  }

  // ---- rapid keypad taps: 40ms single taps + overlapping two-thumb taps ----
  for (const [w, h, name] of [[412, 915, 'folded'], [884, 1104, 'unfolded']]) {
    console.log(name + ' (rapid taps)');
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const key = {}; for (const d of '0123456789') key[d] = await center(p, `#pad button[data-k="${d}"]`);
    const num = () => p.evaluate(() => { const c = JSON.parse(localStorage['mwkcal-v2']).calcs; return c.length ? c[c.length - 1].tokens.map(t => t.v || t.t).join('') : ''; });
    // 32 single taps, 40ms apart (20ms down, 20ms gap)
    const seq = '12345678909876543210135792468024'; 
    for (const d of seq) { const [x, y] = key[d]; await T('touchStart', [{ x, y, id: 1 }]); await p.waitForTimeout(20); await T('touchEnd', []); await p.waitForTimeout(20); }
    await p.waitForTimeout(100); let got = await num(); ok(got === seq, `32 rapid taps @40ms all registered (${got.length}/32)`);
    await p.click('#pad button[data-k="="]');
    // 16 overlapping pairs: thumb A down, thumb B down while A still held, A up, B up
    let exp = '';
    for (let i = 0; i < 16; i++) {
      const a = String(i % 9 + 1), bb = String((i * 3 + 1) % 10); exp += a + bb; const [ax, ay] = key[a], [bx, by] = key[bb];
      await T('touchStart', [{ x: ax, y: ay, id: 1 }]); await p.waitForTimeout(15);
      await T('touchStart', [{ x: ax, y: ay, id: 1 }, { x: bx, y: by, id: 2 }]); await p.waitForTimeout(15);
      await T('touchEnd', [{ x: bx, y: by, id: 2 }]); await p.waitForTimeout(10); await T('touchEnd', []); await p.waitForTimeout(10);
    }
    await p.waitForTimeout(100); got = await num(); ok(got === exp, `16 overlapping two-thumb pairs → 32 digits registered (${got.length}/32)`);
    // backspace still: tap deletes one, swipe arms
    const [bx0, by0] = await center(p, '#pad button[data-k="back"]');
    await T('touchStart', [{ x: bx0, y: by0, id: 1 }]); await p.waitForTimeout(20); await T('touchEnd', []); await p.waitForTimeout(60);
    ok((await num()) === exp.slice(0, -1), 'backspace tap still deletes one char');
    await ctx.close();
  }
  ok(!errs.length, 'console errors: ' + (errs.join(' / ') || 'none'));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
