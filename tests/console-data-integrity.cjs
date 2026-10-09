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
console.log('PASS: console data integrity, health, cache version and syntax');
