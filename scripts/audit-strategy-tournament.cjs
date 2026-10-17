'use strict';
// Retrospective audit of the original fixed candidate set, NOT a fresh holdout.
// It must never overwrite the frozen selection or final report.
const fs=require('node:fs'),path=require('node:path');
const {binanceRows,yahooRows,bymaRows,fxProxy,enrich,attachUnderlying,simulate,DAY}=require('./lib/daily-research.cjs');
const directory=process.argv[2];if(!directory)throw Error('Usage: node scripts/audit-strategy-tournament.cjs <research-directory>');
const root=path.resolve(directory),read=file=>JSON.parse(fs.readFileSync(path.join(root,file))),p=read('protocol.json'),raw=file=>read('raw/'+file),cutoff=Date.parse('2026-10-17T00:00:00Z');
const fx=fxProxy(yahooRows(raw('GGAL.BA-yahoo.json'),cutoff).rows,yahooRows(raw('GGAL-yahoo.json'),cutoff).rows),series={crypto:{},cedear:{daily:{}}};
for(const tf of ['1d','4h'])series.crypto[tf]=Object.fromEntries(p.crypto.map(s=>[s,enrich(binanceRows(raw(s+'-'+tf+'-binance.json'),cutoff))]));
for(const s of p.cedear)series.cedear.daily[s]=attachUnderlying(bymaRows(raw(s+'-byma.json'),cutoff),enrich(yahooRows(raw(s.replace(/\.BA$/,'')+'-yahoo.json'),cutoff).rows));
const specs=Object.entries(p.families).flatMap(([family,variants])=>variants.map(v=>({family,...v,id:family+'-'+Object.values(v).join('-')})));
const results={generatedAt:new Date().toISOString(),kind:'RETROSPECTIVE_FIXED_CANDIDATE_AUDIT',finalPeriodIsNoLongerUntouched:true,approvedForLive:false,markets:{}};
for(const market of ['crypto','cedear']){
 const rows=[];
 for(const [tf,data]of Object.entries(series[market]))for(const spec of specs){
  const row={spec,timeframe:tf,periods:{}};
  for(const period of ['train','validation','holdout']){
   const [a,b]=p[market+'Periods'][period],config={from:Date.parse(a+'T00:00:00Z'),to:Date.parse(b+'T23:59:59.999Z'),fx:market==='cedear'?fx:[],feeBps:p.execution[market+'FeeBpsPerFill'],slippageBps:p.execution[market+'SlippageBpsPerFill'],annualSessions:market==='cedear'?252:tf==='4h'?2190:365,barMs:tf==='4h'?DAY/6:DAY,stopAtr:3};
   const base=simulate(data,spec,config),stress=simulate(data,spec,{...config,feeBps:config.feeBps*2,slippageBps:config.slippageBps*2});
   row.periods[period]={...base.metrics,stressNetReturn:stress.metrics.netReturn};
  }
  row.combinedOutOfSampleReturn=(1+row.periods.validation.netReturn)*(1+row.periods.holdout.netReturn)-1;
  row.allPeriodsPositive=['train','validation','holdout'].every(k=>row.periods[k].netReturn>0&&row.periods[k].stressNetReturn>0);
  rows.push(row);
 }
 results.markets[market]=rows.sort((a,b)=>b.combinedOutOfSampleReturn-a.combinedOutOfSampleReturn);
 console.log(market+' completed '+rows.length+' fixed candidates');
}
fs.writeFileSync(path.join(root,'tournament-audit.json'),JSON.stringify(results,null,2),{flag:'wx'});
