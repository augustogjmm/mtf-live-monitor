'use strict';
// Independent exploratory engine; the frozen earlier study remains unchanged.
const {enrich,DAY}=require('./daily-research.cjs');
function features(rows){
 const base=enrich(rows);let e12=rows[0].c,e26=e12,signal=0,adx=0,plus=0,minus=0,tr=0;
 return base.map((b,i)=>{
  e12+=(b.c-e12)*2/13;e26+=(b.c-e26)*2/27;const macd=e12-e26;signal+=(macd-signal)*2/10;
  const p=rows[i-1]||b,up=b.h-p.h,down=p.l-b.l;
  plus+=((up>down&&up>0?up:0)-plus)/14;minus+=((down>up&&down>0?down:0)-minus)/14;
  tr+=(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c))-tr)/14;
  const dx=plus+minus?100*Math.abs(plus-minus)/(plus+minus):0;adx+=(dx-adx)/14;
  const window=rows.slice(Math.max(0,i-19),i+1),center=(Math.max(...window.map(x=>x.h))+Math.min(...window.map(x=>x.l))+b.sma20)/3;
  const prior=rows.slice(Math.max(0,i-20),i),range=n=>{const a=rows.slice(Math.max(0,i-n+1),i+1);return (Math.max(...a.map(x=>x.h))+Math.min(...a.map(x=>x.l)))/2;};
  return {...b,macd,hist:macd-signal,adx,plus,minus,squeeze:2*b.sd20<1.5*b.atr,squeezeRelease:i>0&&2*base[i-1].sd20<1.5*base[i-1].atr&&2*b.sd20>=1.5*b.atr,squeezeMomentum:b.c-center,mid9:range(9),mid26:range(26),mid52:range(52),prevClose:p.c,rangeHigh:prior.length?Math.max(...prior.map(x=>x.h)):NaN,rangeLow:prior.length?Math.min(...prior.map(x=>x.l)):NaN};
 });
}
function rules(b,s,held){
 if(!b||!b.warmed)return {enter:false,exit:false};
 const c=b.c,trend=!s.trend||c>b['ema'+s.trend];let enter=false,exit=false;
 switch(s.family){
 case 'buyHold':enter=true;break;
 case 'ema':enter=c>b['ema'+s.fast]&&b['ema'+s.fast]>b['ema'+s.slow];exit=c<b['ema'+s.fast];break;
 case 'donchian':enter=c>b['high'+s.n];exit=c<b['low'+s.out];break;
 case 'momentum':enter=b['roc'+s.n]>0;exit=b['roc'+s.n]<=0;break;
 case 'rsi2':enter=trend&&b.rsi2<s.level;exit=b.rsi2>s.out;break;
 case 'rsi14':enter=trend&&b.rsi14<s.level;exit=b.rsi14>s.out;break;
 case 'rsiTrend':enter=trend&&b.rsi14>s.level;exit=b.rsi14<50;break;
 case 'bollingerRevert':enter=trend&&c<b.sma20-s.k*b.sd20;exit=c>=b.sma20;break;
 case 'bollingerBreak':enter=trend&&c>b.sma20+s.k*b.sd20;exit=c<b.sma20;break;
 case 'macd':enter=trend&&b.hist>0&&(s.zero?b.macd>0:true);exit=b.hist<0;break;
 case 'squeeze':enter=trend&&b.squeezeRelease&&b.squeezeMomentum>0&&b.hist>0;exit=b.squeezeMomentum<0||b.hist<0;break;
 case 'adx':enter=trend&&b.adx>s.level&&b.plus>b.minus;exit=b.plus<b.minus||c<b.ema20;break;
 case 'ichimoku':enter=c>Math.max(b.mid26,b.mid52)&&b.mid9>b.mid26;exit=c<b.mid26;break;
 case 'structure':enter=trend&&c>b.rangeHigh&&c>b.o&&b.c-b.o>s.body*b.atr;exit=c<b.rangeLow||c<b.ema20;break;
 case 'pullback':enter=trend&&b.l<b.ema20&&c>b.ema20&&c>b.prevClose;exit=c<b.ema50;break;
 case 'keltner':enter=trend&&c>b.ema20+s.k*b.atr;exit=c<b.ema20;break;
 default:throw Error('Unknown family '+s.family);
 }
 return {enter,exit:exit||held>=(s.hold||Infinity)};
}
function catalog(){
 const specs=[{family:'buyHold',stop:0,allocation:1}];
 const add=s=>{for(const stop of [2,3,5])for(const allocation of [.5,1])specs.push({...s,stop,allocation});};
 for(const [fast,slow] of [[10,50],[20,100],[50,200]])add({family:'ema',fast,slow});
 for(const [n,out] of [[20,10],[55,20]])add({family:'donchian',n,out});
 for(const n of [90,180])add({family:'momentum',n});
 for(const trend of [0,200]){
  for(const level of [5,10,20])for(const out of [70,90])add({family:'rsi2',level,out,trend,hold:10});
  for(const level of [25,30,35])add({family:'rsi14',level,out:60,trend,hold:20});
  for(const level of [55,60])add({family:'rsiTrend',level,trend});
  for(const k of [1.5,2,2.5]){add({family:'bollingerRevert',k,trend,hold:20});add({family:'bollingerBreak',k,trend});add({family:'keltner',k,trend});}
  for(const zero of [false,true])add({family:'macd',zero,trend});
  add({family:'squeeze',trend});
  for(const level of [20,25,30])add({family:'adx',level,trend});
  for(const body of [0,.5,1])add({family:'structure',body,trend});
  add({family:'pullback',trend});
 }
 add({family:'ichimoku'});
 return specs.map((s,i)=>({...s,id:s.family+'-'+i}));
}
function backtest(series,s,{from,to,fee=.001,slip=.0005,fx=[],delay=0}={}){
 const names=Object.keys(series),rates=new Map(fx.map(x=>[x.t,x.value]));let rate=fx.filter(x=>x.t<from).at(-1)?.value||1;
 const sleeves=names.map(name=>({name,cash:rate/names.length,qty:0,price:0,held:0,rows:series[name],index:0,stop:0}));
 const dates=[...new Set(Object.values(series).flatMap(a=>a.filter(b=>b.t>=from&&b.t<=to).map(b=>b.t)))].sort((a,b)=>a-b);
 let peak=1,dd=0,trades=0,wins=0,exposure=0;const curve=[];
 const sell=(p,price)=>{const proceeds=p.qty*price*(1-slip)*(1-fee);if(proceeds>p.spent)wins++;p.cash+=proceeds;p.qty=0;trades++;};
 for(let d=0;d<dates.length;d++){
  const t=dates[d];rate=rates.get(t)||rate;
  for(const p of sleeves){while(p.index<p.rows.length&&p.rows[p.index].t<t)p.index++;const b=p.rows[p.index];if(!b||b.t!==t)continue;
   // CEDEAR decisionBar is already strictly prior to the execution session.
   const decision=p.rows[p.index-delay]?.decisionBar||p.rows[p.index-1-delay];
   if(decision&&decision.t>=t)throw Error('Lookahead');const r=rules(decision,s,p.held);let exited=false;
   if(p.qty){p.held++;if(p.stop&&b.o<=p.stop){sell(p,b.o);exited=true;}else if(r.exit){sell(p,b.o);exited=true;}}
   if(!p.qty&&!exited&&r.enter){const fill=b.o*(1+slip),atr=decision.atr*(b.decisionBar?fill/decision.c:1),stop=s.stop?fill-s.stop*atr:0;
    if(stop>=0){p.spent=p.cash*s.allocation;p.qty=p.spent/(fill*(1+fee));p.cash-=p.spent;p.stop=stop;p.held=1;}}
   if(p.qty&&p.stop&&b.l<=p.stop)sell(p,p.stop);
   p.price=b.c;if(d===dates.length-1&&p.qty)sell(p,p.price);
  }
  const nav=sleeves.reduce((a,p)=>a+p.cash+p.qty*p.price,0)/rate;
  if(!(nav>0&&Number.isFinite(nav)))throw Error('Invalid NAV');peak=Math.max(peak,nav);dd=Math.max(dd,1-nav/peak);exposure+=sleeves.filter(p=>p.qty).length/names.length;curve.push([t,nav]);
 }
 const end=curve.at(-1)[1],years=(dates.at(-1)-dates[0]+DAY)/(365.25*DAY);
 return {return:end-1,cagr:end**(1/years)-1,drawdown:dd,calmar:dd?(end**(1/years)-1)/dd:0,trades,winRate:trades?wins/trades:null,exposure:exposure/dates.length,curve};
}
module.exports={features,rules,catalog,backtest};
