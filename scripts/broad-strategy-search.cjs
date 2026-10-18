'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {binanceRows,yahooRows,bymaRows,attachUnderlying,fxProxy,DAY}=require('./lib/daily-research.cjs');
const {features,catalog,backtest}=require('./lib/broad-research.cjs');
const [source,output]=process.argv.slice(2);if(!source||!output)throw Error('Usage: node scripts/broad-strategy-search.cjs SOURCE OUTPUT');
const read=f=>JSON.parse(fs.readFileSync(path.join(source,f))),manifest=read('data-manifest.json');
for(const f of manifest.files){if(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'raw',f.name))).digest('hex')!==f.sha256)throw Error('Data changed '+f.name);}
if(manifest.failures.length)throw Error('Source collection contains failures');
const protocol=read('protocol.json'),raw=f=>read('raw/'+f),fx=fxProxy(yahooRows(raw('GGAL.BA-yahoo.json')).rows,yahooRows(raw('GGAL-yahoo.json')).rows);
const markets={};
for(const tf of ['1d','4h'])markets['crypto-'+tf]={series:Object.fromEntries(protocol.crypto.map(s=>[s,features(binanceRows(raw(s+'-'+tf+'-binance.json')))])),fee:.001,slip:.0005,folds:['2023-01-01','2024-01-01','2025-01-01','2026-01-01','2026-10-17'],trainYears:3};
markets.cedear={series:Object.fromEntries(protocol.cedear.map(s=>[s,attachUnderlying(bymaRows(raw(s+'-byma.json')),features(yahooRows(raw(s.replace('.BA','')+'-yahoo.json')).rows))])),fee:.006,slip:.002,fx,folds:['2025-07-01','2026-01-01','2026-07-01','2026-10-17'],trainYears:2};
const specs=catalog(),report={created:new Date().toISOString(),kind:'EXPLORATORY_EXPANDED_WALK_FORWARD',approvedForLive:false,identity:Object.fromEntries([__filename,path.join(__dirname,'lib/broad-research.cjs'),path.join(__dirname,'lib/daily-research.cjs')].map(file=>[path.basename(file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),candidateCount:specs.length,totalConfigurations:specs.length*3,sourceManifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'data-manifest.json'))).digest('hex'),limitations:['Previously inspected histories: this is exploratory, not a new untouched holdout.','Fixed liquid survivors; survivorship bias remains.','CEDEAR price-only; approximate CCL, local dividends not verified, only two years local history.','Signals are long-only, unlevered, equal initial asset sleeves; allocation leaves cash in market currency.','Squeeze is a reproducible BB20/2 vs ATR14*1.5 approximation with momentum and MACD filter, not proprietary TTM.','Ichimoku variant uses current 9/26/52 midpoints, without displaced cloud.','No identifiable Trade Latino rulebook was supplied: no official implementation is claimed.'],markets:{}};
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'catalog.json'),JSON.stringify({specs,folds:Object.fromEntries(Object.entries(markets).map(([k,v])=>[k,v.folds])),riskConstraint:{maximumTrainingDrawdown:.25,minimumTrainingTrades:20},criterion:'Highest training CAGR among active models satisfying constraints; if none qualify hold cash. No validation-based tuning.'},null,2),{flag:'wx'});
const compact=r=>{const {curve,...m}=r;return m;};
for(const [name,m]of Object.entries(markets)){
 const run=(s,from,to,multiplier=1,delay=0)=>backtest(m.series,s,{from,to,fee:m.fee*multiplier,slip:m.slip*multiplier,fx:m.fx,delay});
 const combined={base:[],cost2:[],cost3:[],delay1:[]};
 const folds=[],totals=specs.map(spec=>({spec,net:1,maxDrawdown:0,trades:0}));
 for(let i=0;i<m.folds.length-1;i++){
  const from=Date.parse(m.folds[i]),to=Date.parse(m.folds[i+1])-1,trainFrom=Math.max(Date.parse(name==='cedear'?'2024-10-17':'2018-01-01'),from-m.trainYears*365.25*DAY);
  const train=specs.map(spec=>({spec,metrics:compact(run(spec,trainFrom,from-1))}));
  const eligible=train.filter(x=>x.spec.family!=='buyHold'&&x.metrics.drawdown<=.25&&x.metrics.trades>=20&&x.metrics.cagr>0).sort((a,b)=>b.metrics.cagr-a.metrics.cagr);
  const selected=eligible[0]||null,results=specs.map(spec=>compact(run(spec,from,to)));
  for(let j=0;j<totals.length;j++){totals[j].net*=1+results[j].return;totals[j].maxDrawdown=Math.max(totals[j].maxDrawdown,results[j].drawdown);totals[j].trades+=results[j].trades;}
  const chosen=selected?run(selected.spec,from,to):null;
  for(const [key,mult,lag] of [['base',1,0],['cost2',2,0],['cost3',3,0],['delay1',1,1]]){const prior=combined[key].at(-1)?.[1]||1;const curve=selected?run(selected.spec,from,to,mult,lag).curve:[[from,1],[to,1]];combined[key].push(...curve.map(([t,e])=>[t,e*prior]));}
  folds.push({from:m.folds[i],to:m.folds[i+1],trainFrom:new Date(trainFrom).toISOString(),selected,eligible:eligible.length,base:chosen?compact(chosen):{return:0,cagr:0,drawdown:0,trades:0},cost2:selected?compact(run(selected.spec,from,to,2)):null,cost3:selected?compact(run(selected.spec,from,to,3)):null,delay1:selected?compact(run(selected.spec,from,to,1,1)):null,benchmark:results[0]});
  console.log(name,m.folds[i],selected?.spec.id||'CASH',folds.at(-1).base.return);
 }
 totals.sort((a,b)=>b.net-a.net);
 const compounded=key=>folds.reduce((a,f)=>a*(1+(f[key]?.return||0)),1)-1;
 const best=totals.find(x=>x.spec.family!=='buyHold');
 // Improvement comparison is explicitly retrospective, not the walk-forward selection.
 const stressBest={};for(const [key,mult,lag]of [['base',1,0],['cost2',2,0],['cost3',3,0],['delay1',1,1]]){let capital=1;const metrics=[];for(let i=0;i<m.folds.length-1;i++){const r=run(best.spec,Date.parse(m.folds[i]),Date.parse(m.folds[i+1])-1,mult,lag);capital*=1+r.return;metrics.push(compact(r));}stressBest[key]={return:capital-1,folds:metrics};}
 const continuousRisk=Object.fromEntries(Object.entries(combined).map(([key,curve])=>{let peak=1,drawdown=0;for(const [,e] of curve){peak=Math.max(peak,e);drawdown=Math.max(drawdown,1-e/peak);}return [key,{return:curve.at(-1)[1]-1,maxDrawdown:drawdown,cagr:curve.at(-1)[1]**(365.25*DAY/(curve.at(-1)[0]-curve[0][0]+DAY))-1}];}));
 const neighbors=totals.filter(x=>x.spec.family===best.spec.family);
 report.markets[name]={folds,continuousRisk,retrospectiveBestStress:stressBest,walkForward:{return:compounded('base'),cost2Return:compounded('cost2'),cost3Return:compounded('cost3'),delay1Return:compounded('delay1'),benchmarkReturn:compounded('benchmark')},retrospectiveRanking:totals.map(x=>({...x,return:x.net-1})),bestRetrospectiveFamilySensitivity:neighbors.map(x=>({spec:x.spec,return:x.net-1,worstFoldDrawdown:x.maxDrawdown})),note:'Ranking and family sensitivity reuse all test folds and cannot establish an independently validated winner. maxDrawdown in ranking is the worst individual fold, not the continuous combined drawdown.'};
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
}
