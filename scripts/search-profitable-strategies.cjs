'use strict';
// Frozen development selection followed by one separately invoked final test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {binanceRows,yahooRows,bymaRows,fxProxy,enrich,attachUnderlying,simulate,DAY}=require('./lib/daily-research.cjs');
const [directory,stage='development']=process.argv.slice(2);if(!directory||!['development','final'].includes(stage))throw Error('Usage: node scripts/search-profitable-strategies.cjs <research-directory> [development|final]');
const root=path.resolve(directory),read=file=>JSON.parse(fs.readFileSync(path.join(root,file))),protocol=read('protocol.json'),manifest=read('data-manifest.json');
if(manifest.failures.length)throw Error('Data collection has failures');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const identity={protocol:hash(fs.readFileSync(path.join(root,'protocol.json'))),data:hash(fs.readFileSync(path.join(root,'data-manifest.json'))),engine:hash(fs.readFileSync(path.join(__dirname,'lib/daily-research.cjs'))),runner:hash(fs.readFileSync(__filename))};
for(const file of manifest.files){const bytes=fs.readFileSync(path.join(root,'raw',file.name));if(hash(bytes)!==file.sha256)throw Error('Raw data changed: '+file.name);}
const cutoff=Date.parse('2026-10-17T00:00:00Z'),raw=file=>read('raw/'+file);
const fx=fxProxy(yahooRows(raw('GGAL.BA-yahoo.json'),cutoff).rows,yahooRows(raw('GGAL-yahoo.json'),cutoff).rows);
const markets={crypto:{},cedear:{daily:{}}},quality={crypto:[],cedear:[],fxRows:fx.length,findings:[]};
for(const timeframe of ['1d','4h']){
 markets.crypto[timeframe]={};
 for(const symbol of protocol.crypto){const rows=binanceRows(raw(symbol+'-'+timeframe+'-binance.json'),cutoff);markets.crypto[timeframe][symbol]=enrich(rows);quality.crypto.push({symbol,timeframe,rows:rows.length,from:rows[0].t,to:rows.at(-1).t});}
}
const fxMap=new Map(fx.map(x=>[x.t,x.value]));
for(const symbol of protocol.cedear){
 const local=bymaRows(raw(symbol+'-byma.json'),cutoff),underlying=yahooRows(raw(symbol.replace(/\.BA$/,'')+'-yahoo.json'),cutoff),underMap=new Map(underlying.rows.map(x=>[x.t,x.rawClose]));
 let prior;const unexplained=[];
 for(const row of local){if(!fxMap.has(row.t)||!underMap.has(row.t))continue;const basis=row.c/(fxMap.get(row.t)*underMap.get(row.t));if(prior&&Math.abs(basis/prior.basis-1)>.15)unexplained.push({t:row.t,ratio:basis/prior.basis-1});prior={basis};}
 if(local.length<400||unexplained.length)throw Error('Unusable local CEDEAR history '+symbol+': '+JSON.stringify(unexplained));
 markets.cedear.daily[symbol]=attachUnderlying(local,enrich(underlying.rows));quality.cedear.push({symbol,rows:local.length,from:local[0].t,to:local.at(-1).t,underlyingRows:underlying.rows.length,unexplainedBasisChanges:unexplained});
}
quality.findings.push('Yahoo local histories contain uncorrected certificate-ratio changes; execution uses official BYMA only.','Official BYMA public history covers about two years. CEDEAR indicators use longer underlying history, known before the next local opening.','CEDEAR results are price-only, excluding unverified local dividend receipts; FX is an approximate GGAL daily-close CCL proxy.');
fs.writeFileSync(path.join(root,'quality.json'),JSON.stringify(quality,null,2));
const candidates=Object.entries(protocol.families).flatMap(([family,variants])=>variants.map(parameters=>({family,...parameters,id:family+'-'+Object.values(parameters).join('-')})));
function execute(market,timeframe,spec,period,stress=false){
 const bounds=protocol[market+'Periods'][period],from=Date.parse(bounds[0]+'T00:00:00Z'),to=Date.parse(bounds[1]+'T23:59:59.999Z'),multiplier=stress?protocol.execution.stressMultiplier:1;
 const r=simulate(markets[market][timeframe],spec,{from,to,feeBps:protocol.execution[market+'FeeBpsPerFill']*multiplier,slippageBps:protocol.execution[market+'SlippageBpsPerFill']*multiplier,fx:market==='cedear'?fx:[],annualSessions:market==='cedear'?252:timeframe==='4h'?365*6:365,barMs:timeframe==='4h'?DAY/6:DAY,stopAtr:protocol.execution.initialStopAtr});
 return {market,timeframe,spec,...r};
}
function summary(result){return {market:result.market,timeframe:result.timeframe,spec:result.spec,metrics:result.metrics};}
if(stage==='development'){
 const results={generatedAt:new Date().toISOString(),identity,quality,markets:{}};
 for(const market of ['crypto','cedear']){
  const train=[];for(const timeframe of Object.keys(markets[market]))for(const spec of candidates)train.push(summary(execute(market,timeframe,spec,'train')));
  train.sort((a,b)=>b.metrics.netReturn-a.metrics.netReturn);
  const eligible=train.filter(x=>x.spec.family!=='buyHold'&&x.metrics.naturalClosedTrades>=30),selected=eligible[0]||null;
  const topBenchmark=train.filter(x=>x.spec.family==='buyHold')[0],preferred=train.find(x=>x.spec.family==='buyHold'||x.metrics.naturalClosedTrades>=30);
  const benchmark=execute(market,topBenchmark.timeframe,topBenchmark.spec,'validation');
  const validation=selected?execute(market,selected.timeframe,selected.spec,'validation'):null;
  const stress=selected?execute(market,selected.timeframe,selected.spec,'validation',true):null;
  const passed=!!validation&&validation.metrics.netReturn>0&&stress.metrics.netReturn>0;
  results.markets[market]={trainRanking:train,selected,preferred,highestTrainingReturn:train[0],benchmarkSelection:topBenchmark,validation:validation?summary(validation):null,validationStress:stress?summary(stress):null,validationBenchmark:summary(benchmark),passedValidation:passed,selectionUsesFinalTest:false};
  console.log(market+': selected '+(selected?.spec.id||'NONE')+' '+(selected?.timeframe||'')+'; validation pass='+passed);
 }
 const file=path.join(root,'selection.json');
 if(fs.existsSync(file)){const prior=read('selection.json');if(JSON.stringify(prior.identity)!==JSON.stringify(identity))throw Error('Frozen selection exists with a different identity; preserve it and create a new research directory');}
 else fs.writeFileSync(file,JSON.stringify(results,null,2),{flag:'wx'});
}else{
 const selected=read('selection.json');if(JSON.stringify(selected.identity)!==JSON.stringify(identity))throw Error('Protocol, data or engine changed after selection');
 const report={generatedAt:new Date().toISOString(),identity,kind:'FROZEN_OUT_OF_SAMPLE_COMPARISON',approvedForLive:false,markets:{}};
 for(const market of ['crypto','cedear']){
  const s=selected.markets[market],choice=s.selected,b=s.benchmarkSelection;
  const benchmark=execute(market,b.timeframe,b.spec,'holdout');
  const winner=choice?execute(market,choice.timeframe,choice.spec,'holdout'):null,stress=choice?execute(market,choice.timeframe,choice.spec,'holdout',true):null;
  const qualifies=!!winner&&choice.metrics.netReturn>0&&s.passedValidation&&winner.metrics.netReturn>0&&stress.metrics.netReturn>0&&winner.metrics.naturalClosedTrades>=15;
  report.markets[market]={selectedOnTraining:choice,preferredOnTraining:s.preferred,validationPassed:s.passedValidation,holdout:winner,holdoutStress:stress,benchmark,excessVsBenchmark:winner?winner.metrics.netReturn-benchmark.metrics.netReturn:null,statisticalGatePassed:qualifies,relativeEconomicGatePassed:qualifies&&(1+s.validation.metrics.netReturn)*(1+winner.metrics.netReturn)>(1+s.validationBenchmark.metrics.netReturn)*(1+benchmark.metrics.netReturn),approvedForLive:false,activationBlockers:market==='cedear'?['Local dividend cashflows and exact custody deductions are not verified.','Daily-next-open fills must be checked against executable intraday quotes.']:['Daily/four-hour next-open fills are a research approximation; actual manual latency is not verified.'],combinedOutOfSampleReturn:winner?(1+s.validation.metrics.netReturn)*(1+winner.metrics.netReturn)-1:null,combinedBenchmarkReturn:(1+s.validationBenchmark.metrics.netReturn)*(1+benchmark.metrics.netReturn)-1,bestClaim:'Preferred strategy was frozen using training, including buy-and-hold as eligible. Active comparison uses the highest-training-return active model with enough trades; final test never selects parameters.'};
  console.log(market+': held-out net='+(winner?.metrics.netReturn??'NA')+'; buy-hold='+benchmark.metrics.netReturn+'; gate='+qualifies);
 }
 fs.writeFileSync(path.join(root,'final-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
}
