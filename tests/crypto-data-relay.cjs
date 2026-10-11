const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('api/crypto-data.js','utf8');
function fixture(fetch){const context={module:{exports:{}},URL,Date,AbortSignal,fetch};vm.runInNewContext(source,context);return context.module.exports;}
async function request(handler,path,method='GET'){let code=200,body,headers={};await handler({method,query:{path}},{setHeader:(key,value)=>headers[key]=value,status(value){code=value;return this},json(value){body=value}});return {code,body,headers};}
(async()=>{
 let calls=0;const handler=fixture(async url=>{calls++;assert.ok(url.startsWith('https://api.binance.com/api/v3/'));return {ok:true,status:200,json:async()=>[[1,'100']]}});
 for(const path of ['https://attacker.test/','//attacker.test/api/v3/klines','/api/v3/account','/api/v3/order','/api/v3/klines?symbol=BTCUSDT&interval=1s','/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1001','/api/v3/klines?symbol=BTCUSDT&interval=1h&extra=x','/api/v3/ticker/price','/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22%5D&symbol=ETHUSDT'])assert.equal((await request(handler,path)).code,400);
 assert.equal((await request(handler,'/api/v3/klines?symbol=BTCUSDT&interval=1h','POST')).code,405);assert.equal(calls,0);
 const candles=await request(handler,'/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&startTime=0');assert.equal(candles.code,200);assert.equal(calls,1);assert.equal(candles.headers['cache-control'],'no-store');assert.ok(candles.headers['Vercel-CDN-Cache-Control'].includes('max-age=30'));
 const prices=await request(handler,'/api/v3/ticker/price?symbols='+encodeURIComponent(JSON.stringify(['BTCUSDT','ETHUSDT'])));assert.equal(prices.code,200);
 const watcherSource=fs.readFileSync('supabase/functions/mtf-alert-watcher/index.ts','utf8');
 assert.ok(watcherSource.includes('interval=1m&startTime=${start}&limit=1000'));
 const minuteBars=await request(handler,'/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime='+String(Date.now()-180000)+'&limit=1000');assert.equal(minuteBars.code,200);
 let attempts=0;const failed=fixture(async()=>{attempts++;return {ok:false,status:403}});const outage=await request(failed,'/api/v3/klines?symbol=BTCUSDT&interval=15m');assert.equal(attempts,2);assert.equal(outage.code,502);assert.equal(outage.headers['Vercel-CDN-Cache-Control'],'no-store');
 console.log('PASS: market relay is read-only, rejects arbitrary origins, bounds symbols/candles, caches only success and reports provider failures');
})().catch(error=>{console.error(error);process.exitCode=1});
