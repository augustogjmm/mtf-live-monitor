'use strict';
const assert=require('node:assert/strict');
const {enrich,simulate,attachUnderlying,validateBars,DAY}=require('../scripts/lib/daily-research.cjs');
const bars=Array.from({length:220},(_,i)=>({t:i*DAY,o:100+i,h:102+i,l:99+i,c:101+i}));
const original=enrich(bars),future=enrich([...bars,{t:220*DAY,o:2000,h:3000,l:1500,c:2500}]);
assert.deepEqual(future.slice(0,original.length),original,'appending future prices cannot change existing indicators');
assert.equal(original[20].high20,Math.max(...bars.slice(0,20).map(x=>x.h)),'breakout channels exclude the trigger candle');
assert.throws(()=>validateBars([{t:0,o:100,h:90,l:80,c:100}]),/Invalid/);
const prepared=[0,1,2,3].map(i=>({t:i*DAY,o:100,h:125,l:99,c:120,warmed:true,fxFresh:true,fx:1,atr:5,signalClose:100,roc90:1}));
const buy={family:'buyHold'},options={from:DAY,to:3*DAY,feeBps:100,slippageBps:50};
const result=simulate({A:prepared},buy,options),expected=120*.995*.99/(100*1.005*1.01);
assert.ok(Math.abs(result.metrics.finalEquity-expected)<1e-12,'entry and terminal exit include both fees and adverse slippage');
assert.equal(result.trades[0].entryTime,DAY,'entry occurs after the preceding closed signal');
assert.equal(result.trades[0].reason,'TEST_END');
assert.equal(result.metrics.naturalClosedTrades,0,'terminal marks are not independent strategy exits');
const gap=prepared.map(b=>({...b}));gap[1]={...gap[1],h:105,l:90,c:100};gap[2]={...gap[2],o:70,h:80,l:65,c:70,roc90:-1};gap[3]={...gap[3],roc90:-1};
const stopped=simulate({A:gap},{family:'momentum',days:90},{...options,feeBps:0,slippageBps:0});
assert.equal(stopped.trades[0].reason,'STOP_GAP');assert.equal(stopped.trades[0].exit,70,'a gap must not fill at an unavailable stop price');
const late=prepared.map(b=>({...b,roc90:-1}));late[1].roc90=1;
const causal=simulate({A:late},{family:'momentum',days:90},{...options,feeBps:0,slippageBps:0});
assert.equal(causal.trades[0].entryTime,2*DAY,'the current close cannot trigger an entry at the current open');
const cash=simulate({A:prepared.map(b=>({...b,roc90:-1}))},{family:'momentum',days:90},{...options,feeBps:0,slippageBps:0,fx:[{t:0,value:100},{t:DAY,value:100},{t:2*DAY,value:200}]});
assert.equal(cash.metrics.netReturn,-.5,'uninvested ARS must lose USD value when CCL doubles');
const attached=attachUnderlying(bars.slice(210),original);
assert.ok(attached.every(b=>b.decisionBar.t<b.t),'local openings use a US close from a preceding session');
assert.throws(()=>simulate({A:prepared.map(b=>({...b,decisionBar:{...b}}))},buy,options),/Future information/);
console.log('PASS: research causality, breakout timing, fees, slippage, gap stops, ARS cash FX and underlying/local alignment');

// Exercise the actual CLI guards with small deterministic histories.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mtf-research-integrity-'));
try{
 fs.mkdirSync(path.join(fixtureRoot,'raw'));
 const dates=Array.from({length:900},(_,i)=>Date.UTC(2023,0,1)+i*DAY);
 const chart=(price,currency)=>({body:{chart:{result:[{meta:{currency},timestamp:dates.map(t=>t/1000),indicators:{quote:[{open:dates.map(()=>price),high:dates.map(()=>price*1.01),low:dates.map(()=>price*.99),close:dates.map(()=>price)}],adjclose:[{adjclose:dates.map(()=>price)}]}}]}}});
 const fixtures={
  'BTCUSDT-1d-binance.json':{rows:dates.map(t=>[t,100,101,99,100,10,t+DAY-1])},
  'BTCUSDT-4h-binance.json':{rows:dates.map(t=>[t,100,101,99,100,10,t+DAY-1])},
  'GGAL.BA-yahoo.json':chart(1000,'ARS'),'GGAL-yahoo.json':chart(10,'USD'),'AAPL-yahoo.json':chart(100,'USD'),
  'AAPL.BA-byma.json':{body:{s:'ok',t:dates.map(t=>t/1000),o:dates.map(()=>10000),h:dates.map(()=>10100),l:dates.map(()=>9900),c:dates.map(()=>10000)}}
 };
 const manifest={failures:[],files:[]};for(const [name,value]of Object.entries(fixtures)){const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(path.join(fixtureRoot,'raw',name),bytes);manifest.files.push({name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
 fs.writeFileSync(path.join(fixtureRoot,'data-manifest.json'),JSON.stringify(manifest));
 const periods={train:['2024-01-01','2024-03-31'],validation:['2024-04-01','2024-06-30'],holdout:['2024-07-01','2024-09-30']};
 fs.writeFileSync(path.join(fixtureRoot,'protocol.json'),JSON.stringify({crypto:['BTCUSDT'],cedear:['AAPL.BA'],families:{buyHold:[{}]},cryptoPeriods:periods,cedearPeriods:periods,execution:{cryptoFeeBpsPerFill:10,cryptoSlippageBpsPerFill:5,cedearFeeBpsPerFill:60,cedearSlippageBpsPerFill:20,stressMultiplier:2,initialStopAtr:3}}));
 const run=(name,args=[])=>spawnSync(process.execPath,[path.resolve(__dirname,'../scripts',name),fixtureRoot,...args],{encoding:'utf8'});
 const development=run('search-profitable-strategies.cjs',['development']);assert.equal(development.status,0,development.stderr);
 const originalSelection=fs.readFileSync(path.join(fixtureRoot,'selection.json'),'utf8'),edited=JSON.parse(originalSelection);
 edited.markets.crypto.validationBenchmark.metrics.netReturn+=.5;
 fs.writeFileSync(path.join(fixtureRoot,'selection.json'),JSON.stringify(edited));
 const rejected=run('search-profitable-strategies.cjs',['final']);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Frozen selection contents/);assert.equal(fs.existsSync(path.join(fixtureRoot,'final-report.json')),false,'altered validation cannot reach the final test');
 fs.writeFileSync(path.join(fixtureRoot,'selection.json'),originalSelection);
 const final=run('search-profitable-strategies.cjs',['final']);assert.equal(final.status,0,final.stderr);
 fs.appendFileSync(path.join(fixtureRoot,'raw','BTCUSDT-1d-binance.json'),'\n');
 const audit=run('audit-strategy-tournament.cjs');assert.notEqual(audit.status,0);assert.match(audit.stderr,/Raw data changed/);assert.equal(fs.existsSync(path.join(fixtureRoot,'tournament-audit.json')),false,'modified raw data cannot create an apparently fixed audit');
 console.log('PASS: CLI rejects edited frozen selections and modified audit inputs');
}finally{fs.rmSync(fixtureRoot,{recursive:true,force:true});}
