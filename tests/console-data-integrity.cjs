'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'command-center.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'data.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

new Function(source); // Parse without running the browser initialization.
new Function(api);
assert.match(html, /command-center\.js\?v=6\.3\.2-data-integrity/);

const init = 'clock();setInterval(clock,1000);bind();';
const i = source.lastIndexOf(init);
assert.ok(i > 0, 'Expected command center initialization');
const helpers = new Function('return ' + source.slice(0, i) +
  'return {num,pct,rr,point,compactPrice,distance,healthCompact,CC,regulatedRows};})();')();

assert.equal(helpers.num(null), '—');
assert.equal(helpers.num(undefined), '—');
assert.equal(helpers.num(''), '—');
assert.equal(helpers.num(0), '0'); // Real 0 must remain visible.
assert.equal(helpers.pct(null), '—');
assert.equal(helpers.pct(0), '+0.00%');
assert.equal(helpers.rr(null), '—');
assert.equal(helpers.compactPrice(null), '—');
assert.ok(Number.isNaN(helpers.point(null)));
assert.ok(Number.isNaN(helpers.distance(null, 100)));
assert.equal(helpers.healthCompact().db, 'error');

helpers.CC.status = {
  states: {market_guard: {meta: {combined: {code: 'LIVE', actionable: true}}}},
  jobs: [], database: {last_write: new Date().toISOString()},
  alerts: {telegram_linked: true, last_watcher_at: new Date().toISOString()},
  api_generated_at: new Date().toISOString()
};
assert.equal(helpers.healthCompact().scanner, 'error'); // No telemetry is not healthy.
const rows = helpers.regulatedRows({liveStates: [{symbol: 'AAL', price: null, context: {}}]}, 'CEDEAR');
assert.ok(Number.isNaN(rows[0].price));

assert.match(source, /CC\.stats=x}\)\.catch\(function\(\)\{CC\.stats=null\}\)/);
assert.match(source, /CC\.status=x}\)\.catch\(function\(\)\{CC\.status=null\}\)/);

assert.match(source, /LEGADO · ABIERTA/); // Legacy carries must not look like v2 results.
assert.match(source, /rechazo de OB en 15m/);
const dispatch = fs.readFileSync(path.join(root, 'supabase', 'functions', 'mtf-cron-dispatch', 'index.ts'), 'utf8');
const helper = dispatch.match(/function isBymaPreopen\(now:Date\)\{[\s\S]*?\n\}/);
assert.ok(helper, 'Expected BYMA preopen guard');
const bymaPreopen = new Function(helper[0].replace('now:Date', 'now') + '; return isBymaPreopen;')();
assert.equal(bymaPreopen(new Date('2026-10-09T13:20:00Z')), true);
assert.equal(bymaPreopen(new Date('2026-10-09T13:29:59Z')), true);
assert.equal(bymaPreopen(new Date('2026-10-09T13:30:00Z')), false);
assert.equal(bymaPreopen(new Date('2026-10-09T15:00:00Z')), false);

console.log('PASS: console data integrity, health, cache version and syntax');
