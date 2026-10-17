'use strict';
const DAY=86400000;
function validateBars(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('Empty history');
 for(let i=0;i<rows.length;i++){
  const b=rows[i];if(![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.l<=0||b.h<Math.max(b.o,b.c)-1e-8||b.l>Math.min(b.o,b.c)+1e-8||(i&&b.t<=rows[i-1].t))throw Error('Invalid or unordered candle '+i);
 }
 return rows;
}
function yahooRows(value,cutoff=Infinity){
 const r=value.body.chart.result[0],q=r.indicators.quote[0],adj=r.indicators.adjclose?.[0]?.adjclose;
 const rows=[];let skipped=0;
 for(let i=0;i<r.timestamp.length;i++){
  const t=Math.floor(r.timestamp[i]*1000/DAY)*DAY;
  if(t>=cutoff)continue;
  if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x===null||!Number.isFinite(x)||x<=0)){skipped++;continue;}
  const factor=adj?.[i]>0?adj[i]/q.close[i]:1;
  rows.push({t,o:q.open[i]*factor,h:q.high[i]*factor,l:q.low[i]*factor,c:q.close[i]*factor,rawClose:q.close[i]});
 }
 return {rows:validateBars(rows),skipped,currency:r.meta.currency,adjusted:!!adj,name:r.meta.longName||r.meta.shortName};
}
function binanceRows(value,cutoff=Infinity){return validateBars(value.rows.filter(x=>Number(x[6])<cutoff).map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4]})));}
function bymaRows(value,cutoff=Infinity){
 const x=value.body;if(x.s!=='ok')throw Error('Invalid BYMA response');
 return validateBars(x.t.map((t,i)=>({t:Math.floor(Number(t)*1000/DAY)*DAY,o:Number(x.o[i]),h:Number(x.h[i]),l:Number(x.l[i]),c:Number(x.c[i])})).filter(b=>b.t<cutoff));
}
function fxProxy(local,adr,ratio=10){
 const us=new Map(adr.map(x=>[x.t,x.rawClose]));
 return local.filter(x=>us.has(x.t)).map(x=>({t:x.t,value:x.rawClose*ratio/us.get(x.t)}));
}
function enrich(rows,fx=[]){
 const periods=[10,20,50,100,200],ema={},out=[];let fi=0,rate=1,rateDay=-Infinity,atr=0,gain2=0,loss2=0,gain14=0,loss14=0;
 const close=[],high=[],low=[];
 for(let i=0;i<rows.length;i++){
  const b=rows[i];while(fi<fx.length&&fx[fi].t<=b.t){rate=fx[fi].value;rateDay=fx[fi++].t;}
  if(fx.length&&rateDay===-Infinity)continue;
  const p={o:b.o/rate,h:b.h/rate,l:b.l/rate,c:b.c/rate};
  const j=close.length,prev=j?close[j-1]:p.c;
  const tr=Math.max(p.h-p.l,Math.abs(p.h-prev),Math.abs(p.l-prev));atr=j?atr+(tr-atr)/14:tr;
  const delta=p.c-prev;gain2+=(Math.max(0,delta)-gain2)/2;loss2+=(Math.max(0,-delta)-loss2)/2;gain14+=(Math.max(0,delta)-gain14)/14;loss14+=(Math.max(0,-delta)-loss14)/14;
  const feature={atr,fx:rate,fxFresh:!fx.length||rateDay===b.t,rsi2:gain2+loss2?100*gain2/(gain2+loss2):50,rsi14:gain14+loss14?100*gain14/(gain14+loss14):50,signalClose:p.c};
  for(const n of periods){ema[n]=j?ema[n]+(p.c-ema[n])*2/(n+1):p.c;feature['ema'+n]=ema[n];}
  for(const n of [10,20,55]){const hs=high.slice(-n),ls=low.slice(-n);feature['high'+n]=j>=n?Math.max(...hs):NaN;feature['low'+n]=j>=n?Math.min(...ls):NaN;}
  for(const n of [90,180])feature['roc'+n]=j>=n?p.c/close[j-n]-1:NaN;
  const last20=[...close.slice(-19),p.c];feature.sma20=last20.reduce((a,x)=>a+x,0)/last20.length;feature.sd20=Math.sqrt(last20.reduce((a,x)=>a+(x-feature.sma20)**2,0)/last20.length);
  feature.warmed=j>=200;out.push({...b,...feature});close.push(p.c);high.push(p.h);low.push(p.l);
 }
 return out;
}
function decide(bar,spec,position){
 if(!bar?.warmed||!bar.fxFresh)return {enter:false,exit:false};
 const c=bar.signalClose,kind=spec.family;
 if(kind==='buyHold')return {enter:true,exit:false};
 if(kind==='emaTrend')return {enter:c>bar['ema'+spec.fast]&&bar['ema'+spec.fast]>bar['ema'+spec.slow],exit:c<bar['ema'+spec.fast]};
 if(kind==='donchian')return {enter:c>bar['high'+spec.entry],exit:c<bar['low'+spec.exit]};
 if(kind==='momentum')return {enter:bar['roc'+(spec.bars??spec.days)]>0,exit:bar['roc'+(spec.bars??spec.days)]<=0};
 if(kind==='rsiPullback')return {enter:c>bar['ema'+spec.trend]&&bar.rsi2<spec.entry,exit:bar.rsi2>spec.exit||(position?.held||0)>=spec.maxHold};
 if(kind==='bollinger')return {enter:c>bar['ema'+spec.trend]&&c<bar.sma20-spec.deviations*bar.sd20,exit:c>=bar.sma20||(position?.held||0)>=spec.maxHold};
 throw Error('Unknown family '+kind);
}
function attachUnderlying(local,underlying){
 let current=0;
 return local.map((row,i)=>{
  while(current<underlying.length&&underlying[current].t<row.t)current++;
  const known=underlying[current-1],previous=local[i-1];
  // The underlying close is known before this local opening; never use
  // this session's US close or its later FX quote to choose an entry.
  const conversion=known&&previous?previous.c/known.c:NaN;
  return {...row,decisionBar:known?{...known,fx:conversion}:null};
 });
}
function simulate(series,spec,{from,to,feeBps,slippageBps,fx=[],stopAtr=3,annualSessions=365,barMs=DAY}={}){
 const fee=feeBps/10000,slip=slippageBps/10000;
 if(!(fee>=0&&fee<1&&slip>=0&&slip<1))throw Error('Invalid execution costs');
 const keys=Object.keys(series);if(!keys.length)throw Error('No eligible assets');
 const dates=[...new Set(Object.values(series).flatMap(rows=>rows.filter(b=>b.t>=from&&b.t<=to).map(b=>b.t)))].sort((a,b)=>a-b);
 if(dates.length<2)throw Error('Insufficient period');
 let fi=0,rate=1;
 while(fi<fx.length&&fx[fi].t<dates[0])rate=fx[fi++].value;
 const startRate=rate;
 const sleeves=keys.map(symbol=>({symbol,cash:startRate/keys.length,position:null,lastPrice:null,map:new Map(series[symbol].map((b,i)=>[b.t,{bar:b,index:i}])),rows:series[symbol]}));
 const trades=[],curve=[];let investedDays=0;
 function sell(s,price,time,reason){
  const p=s.position,fill=price*(1-slip),proceeds=p.qty*fill*(1-fee);s.cash+=proceeds;
  trades.push({symbol:s.symbol,entryTime:p.time,exitTime:time,entry:p.entry,exit:fill,netReturn:proceeds/p.spent-1,reason,held:p.held});s.position=null;
 }
 for(let di=0;di<dates.length;di++){
  const day=dates[di];while(fi<fx.length&&fx[fi].t<=day)rate=fx[fi++].value;
  for(const s of sleeves){
   const item=s.map.get(day);if(!item)continue;const {bar:b,index}=item,prev=b.decisionBar||s.rows[index-1];
   if(prev&&prev.t>=day)throw Error('Future information in opening decision');
   if(s.lastPrice===null)s.lastPrice=prev?.c??b.o;
   const decision=decide(prev,spec,s.position);let exited=false;
   if(s.position){s.position.held++;if(s.position.stop!==null&&b.o<=s.position.stop){sell(s,b.o,day,'STOP_GAP');exited=true;}else if(decision.exit){sell(s,b.o,day,'RULE');exited=true;}}
   if(!s.position&&!exited&&decision.enter&&s.cash>0){
    const fill=b.o*(1+slip),conversion=b.decisionBar?fill/prev.signalClose:prev.fx,
      risk=spec.family==='buyHold'?null:stopAtr*prev.atr*conversion;
    if(risk===null||risk>0&&fill-risk>0){const spent=s.cash,qty=spent/(fill*(1+fee));s.position={qty,spent,entry:fill,time:day,held:1,stop:risk===null?null:fill-risk};s.cash=0;}
   }
   if(s.position&&s.position.stop!==null&&b.l<=s.position.stop)sell(s,s.position.stop,day,'STOP');
   s.lastPrice=b.c;
  }
  const exposed=sleeves.filter(s=>s.position).length;investedDays+=exposed/keys.length;
  if(di===dates.length-1)for(const s of sleeves)if(s.position)sell(s,s.lastPrice,day,'TEST_END');
  const equity=sleeves.reduce((sum,s)=>sum+s.cash+(s.position?s.position.qty*s.lastPrice:0),0)/rate;
  if(!(equity>0&&Number.isFinite(equity)))throw Error('Invalid portfolio equity');curve.push({t:day,equity,exposure:exposed/keys.length});
 }
 let peak=1,maxDrawdown=0,prior=1;const returns=[];
 for(const point of curve){peak=Math.max(peak,point.equity);maxDrawdown=Math.max(maxDrawdown,1-point.equity/peak);returns.push(point.equity/prior-1);prior=point.equity;}
 const mean=returns.reduce((a,x)=>a+x,0)/returns.length,variance=returns.reduce((a,x)=>a+(x-mean)**2,0)/Math.max(1,returns.length-1),end=curve.at(-1).equity;
 return {spec,metrics:{netReturn:end-1,cagr:end**(365.25*DAY/(curve.at(-1).t-curve[0].t+barMs))-1,maxDrawdown,sharpe:variance>0?mean/Math.sqrt(variance)*Math.sqrt(annualSessions):null,closedTrades:trades.length,naturalClosedTrades:trades.filter(t=>t.reason!=='TEST_END').length,winRate:trades.length?trades.filter(t=>t.netReturn>0).length/trades.length:null,exposure:investedDays/dates.length,from:dates[0],to:dates.at(-1),finalEquity:end},contributions:sleeves.map(s=>({symbol:s.symbol,initialWeight:1/keys.length,finalEquity:s.cash/rate,netContribution:s.cash/rate-1/keys.length})),trades,curve};
}
module.exports={validateBars,yahooRows,binanceRows,bymaRows,fxProxy,enrich,attachUnderlying,decide,simulate,DAY};
