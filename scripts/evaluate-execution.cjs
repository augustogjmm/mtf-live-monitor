'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {replay}=require('./lib/execution-replay.cjs');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/evaluate-execution.cjs <audit.json> <report.json>');
const raw=fs.readFileSync(input),audit=JSON.parse(raw);
if(audit.kind!=='HISTORICAL_CONFIRMATION_AUDIT'||audit.failures?.length||!audit.results?.length)
  throw Error('A complete historical confirmation audit is required');
const results=audit.results.map(result=>{
  const file=path.join(path.dirname(path.resolve(input)),'history-cache',result.symbol+'-15m.json'),
    bytes=fs.readFileSync(file),cached=JSON.parse(bytes),
    bars=cached.rows.filter(b=>b.t>=result.from&&b.closeTime<=result.to);
  if(bars.length!==result.bars||bars[0]?.t!==result.from||bars.at(-1)?.closeTime!==result.to)
    throw Error('Historical cache does not match audit: '+result.symbol);
  const simulation=replay(result.signals,bars,{stopEnabled:result.market==='crypto'});
  return {market:result.market,symbol:result.symbol,dataSha256:createHash('sha256').update(bytes).digest('hex'),
    from:result.from,to:result.to,...simulation};
});
const report={kind:'COARSE_EXECUTION_REPLAY',generatedAt:new Date().toISOString(),
  inputSha256:createHash('sha256').update(raw).digest('hex'),certifiedProfitable:false,results,
  limitations:[
    'Six selected assets; no point-in-time complete market universe or reserved out-of-sample period.',
    'Next available bar open after 60 seconds, with entry expiry after 30 minutes; not actual broker fills.',
    'Assumed 10 bps fees per fill and 5 bps adverse slippage; validate actual venue costs separately.',
    'Stop and target in the same bar resolve adversely; stop gaps fill at open and targets at their limit.',
    'One position per asset; no shared portfolio capital or allocation model.',
    'Crypto uses initial stop only; minute-level break-even execution is not reconstructed.',
    'ADR and CEDEAR remain open until target, matching their lack of automatic stop; open marks are not realized profit.',
    'CEDEAR underlying USD prices exclude BYMA ARS conversion and historical liquidity.',
    'Missing confirmations mean insufficient evidence, not zero-return certification.'
  ]};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:output,certifiedProfitable:false,results:results.map(r=>({market:r.market,symbol:r.symbol,...r.metrics}))},null,2));
