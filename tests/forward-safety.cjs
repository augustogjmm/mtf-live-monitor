'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function helper(file, start, end, types) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const a = source.indexOf('function ' + start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Expected production helper ' + start);
  let code = source.slice(a, b);
  for (const type of types) code = code.replaceAll(type, '');
  return new Function(code + '; return ' + start + ';')();
}
const crypto = helper('supabase/functions/mtf-crypto-engine/index.ts',
  'confirmationSafety', 'async function live', [':any', ':Bar', ':number']);
const select = helper('supabase/functions/mtf-crypto-engine/index.ts',
  'confirmationSnapshot', 'function confirmationSafety', [':any', ':number']);
const adr = helper('supabase/functions/mtf-adr-engine/index.ts',
  'forwardConfirmation', 'async function run', [':Bar', ':number']);
const open = Date.parse('2026-10-09T14:15:00Z');
const close = open + 15 * 60000 - 1;
const now = close + 60000;
const bar = {t:open, closeTime:close, o:100, h:105, l:98, c:104, v:12};
const snapshot = {
  generatedAt: new Date(open + 60000).toISOString(),
  lastClosed1h:{closeTime:open - 15 * 60000 - 1}
};
assert.equal(crypto(snapshot, bar, now), null);
const refreshed = {...snapshot, generatedAt:new Date(close + 1000).toISOString()};
assert.equal(select(snapshot, {}, close), snapshot);
assert.equal(select(refreshed, {confirmation_snapshot:snapshot}, close), snapshot);
assert.equal(crypto(select(refreshed, {confirmation_snapshot:snapshot}, close), bar, now), null,
  'A concurrent structure refresh must preserve the pre-close confirmation context');
assert.equal(crypto(select(refreshed, {}, close), bar, now), 'missing_confirmation_clock');
assert.equal(crypto({...snapshot, lastClosed1h:{closeTime:open + 1}}, bar, now),
  'context_after_confirmation_open');
assert.equal(crypto({...snapshot, generatedAt:new Date(close + 1).toISOString()}, bar, now),
  'snapshot_after_confirmation_close');
assert.equal(crypto(snapshot, bar, close), 'invalid_confirmation_clock');
assert.equal(crypto(snapshot, bar, close + 6 * 60000), 'stale_confirmation');
assert.equal(crypto({...snapshot, generatedAt:new Date(open - 30 * 60000).toISOString()}, bar, now),
  'stale_structure');
assert.equal(crypto({...snapshot, lastClosed1h:null}, bar, now), 'missing_confirmation_clock');
assert.equal(crypto(snapshot, {...bar, c:null}, now), 'invalid_confirmation_bar');
assert.equal(crypto(snapshot, {...bar, h:99}, now), 'invalid_confirmation_bar');
assert.equal(crypto(snapshot, {...bar, v:-1}, now), 'invalid_confirmation_bar');
assert.equal(adr(bar, open - 15 * 60000, now), true);
assert.equal(adr(bar, 0, now), false, 'First run must establish a baseline');
assert.equal(adr(bar, open, now), false, 'Already processed candle must not replay');
assert.equal(adr(bar, open - 15 * 60000, open + 14 * 60000), false);
assert.equal(adr(bar, open - 15 * 60000, close + 21 * 60000), false);
assert.equal(adr({...bar, c:null}, open - 15 * 60000, now), false);
assert.equal(adr({...bar, l:106}, open - 15 * 60000, now), false);
console.log('PASS: forward confirmation causality, age, baseline and OHLC validation');
