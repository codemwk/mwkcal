// Browser e2e: node tests/e2e.js  (URL env overrides http://localhost:8765/)
const { chromium } = require('playwright-core');
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
    const center = async sel => { const bb = await p.locator(sel).first().boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
    const longPress = async sel => { const [x, y] = await center(sel); await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.up(); };
    const menuClick = async label => { await p.click(`#menu button:text-is("${label}")`); };

    // 1. type without selecting anything
    await k('2+3'); ok(await p.locator('.calc').count() === 1 && (await res(1)) === '5', 'type-without-select creates calc 2+3=5');
    await k('=');
    await k('1/0'); ok((await res(2)) === '?', 'auto-spot second calc; 1/0 shows ?');
    const [y1, y2] = await p.evaluate(() => [...document.querySelectorAll('.calc')].map(e => e.offsetTop)); ok(y2 > y1, 'auto-placed below previous');
    await k('='); await longPress('.calc[data-id="2"] .op'); await menuClick('Delete'); ok(await p.locator('.calc').count() === 1, 'long-press Delete');

    // tap empty canvas → new calc
    await p.mouse.click(40, 230); await k('100/4='); ok((await res(3)) === '25', 'tap-empty new calc 100/4=25');

    // 2. drag-to-link: result of #1 onto the "4" of #3
    const [sx, sy] = await center('[data-res="1"]'), [tx, ty] = await center('.calc[data-id="3"] .tok[data-i="2"]');
    await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx + 20, sy + 30, { steps: 4 }); await p.mouse.move(tx, ty, { steps: 8 });
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
    const [s2x, s2y] = await center('[data-res="1"]'), [gx, gy] = await center('.graph canvas');
    await p.mouse.move(s2x, s2y); await p.mouse.down(); await p.mouse.move(gx, gy, { steps: 10 }); await p.mouse.up();
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
  ok(!errs.length, 'console errors: ' + (errs.join(' / ') || 'none'));
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
