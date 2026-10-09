'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../api/data.js'), 'utf8');
function fixture(fetch, env={},clock=Date) {
  const timers = new Map();
  let seq = 0;
  const context = {
    module:{exports:{}}, AbortController, fetch, URL, Date:clock, process:{env},
    setTimeout(fn, delay) { const id = ++seq; timers.set(id, {fn, delay}); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source + '\nmodule.exports.helpers={supa,supaAll};', context);
  return {handler:context.module.exports, timers};
}
async function request(handler, query) {
  let status = 200, body, headers={};
  await handler({query}, {
    setHeader(name,value) {headers[name]=value;},
    status(code) { status = code; return this; },
    json(value) { body = value; }
  });
  return {status, body, headers};
}
function response(value, status=200) {
  return {ok:status>=200&&status<300, status, text:async()=>JSON.stringify(value)};
}
(async()=>{
  let calls = 0;
  const local = fixture(async()=>{ calls++; throw Error('Unexpected network access'); });
  assert.equal((await request(local.handler, {op:'health'})).body.ok, true);
  assert.equal((await request(local.handler, {op:'runtime', market:'other'})).status, 400);
  assert.equal((await request(local.handler, {op:'canary'})).status, 403);
  assert.equal(calls, 0);
  let stagingCalls=0;
  const staging=fixture(async (url, init)=>{
    stagingCalls++;
    assert.ok(url.startsWith('https://staging.example.com/rest/v1/'));
    assert.equal(init.headers.apikey,'sb_publishable_test');
    return response([]);
  },{MTF_SUPABASE_URL:'https://staging.example.com/',MTF_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'});
  assert.equal((await request(staging.handler,{op:'runtime',market:'crypto'})).status,200);
  assert.equal(stagingCalls,3);
  for(const env of [
    {MTF_SUPABASE_URL:'https://staging.example.com'},
    {MTF_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
    {MTF_SUPABASE_URL:'http://staging.example.com',MTF_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
    {MTF_SUPABASE_URL:'https://staging.example.com/path',MTF_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
    {MTF_SUPABASE_URL:'https://staging.example.com',MTF_SUPABASE_PUBLISHABLE_KEY:'sb_secret_wrong'}
  ]) {
    const invalid=fixture(async()=>{throw Error('Invalid configuration reached network');},env);
    const result=await request(invalid.handler,{op:'runtime',market:'crypto'});
    assert.equal(result.status,500);
    assert.match(result.body.error,/Supabase|pública/);
  }
  assert.ok(!fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').includes('supabase.co'),
    'Browser must never fall back to the production backend');
  const generated = '2026-10-09T14:00:00Z';
  const live = fixture(async url => {
    if (url.includes('mtf_signals')) return response([]);
    const crypto = url.includes('crypto_structure');
    return response([{last_run_at:generated, meta:{snapshot:[
      {symbol:'BTC', ...(crypto?{ready:true}:{state:'WAIT'})}
    ]}}]);
  });
  const runtime = await request(live.handler, {op:'runtime', market:'crypto'});
  assert.equal(runtime.status, 200);
  assert.equal(runtime.body.liveStates[0].symbol, 'BTC');
  assert.equal(runtime.body.liveGeneratedAt, generated,
    'Serving old data must not refresh its source timestamp');
  assert.equal(runtime.body.structureGeneratedAt, generated);
  assert.equal(live.timers.size, 0);
  const broken = fixture(async()=>response({message:'Unavailable'}, 503));
  assert.equal((await request(broken.handler, {op:'runtime', market:'crypto'})).status, 500);
  const timeout = fixture((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', ()=>reject(Error('Request aborted')), {once:true});
  }));
  const pending = request(timeout.handler, {op:'runtime', market:'crypto'});
  await Promise.resolve(); // Shared reads start in the next microtask.
  assert.ok(timeout.timers.size > 0);
  for (const timer of timeout.timers.values()) {
    assert.equal(timer.delay, 12000);
    timer.fn();
  }
  assert.equal((await pending).status, 500);
  assert.equal(timeout.timers.size, 0);
  const full = fixture(async()=>response([{id:1},{id:2}]));
  await assert.rejects(full.handler.helpers.supaAll('/rest/v1/mtf_signals', 2, 4),
    /datos incompletos/);
  const malformed = fixture(async()=>response({rows:[]}));
  await assert.rejects(malformed.handler.helpers.supaAll('/rest/v1/mtf_signals', 2, 4),
    /paginada inválida/);
  let clock=Date.now(),reads=0,upstreamDown=false;
  class TestClock extends Date {static now(){return clock}}
  const cached=fixture(async()=>{reads++;if(upstreamDown)return response({},503);return response([])}, {},TestClock);
  await Promise.all([request(cached.handler,{op:'runtime',market:'crypto'}),request(cached.handler,{op:'runtime',market:'crypto'})]);
  assert.equal(reads,3,'Concurrent readers must share upstream requests');
  const hit=await request(cached.handler,{op:'runtime',market:'crypto'});
  assert.equal(reads,3);
  assert.equal(hit.headers['Vercel-CDN-Cache-Control'],'max-age=30, must-revalidate');
  clock+=20001;upstreamDown=true;
  const expired=await request(cached.handler,{op:'runtime',market:'crypto'});
  assert.equal(expired.status,500,'Expired success must not hide an outage');
  assert.equal(expired.headers['Vercel-CDN-Cache-Control'],'no-store');
  upstreamDown=false;
  assert.equal((await request(cached.handler,{op:'runtime',market:'crypto'})).status,200,'Failures must not be cached');
  const beforeForce=reads;
  assert.equal((await request(cached.handler,{op:'runtime',market:'crypto',force:'1'})).headers['Vercel-CDN-Cache-Control'],'no-store');
  assert.equal(reads,beforeForce+3,'Manual refresh must bypass backend cache');
  assert.equal((await request(cached.handler,{op:'canary'})).headers['Vercel-CDN-Cache-Control'],'no-store');
  console.log('PASS: API inputs, runtime timestamps, upstream failures, timeouts and complete pagination');
})().catch(error=>{console.error(error); process.exitCode=1;});
