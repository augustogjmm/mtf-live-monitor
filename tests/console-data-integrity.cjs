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
assert.match(html, /command-center\.js\?v=6\.3\.3-forward-safety/);
assert.match(html, /ESTADÍSTICAS v2 · NUEVA COHORTE/);
assert.match(html, /CEDEAR MACD\+OB Diario v2/);
assert.doesNotMatch(html, /CEDEAR MACD\+OB Diario v1/);

const init = 'clock();setInterval(clock,1000);bind();';
const i = source.lastIndexOf(init);
assert.ok(i > 0, 'Expected command center initialization');
const elements = {};
const helpers = new Function('document', 'return ' + source.slice(0, i) +
  'return {num,pct,rr,point,compactPrice,distance,mean,currentR,resultR,runtimeFresh,cryptoRows,healthCompact,CC,regulatedRows,renderOperations,setContext};})();')({
    getElementById:id=>elements[id]||null
  });

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
assert.equal(helpers.mean([null, '', undefined, 10, 20]), 15);
assert.ok(Number.isNaN(helpers.mean([null, ''])));
assert.equal(helpers.currentR({entry:100,stop:100,context:{initial_stop:90}},105),.5);
assert.equal(helpers.resultR({entry:100,stop:100,status:'SL',context:{initial_stop:90}}),0);
assert.ok(Number.isNaN(helpers.currentR({entry:100,stop:90},null)));
const current = new Date().toISOString();
const expired = new Date(Date.now() - 30 * 60000).toISOString();
const future = new Date(Date.now() + 60000).toISOString();
assert.equal(helpers.runtimeFresh({liveGeneratedAt:current, structureGeneratedAt:current}, 'CRYPTO'), true);
assert.equal(helpers.runtimeFresh({liveGeneratedAt:current, structureGeneratedAt:expired}, 'CRYPTO'), false);
assert.equal(helpers.runtimeFresh({liveGeneratedAt:future}, 'CEDEAR'), false);
assert.equal(helpers.runtimeFresh({}, 'MERVAL'), false);
helpers.CC.crypto = {
  liveGeneratedAt:expired, structureGeneratedAt:current,
  structureStates:[{symbol:'BTC', price:100}],
  liveStates:[{symbol:'BTC', state:'IN_ZONE', price:100}],
  opens:[{market:'crypto', symbol:'BTC', direction:'LONG', entry:100, tp1:110}]
};
const staleCrypto = helpers.cryptoRows()[0];
assert.equal(staleCrypto.state, 'STALE_DATA');
assert.ok(staleCrypto.open, 'Keep the existing operation visible for review');
elements.ccOpsBody = {innerHTML:'', querySelectorAll:()=>[]};
helpers.renderOperations();
assert.match(elements.ccOpsBody.innerHTML, /<td>100<\/td><td>—<\/td>/);
assert.match(elements.ccOpsBody.innerHTML, /ABIERTA · DATOS ANTIGUOS/);
helpers.CC.crypto = null;
helpers.renderOperations();
assert.match(elements.ccOpsBody.innerHTML, /No se pudo verificar/);
helpers.CC.crypto = {opens:[]};
helpers.renderOperations();
assert.match(elements.ccOpsBody.innerHTML, /No hay operaciones abiertas/);
helpers.CC.crypto = null;
elements.ccGlobalTs = {textContent:'DATOS REALES · anterior'};
elements.ccDxy = {textContent:'100'};
elements.ccRisk = {innerHTML:'ENTORNO FAVORABLE'};
helpers.setContext();
assert.equal(elements.ccGlobalTs.textContent, 'DATOS NO DISPONIBLES');
assert.equal(elements.ccDxy.textContent, '—');
assert.match(elements.ccRisk.innerHTML, /DATOS NO DISPONIBLES/);
for (const market of ['CEDEAR', 'MERVAL']) {
  const stale = helpers.regulatedRows({
    liveGeneratedAt:expired, liveStates:[{symbol:'TEST', state:'IN_ZONE', price:100}]
  }, market)[0];
  assert.equal(stale.state, 'STALE_DATA');
  const fresh = helpers.regulatedRows({
    liveGeneratedAt:current, liveStates:[{symbol:'TEST', state:'IN_ZONE', price:100, t:Date.now()}]
  }, market)[0];
  assert.equal(fresh.state, 'ZONE');
  const oldQuote = helpers.regulatedRows({
    liveGeneratedAt:current,
    liveStates:[{symbol:'TEST', state:'IN_ZONE', price:100, t:Date.now()-61*60000}]
  }, market)[0];
  assert.equal(oldQuote.state, 'STALE_DATA', 'A fresh aggregate must not refresh an old asset');
}
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
