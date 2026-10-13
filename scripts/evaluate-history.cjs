'use strict';
// A reproducible historical signal audit, not a profitability certificate.
const fs=require('node:fs');
const path=require('node:path');
const {loadEngine}=require('./lib/strategy-runtime.cjs');
const DAY=86400000,HOUR=3600000,QUARTER=900000;
const output=process.argv[2];
if(!output)throw Error('Usage: node --use-env-proxy scripts/evaluate-history.cjs <report.json>');
const cache=path.join(path.dirname(path.resolve(output)), 'history-cache');
fs.mkdirSync(cache,{recursive:true});
const fetchedAt=Date.now(),start=fetchedAt-30*DAY;
async function get(url){
  const r=await fetch(url,{headers:{'user-agent':'MTF historical validation'},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Provider HTTP '+r.status);
  return r.json();
}
async function cached(key,fn){
  const file=path.join(cache,key+'.json');
  if(fs.existsSync(file)){
    const stored=JSON.parse(fs.readFileSync(file));
    if(fetchedAt-stored.fetchedAt<DAY)return stored.rows;
  }
  const rows=await fn();
  fs.writeFileSync(file,JSON.stringify({fetchedAt,rows}));
  return rows;
}
function validate(rows){
  for(let i=0;i<rows.length;i++){
    const b=rows[i];
    if(![b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||b.l<=0||
      b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||b.v<0||(i&&b.t<=rows[i-1].t))
      throw Error('Invalid or unordered historical candle');
  }
  if(!rows.length)throw Error('No historical candles');
  return rows;
}
async function binance(symbol,interval,since){
  return cached(symbol+'-'+interval,async()=>{
    const out=[];let cursor=since;
    while(cursor<fetchedAt){
      const marketPath='/api/v3/klines?symbol='+symbol+'&interval='+interval+'&limit=1000&startTime='+cursor;
      const rows=await get('https://mtf-monitor.vercel.app/api/crypto-data?path='+encodeURIComponent(marketPath));
      if(!Array.isArray(rows)||!rows.length)break;
      for(const x of rows)if(Number(x[6])<fetchedAt)out.push({t:+x[0],closeTime:+x[6],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]});
      const next=Number(rows.at(-1)[0])+1;
      if(next<=cursor)throw Error('Provider pagination did not advance');
      cursor=next;if(rows.length<1000)break;
    }
    return validate(out);
  });
}
async function yahoo(symbol,interval,range){
  return cached(symbol+'-'+interval,async()=>{
    const j=await get('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+
      '?interval='+interval+'&range='+range+'&includePrePost=false');
    const result=j.chart?.result?.[0];
    if(!result)throw Error('Yahoo returned no chart');
    const q=result.indicators.quote[0],rows=[];
    for(let i=0;i<result.timestamp.length;i++){
      if([q.open[i],q.high[i],q.low[i],q.close[i]].some(v=>v==null))continue;
      const t=result.timestamp[i]*1000,closeTime=t+(interval==='1d'?6.5*HOUR:QUARTER);
      if(closeTime>=fetchedAt)continue;
      rows.push({t,closeTime,o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i],v:q.volume[i]??0});
    }
    return validate(rows);
  });
}
async function auditCrypto(symbol){
  const [h1,h4,d1,m15]=await Promise.all([
    binance(symbol,'1h',start-90*DAY),binance(symbol,'4h',start-180*DAY),
    binance(symbol,'1d',start-365*DAY),binance(symbol,'15m',start)
  ]);
  const clock={now:start},rules=loadEngine('mtf-crypto-engine',clock).rules,st=rules.emptyState();
  let i=0,signals=[];const funnel={contextReady:0,ladderReady:0,eligibleDirections:0,rejections:0,riskRewardPassed:0};
  for(const bar of m15){
    clock.now=bar.t;
    while(i<h1.length&&h1[i].closeTime<bar.t)rules.step(st,h1[i++]);
    const closed=h1.slice(Math.max(0,i-1000),i);
    const c1=rules.context(closed),c4=rules.context(h4.filter(b=>b.closeTime<bar.t).slice(-1000));
    if(!c1.ready||!c4.ready||d1.filter(b=>b.closeTime<bar.t).length<210)continue;
    funnel.contextReady++;
    const ladder=rules.ladderFromState(st,bar.o);
    if(!ladder.complete)continue;
    funnel.ladderReady++;
    const below=ladder.below.filter(x=>rules.qualifiedOb(x.ob,closed,'LONG'));
    const above=ladder.above.filter(x=>rules.qualifiedOb(x.ob,closed,'SHORT'));
    const snap={context:c1,macroContext:{h4:c4},ladder:{
      below:below.map(rules.publicLevel),above:above.map(rules.publicLevel)}};
    const choices=[...below.map(level=>({direction:'LONG',level})),
      ...above.map(level=>({direction:'SHORT',level}))].sort((a,b)=>a.level.rank-b.level.rank);
    for(const {direction,level} of choices){
      if(rules.directionEligibility(direction,snap).eligible)funnel.eligibleDirections++;
      if(!rules.directionEligibility(direction,snap).eligible||level.ob.confirmTime+HOUR>bar.t||
        !rules.rejectsZone(bar,level,direction)||
        (direction==='LONG'?bar.c>level.ob.top+.25*c1.atr14:bar.c<level.ob.bottom-.25*c1.atr14))continue;
      funnel.rejections++;
      const plan=rules.tradePlan(direction,level,snap,bar.c);
      if(plan){funnel.riskRewardPassed++;signals.push({time:bar.closeTime,entry:bar.c,direction,stop:plan.stop,tp1:plan.tp1,rr:plan.rr});break}
    }
  }
  return {...summarize('crypto',symbol,m15,signals),funnel};
}
async function auditRegulated(market,symbol){
  const [daily,bars]=await Promise.all([yahoo(symbol,'1d','5y'),yahoo(symbol,'15m','1mo')]);
  const clock={now:start},rules=loadEngine(market==='adr'?'mtf-adr-engine':'mtf-daily-backfill',clock).rules;
  const signals=[];
  for(const bar of bars){
    if(bar.t<start)continue;
    clock.now=bar.t;
    const known=daily.filter(b=>b.closeTime<bar.t);
    if(market==='adr'){
      const diag=rules.diagnostic(known,bar.c),plan=rules.confirmationPlan(bar,diag);
      if(plan)signals.push({time:bar.closeTime,entry:plan.entry,direction:'LONG',
        stop:plan.invalidation,tp1:plan.tp1,rr:plan.rr});
    }else{
      const converted=known.map(b=>({t:b.t,open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v}));
      const diag=rules.regulatedLiveDiagnostic(converted,bar.c,bar);
      if(!diag.ready||rules.regulatedRiskProfile(diag).relation!=='A_FAVOR'||
        !diag.ladder.below.length||!diag.ladder.above.length)continue;
      for(const level of diag.touches.long){
        if(!rules.confirmedCedearRecovery(bar,level,diag))continue;
        const plan=rules.ladderSignal('LONG',level,diag,'1d');
        if(!plan)continue;
        const risk=plan.entry-plan.stop,rr=(plan.tp1-plan.entry)/risk;
        if(rr>=rules.MIN_RR){
          signals.push({time:bar.closeTime,entry:plan.entry,direction:'LONG',stop:plan.stop,tp1:plan.tp1,rr});break;
        }
      }
    }
  }
  return summarize(market,symbol,bars.filter(b=>b.t>=start),signals);
}
function summarize(market,symbol,bars,signals){
  // Each confirmation is observed independently. This is not a portfolio:
  // overlapping setups are included; no broker execution or profit is assumed.
  const outcomes={targetFirst:0,invalidationFirst:0,sameBarAmbiguous:0,unresolved:0};
  for(const signal of signals){
    let outcome='unresolved';
    for(const b of bars){
      if(b.t<signal.time)continue;
      const long=signal.direction==='LONG',target=long?b.h>=signal.tp1:b.l<=signal.tp1,
        invalid=long?b.l<=signal.stop:b.h>=signal.stop;
      if(target||invalid){outcome=target&&invalid?'sameBarAmbiguous':target?'targetFirst':'invalidationFirst';break}
    }
    outcomes[outcome]++;
  }
  return {market,symbol,bars:bars.length,from:bars[0]?.t,to:bars.at(-1)?.closeTime,
    confirmations:signals.length,outcomes,signals};
}
(async()=>{
  const results=[],failures=[];
  for(const [market,symbol] of [['crypto','BTCUSDT'],['crypto','ETHUSDT'],
    ['cedear','AAPL'],['cedear','MSFT'],['adr','GGAL'],['adr','YPF']]){
    try{const result=await(market==='crypto'?auditCrypto(symbol):auditRegulated(market,symbol));
      results.push(result);console.log(market+' '+symbol+': '+result.bars+' candles, '+result.confirmations+' confirmations');}
    catch(error){failures.push({market,symbol,error:error.message});console.log(market+' '+symbol+': FAILED '+error.message)}
  }
  const report={generatedAt:new Date().toISOString(),kind:'HISTORICAL_CONFIRMATION_AUDIT',
    certifiedProfitable:false,windowDays:30,results,failures,limitations:[
      'Six selected assets, not the historical complete market universe.',
      'Independent overlapping confirmations, not one-position-per-asset live state.',
      'No modeled fees, slippage, latency, order fills or portfolio return.',
      'Technical invalidation is an observation, not an automatic ADR or CEDEAR exit.',
      'No break-even simulation or intrabar ordering; same-bar outcomes are ambiguous.',
      'CEDEAR uses USD underlying data; historical BYMA liquidity and ARS conversion are not available.',
      'Crypto detector warm-up is 90 days; it is not the complete exchange history.',
      'This audit cannot establish profitability or replace an out-of-sample trading backtest.'
    ]};
  fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2));
  if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1});
