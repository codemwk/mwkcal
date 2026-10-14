# Tydlig Fold
Tydlig-style canvas calculator PWA for Galaxy Z Fold7. Live: https://codemwk.github.io/tydlig-fold/
- App (static, no build): `docs/` — served by GitHub Pages on every push to `main`.
- Tests: `node tests/engine.test.js`; browser e2e: `npm i && (cd docs && python3 -m http.server 8765) & node tests/e2e.js`
- Service worker is network-first, so installed phones pick up new deploys when online.
