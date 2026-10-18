'use strict';
const crypto=require('node:crypto');
const H4=14400000;
const PROTOCOL=Object.freeze({version:'KELTNER-H4-PAPER-v1',family:'keltner',timeframe:'4h',entryAtr:2.5,stopAtr:2,trendEma:200,channelEma:20,atrPeriod:14,warmupBars:1000,symbols:['BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','ADAUSDT','LTCUSDT'],initialUsd:10000,feeBps:10,slippageBps:5,maximumDays:90,execution:'FIRST_OBSERVED_QUOTE_AFTER_CLOSED_H4; STOPS_AT_OBSERVED_QUOTES_ONLY',sampling:'hourly; GitHub scheduling may be delayed',reentry:'Never in the same observation as an exit',baseline:'No entry from the initial historical signal',benchmark:'Equal-weight buy-and-hold from first observed quotes; marked net of estimated exit costs',risk:'Long only, no leverage; 1/6 initial capital per sleeve; no rebalancing within this 90-day experiment',validation:'Exploratory forward quote simulation, not real fills or independently established profitability'});
const protocolHash=crypto.createHash('sha256').update(JSON.stringify(PROTOCOL)).digest('hex');
function bar(row){return {t:+row[0],o:+row[1],h:+row[2],l:+row[3],c:+row[4],end:+row[6]};}
function checked(rows,now){
 const bars=rows.map(bar).filter(b=>b.end<now);let last=-Infinity;
 for(const b of bars){if(!Object.values(b).every(Number.isFinite)||b.t<=last||b.t%H4||b.end!==b.t+H4-1||b.l<=0||b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c))throw Error('Invalid H4 candles');last=b.t;}
 if(!bars.length||now-(bars.at(-1).end+1)>H4+120000)throw Error('Stale closed H4 candles');
 for(let i=1;i<bars.length;i++)if(bars[i].t-bars[i-1].t!==H4)throw Error('H4 history gap');
 return bars;
}
function indicator(previous,b){
 if(!previous)return {ema20:b.c,ema200:b.c,atr:b.h-b.l,close:b.c,lastBar:b.t,count:1};
 if(b.t!==previous.lastBar+H4)throw Error('Indicator history gap; preserve state and recover missing candles');
 const tr=Math.max(b.h-b.l,Math.abs(b.h-previous.close),Math.abs(b.l-previous.close));
 return {ema20:previous.ema20+(b.c-previous.ema20)*2/21,ema200:previous.ema200+(b.c-previous.ema200)*2/201,atr:previous.atr+(tr-previous.atr)/14,close:b.c,lastBar:b.t,count:previous.count+1};
}
function quoteValid(q,now){if(!(q?.price>0&&Number.isFinite(q.price)&&Number.isFinite(q.observedAt)&&q.observedAt<=now&&now-q.observedAt<=120000))throw Error('Missing or stale observed quote');}
function advance(prior,input,now){
 if(!Number.isFinite(now))throw Error('Invalid observation time');
 if(prior&&(prior.protocolHash!==protocolHash||prior.version!==PROTOCOL.version))throw Error('Frozen paper protocol changed; use a new cohort');
 const state=prior?structuredClone(prior):{version:PROTOCOL.version,protocolHash,protocol:PROTOCOL,mode:'SIMULATION',approvedForLive:false,automaticOrders:false,startedAt:now,updatedAt:now,sleeves:{},events:[],closedTrades:0,realizedPnl:0,fees:0,peak:PROTOCOL.initialUsd,maxObservedDrawdown:0,samples:0,missedH4Decisions:0};
 if(state.completedAt)return state;
 const completing=now-state.startedAt>=PROTOCOL.maximumDays*86400000;
 for(const symbol of PROTOCOL.symbols){
  const data=input[symbol];if(!data)throw Error('Missing market data '+symbol);quoteValid(data.quote,now);
  const bars=checked(data.rows,now),latest=bars.at(-1),q=data.quote.price;
  let p=state.sleeves[symbol];
  if(!p){if(bars.length<PROTOCOL.warmupBars)throw Error('Insufficient warm-up '+symbol);let feature=null;for(const b of bars)feature=indicator(feature,b);
   const cash=PROTOCOL.initialUsd/PROTOCOL.symbols.length,fee=PROTOCOL.feeBps/10000,slip=PROTOCOL.slippageBps/10000;
   p=state.sleeves[symbol]={cash,position:null,indicator:feature,lastDecisionBar:latest.t,lastQuote:q,quoteAt:data.quote.observedAt,benchmarkQty:cash/(q*(1+slip)*(1+fee)),status:'BASELINE_NO_ENTRY'};
  }else{
   const newer=bars.filter(b=>b.t>p.indicator.lastBar);
   for(const b of newer)p.indicator=indicator(p.indicator,b);
   const newDecision=latest.t>p.lastDecisionBar;
   if(newDecision)state.missedH4Decisions+=Math.max(0,(latest.t-p.lastDecisionBar)/H4-1);
   const f=p.indicator,fee=PROTOCOL.feeBps/10000,slip=PROTOCOL.slippageBps/10000;
   const stop=p.position&&q<=p.position.stop,exit=stop||completing||(newDecision&&f.close<f.ema20);let exited=false;
   if(p.position&&exit){const fill=q*(1-slip),gross=p.position.qty*fill,fees=gross*fee,proceeds=gross-fees,pnl=proceeds-p.position.spent;
    const event={type:'EXIT',symbol,observedAt:data.quote.observedAt,decisionBar:latest.t,price:fill,quote:q,reason:stop?'STOP_OBSERVED':completing?'EXPERIMENT_END':'RULE',entryAt:p.position.observedAt,stop:p.position.stop,pnl,netReturn:proceeds/p.position.spent-1,fees,delayMs:stop?null:Math.max(0,data.quote.observedAt-(latest.end+1))};
    state.events.push(event);state.closedTrades++;state.realizedPnl+=pnl;state.fees+=fees;p.cash+=proceeds;p.position=null;exited=true;p.status='CLOSED';
   }
   if(!p.position&&!exited&&!completing&&newDecision&&f.close>f.ema20+PROTOCOL.entryAtr*f.atr&&f.close>f.ema200){
    const fill=q*(1+slip),stopPrice=fill-PROTOCOL.stopAtr*f.atr;
    if(stopPrice>0){const spent=p.cash,qty=spent/(fill*(1+fee)),fees=qty*fill*fee;
     p.position={qty,spent,entry:fill,stop:stopPrice,observedAt:data.quote.observedAt,decisionBar:latest.t};p.cash=0;state.fees+=fees;p.status='OPEN';
     state.events.push({type:'ENTRY',symbol,observedAt:data.quote.observedAt,decisionBar:latest.t,price:fill,quote:q,stop:stopPrice,fees,delayMs:Math.max(0,data.quote.observedAt-(latest.end+1))});
    }
   }else if(!p.position&&!exited)p.status=completing?'COMPLETE':'WAITING';
   if(newDecision)p.lastDecisionBar=latest.t;
   p.lastQuote=q;p.quoteAt=data.quote.observedAt;
  }
 }
 const exitFactor=(1-PROTOCOL.slippageBps/10000)*(1-PROTOCOL.feeBps/10000);
 state.equity=Object.values(state.sleeves).reduce((sum,p)=>sum+p.cash+(p.position?p.position.qty*p.lastQuote*exitFactor:0),0);
 state.benchmarkEquity=Object.values(state.sleeves).reduce((sum,p)=>sum+p.benchmarkQty*p.lastQuote*exitFactor,0);
 state.peak=Math.max(state.peak,state.equity);state.maxObservedDrawdown=Math.max(state.maxObservedDrawdown,1-state.equity/state.peak);
 state.updatedAt=now;state.samples++;state.events=state.events.slice(-300);state.status=completing?'COMPLETE':'COLLECTING';if(completing)state.completedAt=now;
 return state;
}
module.exports={PROTOCOL,protocolHash,H4,indicator,checked,advance};
