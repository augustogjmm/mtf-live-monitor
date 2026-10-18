'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PROTOCOL,advance,H4}=require('./lib/paper-keltner.cjs');
const file=path.resolve(process.argv[2]||'paper/keltner-h4.json'),engineHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'lib/paper-keltner.cjs'))).digest('hex');
async function get(endpoint){const r=await fetch('https://mtf-monitor.vercel.app/api/crypto-data?path='+encodeURIComponent(endpoint),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Market relay HTTP '+r.status);const body=await r.json();if(!Array.isArray(body))throw Error('Invalid relay response');return body;}
(async()=>{
 const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 if(previous?.engineHash&&previous.engineHash!==engineHash)throw Error('Frozen collector engine changed; new cohort required');
 if(previous?.completedAt){console.log('Paper experiment already complete');return;}
 const boundary=Math.floor(Date.now()/H4)*H4;
 const input={};for(const symbol of PROTOCOL.symbols){const rows=await get('/api/v3/klines?symbol='+symbol+'&interval=4h&limit=1000&endTime='+(boundary-1));input[symbol]={rows};}
 const quotes=await get('/api/v3/ticker/price?symbols='+encodeURIComponent(JSON.stringify(PROTOCOL.symbols))),observedAt=Date.now();
 for(const symbol of PROTOCOL.symbols){const quote=quotes.find(x=>x.symbol===symbol);input[symbol].quote={price:Number(quote?.price),observedAt};}
 const now=Date.now();if(Math.floor(now/H4)*H4!==boundary)throw Error('H4 boundary changed during snapshot; previous state retained');
 const state=advance(previous,input,now);state.engineHash=engineHash;state.source='Public Binance data via bounded MTF relay; indicative last prices, not executable bid/ask or real fills';
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2)+'\n');fs.renameSync(file+'.tmp',file);
 console.log(JSON.stringify({version:state.version,status:state.status,observedAt:new Date(now).toISOString(),samples:state.samples,closedTrades:state.closedTrades,open:Object.values(state.sleeves).filter(x=>x.position).length,equity:state.equity}));
})().catch(error=>{console.error('Paper collection failed; previous complete snapshot retained: '+error.message);process.exitCode=1;});
