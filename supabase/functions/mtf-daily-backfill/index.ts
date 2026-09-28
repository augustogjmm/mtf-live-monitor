import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const BYMA = "https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free";
const STRATEGY_VERSION = "OB-LADDER-v3.6";
const LEGACY_STRATEGY_VERSION = "OB-LADDER-v3.5";
const STABLES = new Set(["USDT","USDC","DAI","FDUSD","TUSD","USDE","PYUSD","USDS","FRAX","USD1","USDD"]);
const CRYPTO_FALLBACK = ["BTC","ETH","BNB","XRP","SOL","DOGE","ADA","TRX","AVAX","LINK","SUI","XLM","HBAR","BCH","LTC","DOT","UNI","AAVE","NEAR","APT"];
const UNDERLYING_MAP: Record<string,string> = { BBV:"BBVA", B:"GOLD", "BA.C":"BAC", BRKB:"BRK-B", BRKA:"BRK-A", DISN:"DIS", TRVV:"TRV", UN:"NU", NOKA:"NOK", KOFM:"KOF", "AKO.B":"AKO-B", ADGO:"AGRO", BNG:"BG", TXR:"TX", XROX:"XRX", BPA11:"BPAC11.SA" };
const BRAZIL_ORIGIN = new Set(["VALE3","PETR3","BBDC3","MGLU3","ITUB3","PRIO3","BBAS3","RENT3","SUZB3","ABEV3","HAPV3","LREN3","CSNA3","NATU3","WEGE3","SBSP3","VIVT3","TIMS3"]);
function underlyingFor(sym:string){ const s=String(sym||"").trim().toUpperCase(); return UNDERLYING_MAP[s]||(BRAZIL_ORIGIN.has(s)?s+".SA":s); }
function originTz(u:string){ return String(u||"").toUpperCase().endsWith(".SA")?"America/Sao_Paulo":"America/New_York"; }
const MERVAL_ADR: Record<string,string> = { GGAL:"GGAL", YPFD:"YPF", PAMP:"PAM", BMA:"BMA", SUPV:"SUPV", BBAR:"BBAR", CEPU:"CEPU", EDN:"EDN", TGSU2:"TGS", TECO2:"TEO", LOMA:"LOMA", CRES:"CRESY", IRSA:"IRS", VIST:"VIST" };
const MERVAL_FAVORITES = new Set(["GGAL","YPFD","PAMP","BMA","SUPV","BBAR","CEPU","EDN","TGSU2","TECO2","LOMA","CRES","IRSA","VIST","TXAR","ALUA","BYMA","COME","VALO"]);

type Bar = { t:number; o:number; h:number; l:number; c:number; v?:number };
type DailyBar = { t:number; open:number; high:number; low:number; close:number; volume:number };
type SignalInsert = { market:"crypto"|"cedear"|"merval"; symbol:string; underlying?:string|null; direction:string; signal_time:string; entry:number; stop:number; tp1:number; tp2:number; tp3:number; source:string; context:any; };

function n(v:any){ if(v===null||v===undefined||v==="")return NaN; const x=Number(v); return Number.isFinite(x)?x:NaN; }
function avg(a:number[]){ const x=a.filter(Number.isFinite); return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN; }
function clamp(v:number,a=0,b=100){ return Math.max(a,Math.min(b,v)); }
function iso(t:number){ return new Date(t).toISOString(); }
async function fetchText(url:string, init:RequestInit={}, timeout=15000){ const c=new AbortController(); const tm=setTimeout(()=>c.abort(),timeout); try{ const r=await fetch(url,{...init,signal:c.signal}); if(!r.ok) throw new Error(`${r.status} ${url}`); return await r.text(); } finally{ clearTimeout(tm); } }
async function fetchJson(url:string, init:RequestInit={}, timeout=15000){ return JSON.parse(await fetchText(url,init,timeout)); }
function ema(v:number[],p:number){ const o:(number|null)[]=Array(v.length).fill(null); if(v.length<p)return o; let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);o[p-1]=e;for(let i=p;i<v.length;i++){e=v[i]*k+e*(1-k);o[i]=e;}return o; }
function rsi(v:number[],p=14){ const o:(number|null)[]=Array(v.length).fill(null);if(v.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];if(d>=0)g+=d;else l-=d;}g/=p;l/=p;o[p]=l===0?100:100-100/(1+g/l);for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(0,d))/p;l=(l*(p-1)+Math.max(0,-d))/p;o[i]=l===0?100:100-100/(1+g/l);}return o; }
function macd(v:number[]){ const a=ema(v,12),b=ema(v,26),L=v.map((_,i)=>a[i]!=null&&b[i]!=null?(a[i] as number)-(b[i] as number):null),z=ema(L.filter((x):x is number=>x!=null),9),S:(number|null)[]=Array(v.length).fill(null);let j=0;for(let i=0;i<L.length;i++)if(L[i]!=null)S[i]=z[j++]??null;const H=L.map((x,i)=>x!=null&&S[i]!=null?(x as number)-(S[i] as number):null);return{L,S,H}; }
function atr(b:Bar[],p=14){ const tr=b.map((x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)):x.h-x.l),o:(number|null)[]=Array(tr.length).fill(null);if(tr.length<p)return o;let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;o[p-1]=a;for(let i=p;i<tr.length;i++){a=(a*(p-1)+tr[i])/p;o[i]=a;}return o; }
function slope(a:(number|null)[],bars=5){const i=a.length-1,j=i-bars;return j>=0&&a[i]!=null&&a[j]!=null?(a[i] as number)-(a[j] as number):NaN;}
function maxPrev(b:Bar[],count:number){return Math.max(...b.slice(-count-1,-1).map(x=>x.h));}
function minPrev(b:Bar[],count:number){return Math.min(...b.slice(-count-1,-1).map(x=>x.l));}

async function binanceKlines(pair:string,interval:string,limit=1000):Promise<Bar[]>{let err:any;for(const host of ["https://api.binance.com","https://data-api.binance.vision"]){try{const a=await fetchJson(`${host}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`,{},18000),now=Date.now();return a.map((x:any[])=>({t:+x[6],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})).filter((x:Bar)=>x.t<now);}catch(e){err=e;}}throw err||new Error("Binance error");}
async function binanceKlinesEnd(pair:string,interval:string,endTime:number,limit=1000):Promise<Bar[]>{
  let err:any;
  for(const host of ["https://api.binance.com","https://data-api.binance.vision"]){
    try{
      const url=host+"/api/v3/klines?symbol="+pair+"&interval="+interval+"&endTime="+Math.floor(endTime)+"&limit="+limit;
      const a=await fetchJson(url,{},18000),now=Date.now();
      return a.map((x:any[])=>({t:+x[6],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})).filter((x:Bar)=>x.t<now);
    }catch(e){err=e;}
  }
  throw err||new Error("Binance history error");
}
async function binanceDetectorHistory(pair:string,maxPages=8):Promise<Bar[]>{
  let bars=await binanceKlines(pair,"1h",1000);
  for(let page=1;page<maxPages;page++){
    const ob=analyzerOrderBlocks(bars,3);
    if(ob.bulls.length>=3&&ob.bears.length>=3)break;
    if(!bars.length)break;
    const prevEnd=bars[0].t-3600000;
    const prev=await binanceKlinesEnd(pair,"1h",prevEnd,1000);
    if(!prev.length)break;
    const m=new Map<number,Bar>();for(const x of prev)m.set(x.t,x);for(const x of bars)m.set(x.t,x);
    bars=Array.from(m.values()).sort((a,b)=>a.t-b.t);
  }
  return bars;
}
async function binanceSpotUsdtSet(){
  const j=await fetchJson("https://api.binance.com/api/v3/exchangeInfo",{},18000),set=new Set<string>();
  for(const x of (j?.symbols||[])){
    const perms=Array.isArray(x?.permissions)?x.permissions:[];
    if(x?.status==="TRADING"&&x?.quoteAsset==="USDT"&&x?.isSpotTradingAllowed!==false&&(!perms.length||perms.includes("SPOT")))set.add(String(x.symbol||"").toUpperCase());
  }
  if(!set.size)throw new Error("Binance exchangeInfo sin pares Spot USDT");
  return set;
}
async function cryptoUniverse(){
  let eligible:Set<string>;
  try{eligible=await binanceSpotUsdtSet();}catch(_){eligible=new Set(CRYPTO_FALLBACK.map(s=>s+"USDT"));}
  const out:string[]=[];
  try{
    const j=await fetchJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false",{},15000);
    for(const x of j){
      const s=String(x.symbol||"").toUpperCase(),pair=s+"USDT";
      if(!s||STABLES.has(s)||out.includes(s)||!eligible.has(pair))continue;
      out.push(s);if(out.length===20)break;
    }
  }catch(_){}
  for(const s of CRYPTO_FALLBACK){if(out.length===20)break;if(!out.includes(s)&&eligible.has(s+"USDT"))out.push(s);}
  if(out.length<20){for(const pair of eligible){if(out.length===20)break;const s=pair.endsWith("USDT")?pair.slice(0,-4):"";if(s&&!STABLES.has(s)&&!out.includes(s))out.push(s);}}
  return out.slice(0,20);
}

type OB = { origin:number; confirm:number; originTime:number; confirmTime:number; top:number; bottom:number; avg:number };

function emaAnalyzer(values:number[],period:number){
  const out:(number|null)[]=[],k=2/(period+1);let e:number|null=null;
  for(const raw of values){const v=Number(raw);if(!Number.isFinite(v)){out.push(null);continue;}e=e===null?v:v*k+e*(1-k);out.push(e);}
  return out;
}
function macdAnalyzer(values:number[]){
  const fast=emaAnalyzer(values,12),slow=emaAnalyzer(values,26);
  const line=values.map((_,i)=>fast[i]!=null&&slow[i]!=null?(fast[i] as number)-(slow[i] as number):null);
  const clean=line.map(v=>v==null?0:v as number),sigRaw=emaAnalyzer(clean,9);
  const signal=line.map((v,i)=>v==null?null:sigRaw[i]);
  const hist=line.map((v,i)=>v!=null&&signal[i]!=null?(v as number)-(signal[i] as number):null);
  return{line,signal,hist};
}
function numericVolume(b:Bar){const v=Number(b?.v);return Number.isFinite(v)?v:0;}
function obMax(a:Bar[],s:number,e:number,k:"h"|"l"){let v=-Infinity;for(let i=s;i<=e;i++)if(a[i][k]>v)v=a[i][k];return v;}
function obMin(a:Bar[],s:number,e:number,k:"h"|"l"){let v=Infinity;for(let i=s;i<=e;i++)if(a[i][k]<v)v=a[i][k];return v;}
function volumePivot(a:Bar[],confirm:number,piv=5){
  const p=confirm-piv,l=p-piv;if(l<0)return false;const v=numericVolume(a[p]);
  for(let i=l;i<=confirm;i++)if(i!==p&&!(v>numericVolume(a[i])))return false;
  return true;
}
function mitigateObs(arr:OB[],target:number,bull:boolean){for(let i=arr.length-1;i>=0;i--)if(bull?target<arr[i].bottom:target>arr[i].top)arr.splice(i,1);}
function analyzerOrderBlocks(a:Bar[],limit=3){
  const piv=5,bulls:OB[]=[],bears:OB[]=[];let os=0;
  for(let i=piv;i<a.length;i++){
    const rs=i-piv+1,up=obMax(a,rs,i,"h"),lo=obMin(a,rs,i,"l"),p=i-piv;
    if(a[p].h>up)os=0;else if(a[p].l<lo)os=1;
    if(i>=2*piv&&volumePivot(a,i,piv)){
      const c=a[p],half=(c.h+c.l)/2;
      if(os===1){const bottom=c.l,top=half;bulls.unshift({origin:p,confirm:i,originTime:c.t,confirmTime:a[i].t,top,bottom,avg:(top+bottom)/2});}
      else{const top=c.h,bottom=half;bears.unshift({origin:p,confirm:i,originTime:c.t,confirmTime:a[i].t,top,bottom,avg:(top+bottom)/2});}
    }
    mitigateObs(bulls,lo,true);mitigateObs(bears,up,false);
  }
  return{bulls:bulls.slice(0,limit),bears:bears.slice(0,limit)};
}
function tfAnalyzer(b:Bar[]){
  if(!b.length)return{ready:false,longScore:0,shortScore:0,net:0};
  const closes=b.map(x=>x.c),e10=emaAnalyzer(closes,10),e55=emaAnalyzer(closes,55),e200=emaAnalyzer(closes,200),m=macdAnalyzer(closes),i=closes.length-1;
  const c=closes[i],a10=n(e10[i]),a55=n(e55[i]),a200=n(e200[i]),ml=n(m.line[i]),ms=n(m.signal[i]),mh=n(m.hist[i]);
  const s55=i>=3&&e55[i-3]!=null?a55-n(e55[i-3]):0;
  const longRules=[c>a10,a10>a55,c>a55,Number.isFinite(a200)?c>a200:true,ml>ms,mh>=0,s55>=0];
  const shortRules=[c<a10,a10<a55,c<a55,Number.isFinite(a200)?c<a200:true,ml<ms,mh<=0,s55<=0];
  const longScore=longRules.filter(Boolean).length,shortScore=shortRules.filter(Boolean).length;
  const vols=b.slice(-20).map(x=>numericVolume(x)).filter(v=>v>0),vavg=vols.length?avg(vols):NaN,vr=Number.isFinite(vavg)&&vavg>0?numericVolume(b[i])/vavg:NaN;
  return{ready:b.length>=55,longScore,shortScore,net:longScore-shortScore,close:c,ema10:a10,ema55:a55,ema200:a200,macd:ml,signal:ms,histogram:mh,ema55Slope:s55,volumeRatio:vr,longRules,shortRules};
}
function swingLevels(b:Bar[],direction:"LONG"|"SHORT",lookback=180){
  const out:{price:number;source:string}[]=[],start=Math.max(2,b.length-lookback),end=b.length-2;
  for(let i=start;i<end;i++){
    if(direction==="LONG"&&b[i].h>b[i-1].h&&b[i].h>=b[i-2].h&&b[i].h>b[i+1].h&&b[i].h>=b[i+2].h)out.push({price:b[i].h,source:"resistance"});
    if(direction==="SHORT"&&b[i].l<b[i-1].l&&b[i].l<=b[i-2].l&&b[i].l<b[i+1].l&&b[i].l<=b[i+2].l)out.push({price:b[i].l,source:"support"});
  }
  return out;
}
function targetLevels(direction:"LONG"|"SHORT",entry:number,sets:{name:string;bars:Bar[]}[]){
  const all:{price:number;source:string}[]=[];
  for(const s of sets){
    if(!s.bars?.length)continue;
    const obs=analyzerOrderBlocks(s.bars,6),opposite=direction==="LONG"?obs.bears:obs.bulls;
    for(const o of opposite)all.push({price:o.avg,source:s.name+"_opposite_ob"});
    for(const p of swingLevels(s.bars,direction))all.push({price:p.price,source:s.name+"_"+p.source});
    const tail=s.bars.slice(-55);
    if(tail.length)all.push({price:direction==="LONG"?Math.max(...tail.map(x=>x.h)):Math.min(...tail.map(x=>x.l)),source:s.name+"_range_extreme"});
  }
  const favorable=all.filter(x=>Number.isFinite(x.price)&&(direction==="LONG"?x.price>entry:x.price<entry))
    .sort((a,b)=>direction==="LONG"?a.price-b.price:b.price-a.price);
  const dedup:{price:number;source:string}[]=[];
  for(const x of favorable){const tol=Math.max(Math.abs(entry)*0.0005,1e-12);if(!dedup.some(y=>Math.abs(y.price-x.price)<=tol))dedup.push(x);}
  return dedup.slice(0,4);
}


type LadderLevel = { rank:number; point:number; side:"below"|"above"; detectorSide:"bull"|"bear"; ob:OB };
function detectorLadder(bars:Bar[],referencePrice:number){
  // EXACT Analyzer v1.3.1 behavior: keep the latest 3 active bullish OBs and
  // latest 3 active bearish OBs. Do NOT merge and repartition by current price.
  const obs=analyzerOrderBlocks(bars,3);
  const bulls=obs.bulls.slice().sort((a,b)=>b.avg-a.avg).map((ob,i)=>({rank:i+1,point:ob.avg,side:"below" as const,detectorSide:"bull" as const,ob}));
  const bears=obs.bears.slice().sort((a,b)=>a.avg-b.avg).map((ob,i)=>({rank:i+1,point:ob.avg,side:"above" as const,detectorSide:"bear" as const,ob}));
  return{referencePrice,below:bulls,above:bears,allActive:bulls.length+bears.length,raw:obs,exactAnalyzer:true};
}


function contextOnly(bars:Bar[]){
  const x:any=tfAnalyzer(bars),trend=x.net>=3?"ALCISTA":x.net<=-3?"BAJISTA":"RANGO",a=atr(bars,14),atr14=n(a[a.length-1]);
  return{...x,trend,atr14};
}
function macroContext(h1:Bar[],h4:Bar[],d1:Bar[]){
  const one=contextOnly(h1),four=contextOnly(h4),day=contextOnly(d1);
  const ts=[one.trend,four.trend,day.trend],bull=ts.filter(x=>x==="ALCISTA").length,bear=ts.filter(x=>x==="BAJISTA").length;
  const trend=bull>=2?"ALCISTA":bear>=2?"BAJISTA":"RANGO";
  return{trend,h1:one,h4:four,d1:day};
}
function trendRelation(direction:"LONG"|"SHORT",trend:string){
  if(trend==="RANGO")return"RANGO";
  return(direction==="LONG"&&trend==="ALCISTA")||(direction==="SHORT"&&trend==="BAJISTA")?"A_FAVOR":"CONTRA_TENDENCIA";
}
function regulatedRiskProfile(diag:any){
  const d=String(diag?.context?.trend||"RANGO"),w=String(diag?.macroContext?.w1?.trend||diag?.macroContext?.trend||"RANGO");
  if(d==="ALCISTA"&&w==="ALCISTA")return{relation:"A_FAVOR",risk:"MENOR",daily:d,weekly:w};
  if(d==="BAJISTA"&&w==="BAJISTA")return{relation:"CONTRA_TENDENCIA",risk:"MAYOR",daily:d,weekly:w};
  return{relation:"INTERMEDIA",risk:"INTERMEDIO",daily:d,weekly:w};
}
function publicLevel(x:LadderLevel){
  return{rank:x.rank,point:x.point,side:x.side,detector_side:x.detectorSide,origin_time:x.ob.originTime,confirm_time:x.ob.confirmTime,zone_bottom:x.ob.bottom,zone_top:x.ob.top};
}
function zoneTouched(bar:{h:number;l:number},x:LadderLevel){return bar.l<=x.ob.top&&bar.h>=x.ob.bottom;}
function pointTouched(bar:{h:number;l:number},x:LadderLevel){return bar.l<=x.point&&bar.h>=x.point;}
function pointDistanceAtr(price:number,point:number,atr14:number){return Number.isFinite(atr14)&&atr14>0?Math.abs(price-point)/atr14:NaN;}
function proximityFor(ladder:any,price:number,atr14:number,regulated=false){
  const candidates:any[]=[];
  for(const x of (ladder?.below||[]))candidates.push({direction:"LONG",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distance_atr:pointDistanceAtr(price,x.point,atr14),in_zone:price>=x.ob.bottom&&price<=x.ob.top});
  if(!regulated)for(const x of (ladder?.above||[]))candidates.push({direction:"SHORT",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distance_atr:pointDistanceAtr(price,x.point,atr14),in_zone:price>=x.ob.bottom&&price<=x.ob.top});
  candidates.sort((a,b)=>a.distance-b.distance);
  const nearest=candidates[0]||null,state=nearest?.in_zone?"IN_ZONE":Number.isFinite(nearest?.distance_atr)&&nearest.distance_atr<=1?"NEAR":"WAIT";
  return{state,threshold_atr:1,nearest,candidates};
}
function structuralStop(direction:"LONG"|"SHORT",ladder:any,atr14:number){
  const side:LadderLevel[]=direction==="LONG"?ladder?.below||[]:ladder?.above||[];
  if(side.length<3)return NaN;
  const third=side[2],buffer=Number.isFinite(atr14)&&atr14>0?atr14*.25:Math.abs(third.point)*.0025;
  return direction==="LONG"?third.ob.bottom-buffer:third.ob.top+buffer;
}

function ladderSignal(direction:"LONG"|"SHORT",level:LadderLevel,diag:any,timeframe:"1h"|"1d"){
  const targets:LadderLevel[]=direction==="LONG"?diag.ladder.above:diag.ladder.below;if(targets.length<3)return null;
  const stop=n(diag?.stops?.[direction]);if(!Number.isFinite(stop))return null;
  return{direction,entry:level.point,stop,tp1:targets[0].point,tp2:targets[1].point,tp3:targets[2].point,context:{
    strategy_version:STRATEGY_VERSION,engine:"ANALYZER_CANONICAL_V3_6",operational_timeframe:timeframe,indicators_role:"context_only",
    proximity_rule:"NEAR_when_distance_to_nearest_entry_line_lte_1_ATR14",
    trigger_basis:"entry_only_when_intraday_range_crosses_exact_OB_center_line",
    stop_basis:"beyond_third_analyzer_entry_zone_plus_0_25_ATR",
    entry_rank:level.rank,ob_key:timeframe+":"+direction+":"+String(level.ob.originTime),order_block:level.ob,entry_level:publicLevel(level),targets:targets.map(publicLevel),
    ladder_snapshot:{reference_price:diag.ladder.referencePrice,below:diag.ladder.below.map(publicLevel),above:diag.ladder.above.map(publicLevel)},
    proximity:diag.proximity,context:diag.context,macro_context:diag.macroContext,
    trend_relation:timeframe==="1d"?regulatedRiskProfile(diag).relation:trendRelation(direction,diag.macroContext?.trend||diag.context.trend),
    risk_profile:timeframe==="1d"?regulatedRiskProfile(diag).risk:null,
    entry_policy:timeframe==="1d"?"require_D1_and_W1_ALCISTA_each_leg":"block_CONTRA_TENDENCIA_allow_A_FAVOR_or_RANGO_each_leg",
    exit_policy:timeframe==="1d"?"TP1_ONLY_NO_SL":"TP1_OR_SL",stop_policy:timeframe==="1d"?"NONE":"STRUCTURAL"}};
}

function cryptoObDiagnosticAt(bundle:any,t:number){
  const h1:Bar[]=bundle.h1.filter((x:Bar)=>x.t<=t),h4:Bar[]=bundle.h4.filter((x:Bar)=>x.t<=t),d1:Bar[]=bundle.d1.filter((x:Bar)=>x.t<=t),m15:Bar[]=bundle.m15.filter((x:Bar)=>x.t<=t);
  if(h1.length<55||h4.length<55||d1.length<55||m15.length<2)return{ready:false,reason:"insufficient_history"};
  const trigger=m15[m15.length-1],reference=trigger.c,ladder=detectorLadder(h1,reference),macro=macroContext(h1,h4,d1),context=macro.h1,eligible=(x:LadderLevel)=>x.ob.confirmTime<trigger.t;
  const longTouches=ladder.below.filter(x=>eligible(x)&&pointTouched(trigger,x)),shortTouches=ladder.above.filter(x=>eligible(x)&&pointTouched(trigger,x));
  const stops={LONG:structuralStop("LONG",ladder,context.atr14),SHORT:structuralStop("SHORT",ladder,context.atr14)},proximity=proximityFor(ladder,reference,context.atr14,false);
  return{ready:true,historyBars:h1.length,trigger:{t:trigger.t,o:trigger.o,h:trigger.h,l:trigger.l,c:trigger.c,v:trigger.v},referencePrice:reference,ladder,context,macroContext:macro,stops,proximity,touches:{long:longTouches,short:shortTouches},ambiguousTrigger:longTouches.length>0&&shortTouches.length>0};
}
function evalCryptoAt(bundle:any,t:number){
  const diag:any=cryptoObDiagnosticAt(bundle,t);if(!diag.ready||diag.ambiguousTrigger)return[];const out:any[]=[];
  for(const x of diag.touches.long){const sg=ladderSignal("LONG",x,diag,"1h");if(sg)out.push(sg);}
  for(const x of diag.touches.short){const sg=ladderSignal("SHORT",x,diag,"1h");if(sg)out.push(sg);}
  return out;
}
function cryptoDiagnosticAt(bundle:any,t:number){return cryptoObDiagnosticAt(bundle,t);}
function cedearDiagnosticAt(dailyAll,t){
  const idx=dailyAll.findIndex(x=>x.t===t),current=idx>=0?dailyAll[idx]:dailyAll.filter(x=>x.t<=t).at(-1);if(!current)return{ready:false,reason:"missing_trigger_bar"};
  const actualIdx=dailyAll.findIndex(x=>x.t===current.t),prior=dailyAll.slice(0,actualIdx);if(prior.length<55)return{ready:false,reason:"insufficient_daily_history"};
  const bars=prior.map(x=>({t:x.t,o:x.open,h:x.high,l:x.low,c:x.close,v:x.volume})),reference=current.close,ladder=detectorLadder(bars,reference),context=contextOnly(bars);
  const weeklyBars=weeksFromDaily(dailyAll,current.t);if(weeklyBars.length<2)return{ready:false,reason:"insufficient_weekly_history_lt2"};
  const weekly=contextOnly(weeklyBars),macroContext={trend:weekly.trend,d1:context,w1:weekly,dominant_timeframe:"1w"};
  const touches=ladder.below.filter(x=>x.ob.confirmTime<current.t&&zoneTouched({h:current.high,l:current.low},x));
  const stops={LONG:structuralStop("LONG",ladder,context.atr14)},proximity=proximityFor(ladder,reference,context.atr14,true);
  return{ready:true,qualifiedDirection:touches.length?"LONG":null,trigger:{t:current.t,o:current.open,h:current.high,l:current.low,c:current.close,v:current.volume},referencePrice:reference,ladder,context,macroContext,stops,proximity,touches:{long:touches}};
}

async function flushAudit(rows:any[]){
 if(!rows.length)return;
 try{
  for(let i=0;i<rows.length;i+=150){
   const {error}=await sb.from("mtf_decision_audit").upsert(rows.slice(i,i+150),{onConflict:"strategy_version,market,symbol,signal_time"});
   if(error)throw error;
  }
 }catch(e){console.error("audit_write_failed",String((e as Error).message||e));}
}
function auditRow(cycleId:string,market:"crypto"|"cedear"|"merval",symbol:string,underlying:string|null,direction:string|null,signalTime:number,decision:string,reason:string,context:any){
 return{strategy_version:STRATEGY_VERSION,cycle_id:cycleId,market,symbol,underlying,direction,signal_time:iso(signalTime),evaluated_at:new Date().toISOString(),decision,reason,context};
}
function panelAmount(r:any){const a=n(r.volumeAmount);if(a>0)return a;const tv=n(r.tradeVolume);if(tv>0)return tv;const v=n(r.volume),p=n(r.trade??r.closingPrice);return Number.isFinite(v)&&Number.isFinite(p)?v*p:0;}
function rowsFrom(o:any){if(Array.isArray(o))return o;if(Array.isArray(o?.data))return o.data;if(Array.isArray(o?.content))return o.content;return[];}
async function bymaPanel(){
 const payloads=[{page_size:5000},{},{T1:true,page_size:5000}];
 let last:any;
 for(const body of payloads){
  try{
   const rows=rowsFrom(await fetchJson(BYMA+"/cedears",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify(body)},20000));
   if(rows.length)return rows;
   last=new Error("BYMA respondió sin registros");
  }catch(e){last=e;}
 }
 throw last||new Error("BYMA no devolvió CEDEARs");
}
function pickByma(raw:any[]){
 const withSymbol=(raw||[]).filter(r=>String(r?.symbol||"").trim());
 let stage=withSymbol;
 const ars=stage.filter(r=>String(r?.denominationCcy||"").trim().toUpperCase()==="ARS");
 if(ars.length)stage=ars;
 const settled=stage.filter(r=>String(r?.settlementType||"").trim()==="2");
 if(settled.length)stage=settled;
 if(!stage.length)stage=withSymbol;
 const groups=new Map<string,any[]>();
 for(const r of stage){const s=String(r.symbol||"").trim().toUpperCase();if(!groups.has(s))groups.set(s,[]);groups.get(s)!.push(r);}
 const out:any[]=[];
 for(const [s,rows] of groups){rows.sort((a,b)=>panelAmount(b)-panelAmount(a));const best=rows[0];if(best)out.push({...best,symbol:s});}
 return out.sort((a,b)=>panelAmount(b)-panelAmount(a)||String(a.symbol).localeCompare(String(b.symbol))).slice(0,2000);
}
async function bymaHistory(sym:string,days=260):Promise<DailyBar[]>{
 const to=Math.floor(Date.now()/1000)+86400;
 const from=to-86400*Math.max(60,days);
 const url=BYMA+"/chart/historical-series/history?symbol="+encodeURIComponent(sym+" 24HS")+"&resolution=D&from="+from+"&to="+to;
 let last:any;
 for(let attempt=0;attempt<3;attempt++){
   try{
     if(attempt)await new Promise(r=>setTimeout(r,250*attempt));
     const j=await fetchJson(url,{},18000);
     if(j?.s!=="ok"||!Array.isArray(j.t))throw new Error("respuesta histórica inválida");
     const out:DailyBar[]=[];
     for(let i=0;i<j.t.length;i++){
       const c=n(j.c?.[i]),v=n(j.v?.[i]);
       if(Number.isFinite(c)&&Number.isFinite(v))out.push({t:j.t[i]*1000,open:n(j.o?.[i]),high:n(j.h?.[i]),low:n(j.l?.[i]),close:c,volume:v});
     }
     if(out.length<20)throw new Error("histórico insuficiente");
     return out;
   }catch(e){last=e;}
 }
 throw last||new Error("histórico BYMA no disponible");
}
function adtv(b:DailyBar[],days:number){const x=b.slice(-days);return x.length?avg(x.map(v=>v.close*v.volume)):NaN;}
function persist(b:DailyBar[]){const x=b.slice(-40);return x.length?x.filter(v=>v.volume>0).length/x.length:NaN;}
function panelFastMetrics(p:any){
  const bid=n(p?.bidPrice??p?.bid??p?.bestBid),ask=n(p?.offerPrice??p?.ask??p?.bestOffer),mid=bid>0&&ask>0?(bid+ask)/2:NaN;
  const turnover=panelAmount(p);
  return{
    adtv5:turnover,adtv20:turnover,adtv40:turnover,currentVolumeAmount:turnover,
    tradeCount:n(p?.tradeCount??p?.trades??p?.operations??p?.quantityOperations),
    spreadPct:mid>0&&ask>=bid?(ask-bid)/mid*100:NaN,
    volumeAccelerationPct:0,persistence:1,
    metricSource:"BYMA_CURRENT_TURNOVER"
  };
}
function liqMetrics(p:any,b:DailyBar[]){const bid=n(p.bidPrice??p.bid??p.bestBid),ask=n(p.offerPrice??p.ask??p.bestOffer),mid=bid>0&&ask>0?(bid+ask)/2:NaN,a5=adtv(b,5),a20=adtv(b,20),a40=adtv(b,40);return{adtv5:a5,adtv20:a20,adtv40:a40,currentVolumeAmount:panelAmount(p),tradeCount:n(p.tradeCount??p.trades??p.operations??p.quantityOperations),spreadPct:mid>0&&ask>=bid?(ask-bid)/mid*100:NaN,volumeAccelerationPct:a20>0&&a5>0?(a5/a20-1)*100:NaN,persistence:persist(b)};}
function selectLiquidUniverse(a:any[]){
 // No Top-N and no cumulative-volume quota.
 // Keep the broad traded universe and only discard the marginal low-activity tail.
 const traded=a
   .filter(x=>n(x?.liquidity?.adtv20)>0)
   .sort((x,y)=>n(y.liquidity?.adtv20)-n(x.liquidity?.adtv20)||String(x.symbol).localeCompare(String(y.symbol)));
 if(!traded.length)return[];
 const vols=traded.map(x=>n(x.liquidity?.adtv20)).sort((a,b)=>a-b),
       p10=vols[Math.max(0,Math.min(vols.length-1,Math.floor((vols.length-1)*0.10)))],
       floor=Math.max(100000,p10);
 const base=traded.filter(x=>n(x.liquidity?.adtv20)>=floor),
       total=base.reduce((sum,x)=>sum+n(x.liquidity?.adtv20),0);
 let cum=0;
 return base.map((x,i)=>{
   cum+=n(x.liquidity?.adtv20);
   return{
     ...x,eligible_liquid:true,liquidity_rank:i+1,
     liquidity_floor:floor,liquidity_rule:"ALL_TRADED_EXCEPT_BOTTOM_ACTIVITY_TAIL",
     liquidity_coverage_pct:total>0?cum/total*100:0
   };
 });
}
async function pool<T,R>(a:T[],limit:number,fn:(x:T)=>Promise<R>){let i=0;const o:(R|null)[]=new Array(a.length).fill(null);await Promise.all(Array.from({length:Math.min(limit,a.length)},async()=>{while(i<a.length){const j=i++;try{o[j]=await fn(a[j]);}catch(_){o[j]=null;}}}));return o;}
async function cedearUniverse(){const panel=pickByma(await bymaPanel()),e=(await pool(panel,5,async r=>{const b=await bymaHistory(String((r as any).symbol).toUpperCase());if(b.length<20)return null;return{symbol:String((r as any).symbol).toUpperCase(),liquidity:liqMetrics(r,b)};})).filter(Boolean) as any[];return selectLiquidUniverse(e);}

async function ensureCedearWork(runDate:string){
  const {data:existing,error:existingErr}=await sb.from("mtf_cedear_work").select("symbol").eq("run_date",runDate);
  if(existingErr)throw existingErr;
  const panel=pickByma(await bymaPanel());
  if(!panel.length){
    if((existing||[]).length)return (existing||[]).length;
    throw new Error("BYMA no devolvió universo CEDEAR");
  }
  const have=new Set((existing||[]).map((r:any)=>String(r.symbol||"").toUpperCase()));
  const rows=panel.filter((r:any)=>!have.has(String(r.symbol||"").toUpperCase())).map((r:any)=>({
    run_date:runDate,
    symbol:String(r.symbol||"").toUpperCase(),
    underlying:underlyingFor(String(r.symbol||"").toUpperCase()),
    raw:r,
    metrics:null,
    tier:null,
    score:null,
    coverage_pct:null,
    metrics_done:false,
    signal_done:false,
    attempts:0,
    last_error:null,
    eligible_liquid:false,
    liquidity_rank:null,
    updated_at:new Date().toISOString()
  }));
  for(let i=0;i<rows.length;i+=250){
    const {error}=await sb.from("mtf_cedear_work").upsert(rows.slice(i,i+250),{onConflict:"run_date,symbol",ignoreDuplicates:true});
    if(error)throw error;
  }
  return have.size+rows.length;
}
async function bootstrapCedearUniverse(){
  const runDate=dateTZ("America/Argentina/Buenos_Aires");
  const total=await ensureCedearWork(runDate);
  const {count:pending,error}=await sb.from("mtf_cedear_work").select("symbol",{count:"exact",head:true}).eq("run_date",runDate).eq("metrics_done",false);
  if(error)throw error;
  return{strategy_version:STRATEGY_VERSION,run_date:runDate,total,pending:pending||0,bootstrap:true};
}

async function yahooDailyRaw(symbol:string){
 let last:any;
 for(const host of ["https://query1.finance.yahoo.com","https://query2.finance.yahoo.com"]){
  try{
   const u=`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}&includePrePost=false&events=div%2Csplits`;
   const j=await fetchJson(u,{headers:{"user-agent":"Mozilla/5.0","accept":"application/json"}},18000),z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{},meta=z?.meta||{};
   if(!z?.timestamp?.length)throw new Error("Yahoo sin datos");
   const bars:DailyBar[]=[];
   for(let i=0;i<z.timestamp.length;i++){const c=n(q.close?.[i]),hi=n(q.high?.[i]),lo=n(q.low?.[i]);if(!Number.isFinite(c)||!Number.isFinite(hi)||!Number.isFinite(lo))continue;bars.push({t:z.timestamp[i]*1000,open:n(q.open?.[i]),high:hi,low:lo,close:c,volume:n(q.volume?.[i])||0});}
   if(!bars.length)throw new Error("Yahoo sin barras");
   return {bars,meta};
  }catch(e){last=e;}
 }
 throw last||new Error("Yahoo sin datos");
}
function yahooClosedBars(raw:any):DailyBar[]{
 let out:DailyBar[]=[...(raw?.bars||[])]; if(!out.length)return out;
 const meta=raw?.meta||{},tz=String(meta.exchangeTimezoneName||"America/New_York"),last=out.at(-1)!,end=n(meta?.currentTradingPeriod?.regular?.end)*1000;
 try{ if(dateTZ(tz,last.t)===dateTZ(tz)&&end>0&&Date.now()<end+5*60*1000)out=out.slice(0,-1); }catch(_){}
 return out;
}
function brlToUsdDaily(stock:DailyBar[],fx:DailyBar[]){
 const tz="America/Sao_Paulo",f=fx.map(x=>({k:dateTZ(tz,x.t),r:n(x.close)})).filter(x=>x.r>0).sort((a,b)=>a.k.localeCompare(b.k)),out:DailyBar[]=[];
 let j=0,rate=NaN;
 for(const b of stock){const k=dateTZ(tz,b.t);while(j<f.length&&f[j].k<=k){rate=f[j].r;j++;}if(!(rate>0))continue;out.push({...b,open:n(b.open)/rate,high:n(b.high)/rate,low:n(b.low)/rate,close:n(b.close)/rate});}
 return out;
}
async function yahooDaily(symbol:string):Promise<DailyBar[]>{
 const raw=await yahooDailyRaw(symbol); let out=yahooClosedBars(raw);
 if(String(symbol).toUpperCase().endsWith(".SA")){const fx=await yahooDailyRaw("BRL=X");out=brlToUsdDaily(out,fx.bars||[]);}
 if(out.length<14)throw new Error("Yahoo histórico insuficiente (<14 ruedas)");
 return out;
}
async function yahooLiveRaw(symbol:string){
 let last:any;
 for(const host of ["https://query1.finance.yahoo.com","https://query2.finance.yahoo.com"]){
  try{
   const u=`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`;
   const j=await fetchJson(u,{headers:{"user-agent":"Mozilla/5.0","accept":"application/json"}},18000),
         z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{},ts=z?.timestamp||[];
   if(!z||!ts.length)throw new Error("Yahoo live sin datos");
   const bars:any[]=[];
   for(let i=0;i<ts.length;i++){
     const c=n(q.close?.[i]),h=n(q.high?.[i]),l=n(q.low?.[i]),op=n(q.open?.[i]);
     if(!Number.isFinite(c)||c<=0)continue;
     bars.push({t:ts[i]*1000,o:Number.isFinite(op)?op:c,h:Number.isFinite(h)?h:c,l:Number.isFinite(l)?l:c,c});
   }
   const name=String(z?.meta?.longName||z?.meta?.shortName||z?.meta?.displayName||"").trim();
   if(bars.length){
     const b=bars.at(-1)!;
     return{price:b.c,t:b.t,o:b.o,h:b.h,l:b.l,bars:bars.slice(-60),name};
   }
   const p=n(z?.meta?.regularMarketPrice),t=n(z?.meta?.regularMarketTime)*1000;
   if(p>0)return{price:p,t,o:p,h:p,l:p,bars:[{t,o:p,h:p,l:p,c:p}],name};
   throw new Error("Yahoo live sin precio");
  }catch(e){last=e;}
 }
 throw last||new Error("Yahoo live sin datos");
}
async function yahooLiveUsd(symbol:string){
 const q=await yahooLiveRaw(symbol);
 if(String(symbol).toUpperCase().endsWith(".SA")){
   const fx=await yahooLiveRaw("BRL=X");if(!(fx.price>0))throw new Error("FX BRL/USD live inválido");
   const fxb=(fx.bars||[]).slice().sort((a:any,b:any)=>a.t-b.t);
   let j=0,rate=n(fxb[0]?.c);if(!(rate>0))rate=fx.price;
   const converted:any[]=[];
   for(const b of (q.bars||[])){
     while(j+1<fxb.length&&fxb[j+1].t<=b.t){j++;const rr=n(fxb[j]?.c);if(rr>0)rate=rr;}
     if(!(rate>0))rate=fx.price;
     converted.push({t:b.t,o:b.o/rate,h:b.h/rate,l:b.l/rate,c:b.c/rate});
   }
   const liveRate=(()=>{const rr=n(fxb.at(-1)?.c);return rr>0?rr:fx.price})();
   const b=converted.at(-1)||{t:q.t,o:q.o/liveRate,h:q.h/liveRate,l:q.l/liveRate,c:q.price/liveRate};
   return{price:b.c,t:b.t,o:b.o,h:b.h,l:b.l,bars:converted,name:q.name||"",source:"Yahoo 1m BRL convertido a USD · FX alineado por minuto"};
 }
 return{price:q.price,t:q.t,o:q.o,h:q.h,l:q.l,bars:q.bars||[],name:q.name||"",source:"Yahoo 1m USD"};
}
function repriceInitial(cur:any,live:number){
 const atrVal=n(cur?.context?.daily?.atr),swing=n(cur?.context?.daily?.swingStop),
       ema200=n(cur?.context?.daily?.ema200),ema10=n(cur?.context?.daily?.ema10),breakout=n(cur?.context?.daily?.breakout);
 if(!(live>0)||![atrVal,swing,ema200,ema10,breakout].every(Number.isFinite))return null;
 if(!(live>ema200&&live>ema10&&live>breakout))return null;
 const atrStop=live-1.5*atrVal,stop=Math.min(swing,atrStop),risk=live-stop;
 if(!(risk>0))return null;
 return{entry:live,stop,tp1:live+risk,tp2:live+2*risk};
}
async function bootstrapInitialEntries(offset:number,limit:number){
 const runDate=(await sb.from("mtf_cedear_work").select("run_date").eq("eligible_liquid",true).order("run_date",{ascending:false}).limit(1)).data?.[0]?.run_date;
 if(!runDate)throw new Error("Sin universo CEDEAR líquido para bootstrap");
 const {data:ced,error:cedErr}=await sb.from("mtf_cedear_work").select("symbol,underlying,metrics,liquidity_rank").eq("run_date",runDate).eq("eligible_liquid",true).order("liquidity_rank",{ascending:true});
 if(cedErr)throw cedErr;
 const adr=await mervalUniverse();
 const all=[
   ...(ced||[]).map((x:any)=>({market:"cedear",symbol:x.symbol,underlying:x.underlying||underlyingFor(x.symbol),meta:x})),
   ...adr.map((x:any)=>({market:"merval",symbol:x.symbol,underlying:x.adr,meta:x}))
 ];
 const batch=all.slice(offset,offset+limit),created:any[]=[],audit:any[]=[],errors:any[]=[],now=Date.now(),cycleId="initial:"+iso(now);
 for(const x of batch){
  try{
   const d=x.market==="merval"?(await mervalSeries(x.meta)).daily:await yahooDaily(x.underlying);
   const last=d.at(-1);if(!last)throw new Error("Serie diaria vacía");
   const cur=evalCedearAt(d,last.t),diag=cedearDiagnosticAt(d,last.t);
   let decision="NO_ENTRY",reason="order_block_setup_not_triggered";
   if(cur){
    const live=await yahooLiveUsd(x.underlying),rp=repriceInitial(cur,live.price);
    if(rp){
      const inserted=await insertSignal({
        market:x.market,symbol:x.symbol,underlying:x.underlying,direction:"LONG",
        signal_time:iso(now),entry:rp.entry,stop:rp.stop,tp1:rp.tp1,tp2:rp.tp2,source:"FORWARD",
        context:{...(cur as any).context,initial_clean_start:true,technical_bar_time:iso(last.t),live_entry_time:iso(live.t),entry_basis:"live_market_after_clean_reset",live_source:live.source,liquidity_rank:x.meta?.liquidity_rank||null,liquidity:x.meta?.metrics||null}
      });
      decision=inserted?"ENTRY":"BLOCKED_OPEN";reason=inserted?"initial_clean_start_entry":"open_position_exists";
      if(inserted)created.push({market:x.market,symbol:x.symbol,entry:rp.entry,technical_bar_time:iso(last.t)});
    }else{reason="setup_closed_bar_valid_but_live_price_invalidated_price_rules";}
   }
   audit.push(auditRow(cycleId,x.market,x.symbol,x.underlying,cur?"LONG":diag?.qualifiedDirection||null,now,decision,reason,{initial_clean_start:true,technical_bar_time:iso(last.t),diagnostic:diag}));
  }catch(e){errors.push({market:x.market,symbol:x.symbol,error:String((e as Error).message||e)});}
 }
 await flushAudit(audit);
 return{strategy_version:STRATEGY_VERSION,initial_clean_start:true,total:all.length,offset,processed:batch.length,next_offset:offset+batch.length<all.length?offset+batch.length:null,created:created.length,created_items:created,errors};
}

function seriesReadyToday(d:DailyBar[],underlying:string){const last=d.at(-1);if(!last)return false;const tz=originTz(underlying);return dateTZ(tz,last.t)===dateTZ(tz);}
async function bymaEquityRows(endpoint:string){
 const body={T1:true,page_size:5000};
 return rowsFrom(await fetchJson(BYMA+"/"+endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify(body)},20000));
}
function normalizeMerval(leading:any[],general:any[]){
 const leadSet=new Set((leading||[]).map(r=>String(r?.symbol||"").trim().toUpperCase()).filter(Boolean));
 const all=[...(leading||[]),...(general||[])].filter(r=>{
   const s=String(r?.symbol||"").trim().toUpperCase(),st=String(r?.securityType||"").trim().toUpperCase(),mk=String(r?.market||"").trim().toUpperCase(),cc=String(r?.denominationCcy||"").trim().toUpperCase();
   return s&&(!st||st==="CS")&&(!mk||mk==="BYMA")&&(!cc||cc==="ARS");
 });
 const groups=new Map<string,any[]>();
 for(const r of all){const s=String(r.symbol||"").trim().toUpperCase();if(!groups.has(s))groups.set(s,[]);groups.get(s)!.push(r);}
 const out:any[]=[];
 for(const [symbol,rows] of groups){
   const settled=rows.filter(r=>String(r?.settlementType||"").trim()==="2"),pool=settled.length?settled:rows;
   pool.sort((a,b)=>panelAmount(b)-panelAmount(a)); const best=pool[0]; if(!best)continue;
   const isLeading=leadSet.has(symbol),favorite=MERVAL_FAVORITES.has(symbol); if(!isLeading&&!favorite)continue;
   const adr=MERVAL_ADR[symbol]||null; if(!adr)continue;
   out.push({symbol,adr,method:"ADR",sourcePanel:isLeading?"Líder":"Favorita",currentVolumeAmount:panelAmount(best)});
 }
 return out.sort((a,b)=>a.sourcePanel===b.sourcePanel?(b.currentVolumeAmount-a.currentVolumeAmount):(a.sourcePanel==="Líder"?-1:1));
}
async function mervalUniverse(){
 const [leading,general]=await Promise.all([bymaEquityRows("leading-equity"),bymaEquityRows("general-equity")]);
 const out=normalizeMerval(leading,general); if(!out.length)throw new Error("BYMA no devolvió Merval líder/favoritas"); return out;
}
function tzParts(tz:string,t=Date.now()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,weekday:"short"}).formatToParts(new Date(t)),o:any={};for(const p of parts)o[p.type]=p.value;return o;}
function dateTZ(tz:string,t=Date.now()){const p=tzParts(tz,t);return `${p.year}-${p.month}-${p.day}`;}
function dayKey(t:number){return dateTZ("America/Argentina/Buenos_Aires",t);}
function usDayKey(t:number){return dateTZ("America/New_York",t);}
function minsTZ(tz:string,t=Date.now()){const p=tzParts(tz,t);return Number(p.hour)*60+Number(p.minute);}
function weekendTZ(tz:string,t=Date.now()){return ["Sat","Sun"].includes(tzParts(tz,t).weekday);}
async function bymaSessionDateSet(){
 const b=await bymaHistory("GGAL",2400),set=new Set(b.map(x=>dayKey(x.t)));
 try{const {data}=await sb.from("mtf_state").select("meta").eq("market","market_guard").maybeSingle();const d=data?.meta?.byma?.sessionDate;if(d)set.add(String(d));}catch(_){}
 return set;
}
async function dailyMarketGuard(market:string){
  if(weekendTZ("America/Argentina/Buenos_Aires"))return{ok:false,reason:"byma_weekend"};
  if(minsTZ("America/Argentina/Buenos_Aires")<17*60+10)return{ok:false,reason:"byma_not_closed"};
  const todayBA=dateTZ("America/Argentina/Buenos_Aires");
  let bymaToday=false;
  try{
    const {data:g}=await sb.from("mtf_state").select("meta,last_run_at").eq("market","market_guard").maybeSingle();
    bymaToday=String(g?.meta?.byma?.sessionDate||"")===todayBA;
  }catch(_){}
  if(!bymaToday){const ba=await bymaHistory("GGAL",30);bymaToday=ba.some(x=>dayKey(x.t)===todayBA);}
  if(!bymaToday)return{ok:false,reason:"byma_no_session_today"};
  if(market==="cedear")return{ok:true,reason:"byma_closed_origin_validated_per_asset",todayBA};
  if(weekendTZ("America/New_York"))return{ok:false,reason:"usa_weekend"};
  if(minsTZ("America/New_York")<16*60+10)return{ok:false,reason:"ny_market_not_closed"};
  const todayUS=dateTZ("America/New_York"),us=await yahooDaily("SPY"),usaToday=us.some(x=>usDayKey(x.t)===todayUS);
  if(!usaToday)return{ok:false,reason:"usa_no_session_today"};
  return{ok:true,reason:"both_sessions_valid",todayBA,todayUS};
}
async function mervalSeries(x:any){
 if(!x?.adr)throw new Error("Activo sin ADR directo en USD");
 const d=await yahooDaily(x.adr);
 return{daily:d,underlying:x.adr,method:"ADR",source:"Yahoo Finance USD"};
}
function weekKey(t:number){const d=new Date(t),day=(d.getUTCDay()+6)%7,monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));return monday.toISOString().slice(0,10);}
function weeksFromDaily(d:DailyBar[],candidate:number):Bar[]{
 const x=d.filter(v=>v.t<=candidate),groups=new Map<string,DailyBar[]>();
 for(const b of x){const k=weekKey(b.t);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(b);}
 const keys=[...groups.keys()].sort(),out:Bar[]=[],currentWeek=weekKey(Date.now());
 for(let i=0;i<keys.length;i++){
  const g=groups.get(keys[i])!,last=g[g.length-1],isLast=i===keys.length-1,weekday=new Date(last.t).getUTCDay();
  if(isLast&&keys[i]===currentWeek&&weekday<5)continue;
  out.push({t:last.t,o:g[0].open,h:Math.max(...g.map(v=>v.high)),l:Math.min(...g.map(v=>v.low)),c:last.close,v:g.reduce((s,v)=>s+v.volume,0)});
 }
 return out;
}

function evalCedearAt(dailyAll:DailyBar[],t:number){
  const diag:any=cedearDiagnosticAt(dailyAll,t);if(!diag.ready)return[];const out:any[]=[];
  for(const x of diag.touches.long){const s=ladderSignal("LONG",x,diag,"1d");if(s)out.push(s);}return out;
}


function setupIdFor(market:string,symbol:string,direction:string,timeframe:string,ladder:any){
  const entries=(direction==="LONG"?ladder?.below:ladder?.above)||[];
  const targets=(direction==="LONG"?ladder?.above:ladder?.below)||[];
  const e=entries.slice(0,3).map((x:any)=>String(x?.ob?.originTime??x?.origin_time??"")).join("-");
  const t=targets.slice(0,3).map((x:any)=>String(x?.ob?.originTime??x?.origin_time??"")).join("-");
  return [STRATEGY_VERSION,market,symbol,direction,timeframe,e,t].join(":");
}
function publicToLevel(p:any,direction:"LONG"|"SHORT"):LadderLevel{
  const detectorSide=String(p?.detector_side||"")==="bear"?"bear":"bull";
  return{rank:Number(p.rank),point:Number(p.point),side:direction==="LONG"?"below":"above",detectorSide,
    ob:{origin:0,confirm:0,originTime:Number(p.origin_time),confirmTime:Number(p.confirm_time),top:Number(p.zone_top),bottom:Number(p.zone_bottom),avg:Number(p.point)}};
}
function frozenSignals(anchor:any,bar:{h:number;l:number},diag:any){
  const direction=String(anchor.direction)==="SHORT"?"SHORT":"LONG";
  if(String(anchor.status||"")!=="OPEN")return[];
  const snap=anchor?.context?.ladder_snapshot||{},raw=direction==="LONG"?(snap.below||[]):(snap.above||[]);
  const out:any[]=[];
  for(const p of raw){
    const level=publicToLevel(p,direction as "LONG"|"SHORT");
    if(!pointTouched(bar,level))continue;
    out.push({direction,entry:level.point,stop:Number(anchor.stop),tp1:Number(anchor.tp1),tp2:Number(anchor.tp2),tp3:Number(anchor.tp3),
      context:{...(anchor.context||{}),strategy_version:STRATEGY_VERSION,engine:"ANALYZER_CANONICAL_V3_6",
        entry_rank:level.rank,ob_key:String(anchor?.context?.operational_timeframe||"1h")+":"+direction+":"+String(level.ob.originTime),
        order_block:level.ob,entry_level:publicLevel(level),proximity:diag?.proximity||anchor?.context?.proximity,
        context:diag?.context||anchor?.context?.context,macro_context:diag?.macroContext||anchor?.context?.macro_context,
        trend_relation:String(anchor?.context?.operational_timeframe||"1h")==="1d"?regulatedRiskProfile(diag).relation:trendRelation(direction as "LONG"|"SHORT",(diag?.macroContext?.trend||diag?.context?.trend||anchor?.context?.macro_context?.trend||"RANGO")),
        risk_profile:String(anchor?.context?.operational_timeframe||"1h")==="1d"?regulatedRiskProfile(diag).risk:(anchor?.context?.risk_profile||null),
        setup_id:anchor?.context?.setup_id}});
  }
  return out;
}
async function activeSetupSignals(market:string,symbol:string){
  const {data,error}=await sb.from("mtf_signals").select("*").eq("strategy_version",STRATEGY_VERSION).eq("market",market).eq("symbol",symbol)
    .eq("status","OPEN").order("signal_time");
  if(error)throw error;return data||[];
}
async function legacyOperationalSignals(market:string,symbol:string){
  const {data,error}=await sb.from("mtf_signals").select("*").eq("strategy_version",LEGACY_STRATEGY_VERSION).eq("market",market).eq("symbol",symbol)
    .in("source",["FORWARD","MIGRATED_STRICT"]).in("status",["OPEN","TP1","TP2"]).order("signal_time");
  if(error)throw error;return data||[];
}
function seedSetupContext(cur:any,market:string,symbol:string,timeframe:string,diag:any){
  const setupId=setupIdFor(market,symbol,cur.direction,timeframe,diag.ladder);
  return {...cur,context:{...(cur.context||{}),setup_id:setupId,engine:"ANALYZER_CANONICAL_V3_6"}};
}

async function getState(market:string){const{data,error}=await sb.from("mtf_state").select("*").eq("market",market).maybeSingle();if(error)throw error;return data;}
async function setState(market:string,lastProcessed:number,meta:any){const current=await getState(market),merged={...(current?.meta||{}),...meta},{error}=await sb.from("mtf_state").upsert({market,last_processed_at:iso(lastProcessed),last_run_at:new Date().toISOString(),meta:merged,updated_at:new Date().toISOString()});if(error)throw error;}

async function insertSignal(s:SignalInsert){
 const setupId=String((s.context as any)?.setup_id||""),rank=Number((s.context as any)?.entry_rank||0);
 const legacy=await legacyOperationalSignals(String(s.market),String(s.symbol));if(legacy.length)return null;
 const {data:opens,error:openErr}=await sb.from("mtf_signals").select("*")
   .eq("strategy_version",STRATEGY_VERSION).eq("market",s.market).eq("symbol",s.symbol)
   .eq("status","OPEN").order("signal_time");
 if(openErr)throw openErr;
 const sameDir=(opens||[]).filter((x:any)=>x.direction===s.direction),opposite=(opens||[]).filter((x:any)=>x.direction!==s.direction);
 if(opposite.length)return null;
 if(sameDir.length){
   const activeSetup=String(sameDir[0]?.context?.setup_id||"");
   if(!setupId||!activeSetup||setupId!==activeSetup)return null;
   if(sameDir.some((x:any)=>["TP1","TP2"].includes(String(x.status||""))))return null;
   if(rank&&sameDir.some((x:any)=>Number(x?.context?.entry_rank||0)===rank))return null;
   if(sameDir.length>=3)return null;
 }
 const row={...s,strategy_version:STRATEGY_VERSION,context:{...(s.context||{}),strategy_version:STRATEGY_VERSION},status:"OPEN",best_r:0,worst_r:0,hit1:false,hit2:false,hit3:false,updated_at:new Date().toISOString()};
 const {data,error}=await sb.from("mtf_signals").insert(row).select("*").single();
 if(error){if(String((error as any)?.code||"")==="23505")return null;throw error;}
 return data;
}

async function openSignals(market:string){const{data,error}=await sb.from("mtf_signals").select("*").eq("market",market).eq("strategy_version",STRATEGY_VERSION).eq("status","OPEN").order("signal_time");if(error)throw error;return data||[];}
async function updateSignal(s:any){const{error}=await sb.from("mtf_signals").update({status:s.status,best_r:s.best_r,worst_r:s.worst_r,hit1:s.hit1,hit2:s.hit2,hit3:s.hit3,hit1_at:s.hit1_at||null,hit2_at:s.hit2_at||null,hit3_at:s.hit3_at||null,closed_at:s.closed_at||null,updated_at:new Date().toISOString()}).eq("id",s.id);if(error)throw error;}

function trackOne(s:any,bars:Bar[],since:number){
 const R=Math.abs(n(s.entry)-n(s.stop));if(!(R>0))return s;
 let status=s.status,hit1=!!s.hit1,hit2=!!s.hit2,hit3=!!s.hit3,best=n(s.best_r)||0,worst=n(s.worst_r)||0,hit1At=s.hit1_at,hit2At=s.hit2_at,hit3At=s.hit3_at,closed=s.closed_at;
 for(const c of bars.filter(x=>x.t>Math.max(since,new Date(s.signal_time).getTime()))){
  const favorable=s.direction==="LONG"?(c.h-n(s.entry))/R:(n(s.entry)-c.l)/R,adverse=s.direction==="LONG"?(c.l-n(s.entry))/R:(n(s.entry)-c.h)/R;best=Math.max(best,favorable);worst=Math.min(worst,adverse);
  const hardStop=s.direction==="LONG"?c.l<=n(s.stop):c.h>=n(s.stop),t1=s.direction==="LONG"?c.h>=n(s.tp1):c.l<=n(s.tp1),t2=s.direction==="LONG"?c.h>=n(s.tp2):c.l<=n(s.tp2),t3=s.direction==="LONG"?c.h>=n(s.tp3):c.l<=n(s.tp3),newTarget=(!hit1&&t1)||(!hit2&&t2)||(!hit3&&t3);
  if(hardStop&&newTarget){status="AMBIGUOUS";closed=iso(c.t);break;}
  if(t3&&!hit3){hit1=true;hit2=true;hit3=true;hit1At=hit1At||iso(c.t);hit2At=hit2At||iso(c.t);hit3At=iso(c.t);status="TP3";closed=iso(c.t);break;}
  if(t2&&!hit2){hit1=true;hit2=true;hit1At=hit1At||iso(c.t);hit2At=iso(c.t);status="TP2";}else if(t1&&!hit1){hit1=true;hit1At=iso(c.t);status="TP1";}
  if(hardStop){status="SL";closed=iso(c.t);break;}
 }
 return{...s,status,hit1,hit2,hit3,best_r:best,worst_r:worst,hit1_at:hit1At,hit2_at:hit2At,hit3_at:hit3At,closed_at:closed};
}


async function processCrypto(lastMs:number,activatedAt:number){
 const universe=await cryptoUniverse(),universeSet=new Set(universe),errors:any[]=[],created:any[]=[],audit:any[]=[],now=Date.now(),cycleId="crypto:"+iso(now);
 for(const sym of universe){try{
  const pair=sym+"USDT",[h1,h4,d1,m15]=await Promise.all([binanceDetectorHistory(pair,24),binanceKlines(pair,"4h",1000),binanceKlines(pair,"1d",1000),binanceKlines(pair,"15m",1000)]),bundle={h1,h4,d1,m15},candidates=m15.filter(x=>x.t>lastMs&&x.t<=now);
  let active:any[]=await activeSetupSignals("crypto",sym);
  for(const c of candidates){
   if(c.t<activatedAt)continue;
   const diag:any=cryptoDiagnosticAt(bundle,c.t);
   let curs:any[]=[];
   if(active.length){
     const anchor=active[0];
     curs=frozenSignals(anchor,{h:c.h,l:c.l},diag).filter(cur=>!active.some((x:any)=>Number(x?.context?.entry_rank||0)===Number(cur?.context?.entry_rank||0)));
   }else curs=evalCryptoAt(bundle,c.t).map(cur=>seedSetupContext(cur,"crypto",sym,"1h",diag));
   let insertedCount=0;
   const beforeCount=active.length;
   for(const cur of curs){
     const inserted:any=await insertSignal({market:"crypto",symbol:sym,underlying:sym,direction:cur.direction,signal_time:iso(c.t),entry:cur.entry,stop:cur.stop,tp1:cur.tp1,tp2:cur.tp2,tp3:cur.tp3,source:"FORWARD",context:cur.context});
     if(inserted){insertedCount++;active.push(inserted);created.push({sym,dir:cur.direction,rank:cur.context?.entry_rank,setup_id:cur.context?.setup_id,t:c.t,entry:cur.entry,tp1:cur.tp1,tp2:cur.tp2,tp3:cur.tp3});}
   }
   let decision="NO_ENTRY",reason=diag?.proximity?.state==="NEAR"?"near_entry_atr":diag?.proximity?.state==="IN_ZONE"?"entry_zone_active":"waiting_distance_atr";
   if(diag?.ambiguousTrigger)reason="both_sides_touched_same_15m_ambiguous";
   else if(curs.length&&insertedCount){decision="ENTRY";reason=beforeCount?"frozen_setup_next_leg_touched":"new_frozen_setup_started";}
   else if(curs.length&&!insertedCount){decision="BLOCKED_OPEN";reason="frozen_setup_rank_already_used_or_consumed";}
   else if((diag?.touches?.long?.length||0)+(diag?.touches?.short?.length||0)>0&&active.length)reason="current_detector_touch_ignored_while_setup_frozen";
   audit.push(auditRow(cycleId,"crypto",sym,sym,curs[0]?.direction||active[0]?.direction||null,c.t,decision,reason,{diagnostic:diag,engine:"ANALYZER_CANONICAL_V3_6",active_setup:active[0]?.context?.setup_id||null,created:insertedCount}));
  }
  const opens=(await openSignals("crypto")).filter((x:any)=>x.symbol===sym);for(const x of opens){const u=trackOne(x,m15,lastMs);if(u.status!==x.status||u.hit1!==x.hit1||u.hit2!==x.hit2||u.hit3!==x.hit3||u.best_r!==x.best_r||u.worst_r!==x.worst_r)await updateSignal(u);}
 }catch(e){errors.push({symbol:sym,error:String((e as Error).message||e)});}}
 await flushAudit(audit);
 const leftovers=(await openSignals("crypto")).filter((x:any)=>!universeSet.has(x.symbol)),groups=new Map<string,any[]>();for(const x of leftovers){if(!groups.has(x.symbol))groups.set(x.symbol,[]);groups.get(x.symbol)!.push(x);}
 for(const [sym,signals] of groups){try{const bars=await binanceKlines(sym+"USDT","15m",1000);for(const x of signals){const u=trackOne(x,bars,lastMs);if(u.status!==x.status||u.hit1!==x.hit1||u.hit2!==x.hit2||u.hit3!==x.hit3)await updateSignal(u);}}catch(e){errors.push({symbol:sym,tracking:true,error:String((e as Error).message||e)});}}
 return{strategy_version:STRATEGY_VERSION,engine:"ANALYZER_CANONICAL_V3_6",operational_timeframe:"1h",execution_sampling:"15m_high_low_only",entry_rule:"freeze 3 Analyzer entry levels + shared SL + 3 opposite targets when first leg triggers",exit_rule:"setup-level shared targets; new OBs ignored until setup closes",indicators_role:"1h_4h_1d_context_only; proximity=distance/ATR14",universe:universe.length,created:created.length,audit_rows:audit.length,tracked_outside_universe:leftovers.length,errors};
}


async function bymaLiveOpen(){
  try{
    const {data}=await sb.from("mtf_state").select("meta").eq("market","market_guard").maybeSingle();
    return String(data?.meta?.byma?.code||"").toUpperCase()==="OPEN";
  }catch(_){return false;}
}
function regulatedLiveDiagnostic(daily:DailyBar[],livePrice:number,liveBar?:{t?:number;o?:number;h?:number;l?:number;c?:number}){
  if(!daily?.length||daily.length<55)return{ready:false,reason:"insufficient_daily_history_lt55"};
  const bars:Bar[]=daily.map(v=>({t:v.t,o:v.open,h:v.high,l:v.low,c:v.close,v:v.volume}));
  const ladder=detectorLadder(bars,livePrice),context=contextOnly(bars),weeklyBars=weeksFromDaily(daily,daily.at(-1)!.t);
  if(weeklyBars.length<55)return{ready:false,reason:"insufficient_weekly_history_lt55"};
  const weekly=contextOnly(weeklyBars);
  if(!context.ready||!weekly.ready)return{ready:false,reason:"context_not_mature"};
  const macroContext={trend:weekly.trend,d1:context,w1:weekly,dominant_timeframe:"1w"};
  const trigger={t:n(liveBar?.t)||Date.now(),o:n(liveBar?.o)||livePrice,h:n(liveBar?.h)||livePrice,l:n(liveBar?.l)||livePrice,c:n(liveBar?.c)||livePrice,v:0};
  const touches=ladder.below.filter((x:LadderLevel)=>pointTouched(trigger,x));
  const stops={LONG:structuralStop("LONG",ladder,context.atr14)},proximity=proximityFor(ladder,livePrice,context.atr14,true);
  return{ready:true,referencePrice:livePrice,ladder,context,macroContext,stops,proximity,touches:{long:touches},qualifiedDirection:touches.length?"LONG":null,trigger};
}
async function processRegulatedLive(createEntries=true){
  const open=await bymaLiveOpen();
  if(createEntries&&!open)return{strategy_version:STRATEGY_VERSION,skipped:"byma_not_open"};
  const runDate=dateTZ("America/Argentina/Buenos_Aires"),now=Date.now(),created:any[]=[],errors:any[]=[],CHUNK=2;
  const {data:prevRow}=await sb.from("mtf_state").select("meta").eq("market","regulated_live").maybeSingle();
  const prevSnapshot:any[]=prevRow?.meta?.snapshot||[],
        prevMap=new Map<string,any>(prevSnapshot.map((x:any)=>[String(x.market)+":"+String(x.symbol),x]));

  const {data:cedears,error:ceErr}=await sb.from("mtf_cedear_work").select("symbol,underlying,metrics,liquidity_rank")
    .eq("run_date",runDate).eq("eligible_liquid",true).order("liquidity_rank",{ascending:true});
  if(ceErr)throw ceErr;

  // ADR live entries are isolated in mtf-adr-engine (ADR-OB-v1.0).
  // Keep this worker CEDEAR-only to avoid duplicate/competing merval signals.
  const merval:any[]=[];

  const items:any[]=[
    ...(cedears||[]).map((row:any)=>{
      const sym=String(row.symbol),underlying=underlyingFor(sym);
      return{market:"cedear",sym,underlying,extra:{
        liquidity:row.metrics||{},liquidity_rank:row.liquidity_rank,
        universe_rule:"BYMA_BROAD_LIQUID_UNIVERSE",
        origin_market:underlying.toUpperCase().endsWith(".SA")?"B3":"USA"
      }};
    }),
    ...(merval||[]).map((x:any)=>({
      market:"merval",sym:String(x.symbol),underlying:String(x.adr||""),
      extra:{pricing_method:"ADR",source_panel:x.sourcePanel||null,source:"Yahoo Finance USD"}
    }))
  ];
  const {data:carryCandidates,error:carryErr}=await sb.from("mtf_signals").select("market,symbol,underlying,context,strategy_version,status")
    .in("strategy_version",[LEGACY_STRATEGY_VERSION,STRATEGY_VERSION]).in("market",["cedear","merval"]).in("source",["FORWARD","MIGRATED_STRICT"]).in("status",["OPEN","TP1","TP2"]);
  const carryRows=(carryCandidates||[]).filter((x:any)=>String(x.strategy_version)===LEGACY_STRATEGY_VERSION?["OPEN","TP1","TP2"].includes(String(x.status)):String(x.status)==="OPEN");
  if(carryErr)throw carryErr;
  const itemKeys=new Set(items.map((x:any)=>String(x.market)+":"+String(x.sym)));
  for(const row of carryRows||[]){
    const market=String(row.market),sym=String(row.symbol),key=market+":"+sym;
    if(itemKeys.has(key))continue;
    const underlying=String(row.underlying||underlyingFor(sym));
    items.push({market,sym,underlying,extra:{
      carried_open:true,pricing_method:row.context?.pricing_method||null,
      source:"OPEN_POSITION_CARRY",origin_market:underlying.toUpperCase().endsWith(".SA")?"B3":"USA"
    }});
    itemKeys.add(key);
  }
  const total=items.length;
  if(!total)return{strategy_version:STRATEGY_VERSION,skipped:"empty_regulated_universe"};

  let cursor=Math.max(0,Math.floor(n(prevRow?.meta?.cursor)||0));if(cursor>=total)cursor=0;
  const take=Math.min(CHUNK,total),batch:any[]=[];
  for(let i=0;i<take;i++)batch.push(items[(cursor+i)%total]);
  const nextCursor=(cursor+take)%total,wrapped=nextCursor<=cursor&&take<total;

  // Background retry lane: every run retries one unresolved asset in addition to the normal batch.
  const itemMap=new Map(items.map((x:any)=>[x.market+":"+x.sym,x])),
        retryKeys=prevSnapshot.filter((x:any)=>x?.ready===false||x?.state==="NO_ANALYSIS").map((x:any)=>String(x.market)+":"+String(x.symbol)).filter((k:string)=>itemMap.has(k)),
        retryCursor=retryKeys.length?Math.max(0,Math.floor(n(prevRow?.meta?.retry_cursor)||0))%retryKeys.length:0,
        retryKey=retryKeys.length?retryKeys[retryCursor]:null,
        retryItem=retryKey?itemMap.get(retryKey):null;
  if(retryItem&&!batch.some((x:any)=>x.market===retryItem.market&&x.sym===retryItem.sym))batch.push({...retryItem,retry_background:true});
  const nextRetryCursor=retryKeys.length?(retryCursor+1)%retryKeys.length:0;

  const freshTriggers=(live:any,prev:any)=>{
    const bars:any[]=(live?.bars||[]).filter((b:any)=>Number.isFinite(+b.t)&&Number.isFinite(+b.h)&&Number.isFinite(+b.l)&&Number.isFinite(+b.c)).sort((a:any,b:any)=>+a.t-+b.t);
    if(!bars.length)return prev?[]:[{t:live.t,o:live.o,h:live.h,l:live.l,c:live.price}];
    const lastSeen=n(prev?.t);
    const fresh=lastSeen>0?bars.filter((b:any)=>+b.t>lastSeen):[bars.at(-1)];
    return fresh.map((b:any)=>({t:+b.t,o:+b.o,h:+b.h,l:+b.l,c:+b.c}));
  };

  const scanOne=async(item:any)=>{
    const market=item.market as "cedear"|"merval",sym=String(item.sym),underlying=String(item.underlying||""),
          key=market+":"+sym,prev=prevMap.get(key)||null,extra=item.extra||{};
    if(!underlying)return{ok:false,ready:false,market,symbol:sym,underlying,state:"NO_ANALYSIS",reason:"missing_underlying",...extra};
    try{
      const [d,live]=await Promise.all([yahooDaily(underlying),yahooLiveUsd(underlying)]);
      const triggers=freshTriggers(live,prev),
            displayTrigger=triggers.at(-1)||{t:live.t,o:live.price,h:live.price,l:live.price,c:live.price},
            diag:any=regulatedLiveDiagnostic(d,live.price,displayTrigger);
      if(!diag.ready)return{ok:false,ready:false,market,symbol:sym,underlying,state:"NO_ANALYSIS",reason:diag.reason,price:live.price,t:live.t,...extra};

      const below=diag.ladder.below.map(publicLevel),above=diag.ladder.above.map(publicLevel),
            structureReady=below.length===3&&above.length===3,
            legacy:any[]=await legacyOperationalSignals(market,sym);
      let active:any[]=await activeSetupSignals(market,sym),added=0;

      if(!legacy.length)for(const trigger of triggers){
        const stepDiag:any=regulatedLiveDiagnostic(d,trigger.c,trigger);
        if(!stepDiag.ready)continue;
        // Re-read active state before each historical minute so a concurrent watcher close
        // cannot be followed by a late frozen E2/E3 insert.
        active=await activeSetupSignals(market,sym);
        const entryAllowed=regulatedRiskProfile(stepDiag).relation==="A_FAVOR";
        let curs:any[]=[];
        if(entryAllowed&&active.length){
          curs=frozenSignals(active[0],trigger,stepDiag)
            .filter(cur=>!active.some((x:any)=>Number(x?.context?.entry_rank||0)===Number(cur?.context?.entry_rank||0)));
        }else if(entryAllowed&&structureReady&&createEntries&&prev&&prev.actionable===true){
          curs=(stepDiag.touches.long||[]).map((level:any)=>{
            const cur:any=ladderSignal("LONG",level,stepDiag,"1d");
            return cur?seedSetupContext(cur,market,sym,"1d",stepDiag):null;
          }).filter(Boolean);
        }

        for(const cur of curs){
          const inserted:any=await insertSignal({
            market,symbol:sym,underlying,direction:"LONG",signal_time:iso(trigger.t||live.t||now),
            entry:cur.entry,stop:cur.stop,tp1:cur.tp1,tp2:cur.tp2,tp3:cur.tp3,source:"FORWARD",
            context:{...cur.context,live_trigger:true,live_price:trigger.c,live_source:live.source,trigger_bar:trigger,...extra}
          });
          if(inserted){
            active.push(inserted);added++;
            created.push({market,symbol:sym,rank:cur.context?.entry_rank,setup_id:cur.context?.setup_id,entry:cur.entry,live:trigger.c,trigger_time:iso(trigger.t||now)})
          }
        }
      }

      active=await activeSetupSignals(market,sym);
      const operational=legacy.length?legacy:active;
      return{
        ok:true,ready:true,actionable:structureReady&&regulatedRiskProfile(diag).relation==="A_FAVOR"&&!legacy.length,market,symbol:sym,underlying,
        reason:!structureReady?`setup_incomplete_${below.length}x${above.length}`:(regulatedRiskProfile(diag).relation==="A_FAVOR"?null:"context_requires_daily_and_weekly_bullish"),
        price:live.price,t:live.t,name:live.name||prev?.name||"",bar:displayTrigger,fresh_trigger:triggers.length>0,source:live.source,
        state:operational.length?"OPEN":diag.proximity?.state,
        proximity:diag.proximity,
        ladder:{reference_price:live.price,below,above,complete:structureReady,exact_analyzer:true},
        context:diag.context,macroContext:diag.macroContext,stops:diag.stops,
        entry_allowed:regulatedRiskProfile(diag).relation==="A_FAVOR",risk_profile:regulatedRiskProfile(diag),stop_policy:"NONE",exit_policy:"TP1_ONLY_NO_SL",
        open_count:operational.length,setup_id:operational[0]?.context?.setup_id||null,direction:operational[0]?.direction||null,
        active_strategy_version:operational[0]?.strategy_version||null,legacy_active:legacy.length>0,
        created:added,...extra
      };
    }catch(e){
      const msg=String((e as Error).message||e);errors.push({market,symbol:sym,error:msg});
      return{ok:false,ready:false,market,symbol:sym,underlying,name:prev?.name||"",state:"NO_ANALYSIS",reason:msg,retry_count:n(prev?.retry_count)+1,last_retry_at:iso(now),...extra};
    }
  };

  const results=await pool(batch,1,scanOne);
  const universeKeys=new Set(items.map((x:any)=>x.market+":"+x.sym)),
        merged=new Map<string,any>();
  for(const x of prevSnapshot){
    const k=String(x.market)+":"+String(x.symbol);
    if(universeKeys.has(k))merged.set(k,x);
  }
  for(const x of results||[])merged.set(String(x.market)+":"+String(x.symbol),x);

  const liveSnapshot=[...merged.values()];
  await sb.from("mtf_state").upsert({
    market:"regulated_live",last_processed_at:iso(now),last_run_at:iso(now),
    meta:{
      strategy_version:STRATEGY_VERSION,engine:"ANALYZER_CANONICAL_V3_6",
      generated_at:iso(now),baseline:!createEntries,snapshot:liveSnapshot,
      cursor:nextCursor,retry_cursor:nextRetryCursor,chunk_size:CHUNK,universe_size:total,
      scanned_this_run:batch.length,full_cycle_completed:wrapped,
      retry_queue:retryKeys.length,retried_symbol:retryItem?.sym||null,
      coverage_pct:total>0?Math.min(100,liveSnapshot.length/total*100):0
    },
    updated_at:iso(now)
  },{onConflict:"market"});

  return{
    strategy_version:STRATEGY_VERSION,engine:"ANALYZER_CANONICAL_V3_6",
    mode:"regulated_live_chunked",baseline:!createEntries,run_date:runDate,
    universe:total,scanned_this_run:batch.length,cursor,next_cursor:nextCursor,
    retry_queue:retryKeys.length,retried_symbol:retryItem?.sym||null,
    snapshot_size:liveSnapshot.length,coverage_pct:total>0?liveSnapshot.length/total*100:0,
    created:created.length,created_signals:created,errors
  };
}

async function processCedears(lastMs:number,activatedAt:number,prepareOnly=false){
  const runDate=dateTZ("America/Argentina/Buenos_Aires"),now=Date.now(),total=await ensureCedearWork(runDate),audit:any[]=[],cycleId="cedear:"+iso(now);

  const {data:metricBatch,error:metricErr}=await sb.from("mtf_cedear_work")
    .select("*").eq("run_date",runDate).eq("metrics_done",false).order("symbol").limit(250);
  if(metricErr)throw metricErr;
  if(metricBatch?.length){
    const results=await pool(metricBatch,20,async(row:any)=>{
      try{
        const metrics=panelFastMetrics(row.raw||{});
        const {error}=await sb.from("mtf_cedear_work").update({
          metrics,metrics_done:true,attempts:0,last_error:null,updated_at:new Date().toISOString()
        }).eq("run_date",runDate).eq("symbol",row.symbol);
        if(error)throw error;
        return{ok:true,symbol:row.symbol};
      }catch(e){
        await sb.from("mtf_cedear_work").update({
          attempts:Number(row.attempts||0)+1,metrics_done:true,last_error:String((e as Error).message||e).slice(0,800),updated_at:new Date().toISOString()
        }).eq("run_date",runDate).eq("symbol",row.symbol);
        return{ok:false,symbol:row.symbol,error:String((e as Error).message||e)};
      }
    });
    const {count:pendingMetrics}=await sb.from("mtf_cedear_work").select("symbol",{count:"exact",head:true}).eq("run_date",runDate).eq("metrics_done",false);
    return{strategy_version:STRATEGY_VERSION,in_progress:true,phase:"metrics",liquidity_basis:"BYMA_CURRENT_TURNOVER",run_date:runDate,total,processed:metricBatch.length,pending:pendingMetrics||0,errors:(results||[]).filter((x:any)=>x&&x.ok===false).length};
  }

  const {data:metricRows,error:allMetricErr}=await sb.from("mtf_cedear_work").select("symbol,underlying,metrics").eq("run_date",runDate).eq("metrics_done",true).not("metrics","is",null);
  if(allMetricErr)throw allMetricErr;
  let liquid=selectLiquidUniverse((metricRows||[]).map((r:any)=>({symbol:r.symbol,underlying:r.underlying,liquidity:r.metrics}))),
      liquidityBasis="BYMA_CURRENT_TURNOVER";
  if(!liquid.length&&(metricRows||[]).length){
    const {data:lastValid}=await sb.from("mtf_cedear_work").select("run_date").lt("run_date",runDate).eq("eligible_liquid",true)
      .order("run_date",{ascending:false}).limit(1).maybeSingle();
    if(lastValid?.run_date){
      const {data:prevRows,error:prevErr}=await sb.from("mtf_cedear_work")
        .select("symbol,underlying,liquidity_rank,metrics").eq("run_date",lastValid.run_date).eq("eligible_liquid",true)
        .order("liquidity_rank",{ascending:true});
      if(prevErr)throw prevErr;
      liquid=(prevRows||[]).map((r:any)=>({
        symbol:r.symbol,underlying:r.underlying||underlyingFor(r.symbol),liquidity:r.metrics||{},
        eligible_liquid:true,liquidity_rank:r.liquidity_rank,
        liquidity_rule:"FALLBACK_LAST_VALID_BYMA_UNIVERSE",fallback_run_date:lastValid.run_date
      }));
      if(liquid.length)liquidityBasis="BYMA_LAST_VALID_UNIVERSE_FALLBACK";
    }
  }
  await sb.from("mtf_cedear_work").update({eligible_liquid:false,liquidity_rank:null,tier:null,score:null,coverage_pct:null,updated_at:new Date().toISOString()}).eq("run_date",runDate);
  if(liquid.length){
    const patch=liquid.map((x:any)=>({run_date:runDate,symbol:x.symbol,underlying:underlyingFor(x.symbol),eligible_liquid:true,liquidity_rank:x.liquidity_rank,tier:null,score:null,coverage_pct:null,updated_at:new Date().toISOString()}));
    const {error}=await sb.from("mtf_cedear_work").upsert(patch,{onConflict:"run_date,symbol"});if(error)throw error;
  }

  if(prepareOnly){
    return{strategy_version:STRATEGY_VERSION,prepare:true,complete:true,phase:"ready",liquidity_basis:liquidityBasis,run_date:runDate,total,liquid_universe:liquid.length,pending:0};
  }

  const {data:signalBatch,error:signalErr}=await sb.from("mtf_cedear_work")
    .select("*").eq("run_date",runDate).eq("eligible_liquid",true).eq("signal_done",false).order("liquidity_rank",{ascending:true}).limit(100);
  if(signalErr)throw signalErr;
  if(signalBatch?.length){
    const sessionDates=await bymaSessionDateSet();
    let created=0;
    const results=await pool(signalBatch,4,async(row:any)=>{
      const sym=String(row.symbol),underlying=underlyingFor(sym);
      try{
        const d=await yahooDaily(underlying);
        if(!seriesReadyToday(d,underlying)){
          const attempts=Number(row.attempts||0)+1,finalNoSession=attempts>=5;
          await sb.from("mtf_cedear_work").update({
            attempts,signal_done:finalNoSession,
            last_error:(finalNoSession?"origin_no_daily_session:":"daily_not_ready:")+String(d.at(-1)?.t||""),
            updated_at:new Date().toISOString()
          }).eq("run_date",runDate).eq("symbol",sym);
          return{ok:finalNoSession,symbol:sym,notReady:!finalNoSession,noSession:finalNoSession};
        }
        const candidates=d.filter(b=>b.t>lastMs&&b.t<=now&&sessionDates.has(underlying.toUpperCase().endsWith(".SA")?dayKey(b.t):usDayKey(b.t)));
        for(const c of candidates){
          const idx=d.findIndex(b=>b.t===c.t),prev=d[idx-1];if(!prev)continue;
          const curs:any[]=evalCedearAt(d,c.t),diag:any=cedearDiagnosticAt(d,c.t);
          let insertedCount=0,decision="NO_ENTRY",reason=diag?.proximity?.state==="NEAR"?"near_entry_atr":diag?.proximity?.state==="IN_ZONE"?"entry_zone_active":"waiting_distance_atr";
          for(const cur of curs){
            const source=c.t>=activatedAt?"FORWARD":"BASELINE";
            const inserted=await insertSignal({market:"cedear",symbol:sym,underlying,direction:"LONG",signal_time:iso(c.t),entry:cur.entry,stop:cur.stop,tp1:cur.tp1,tp2:cur.tp2,tp3:cur.tp3,source,context:{...cur.context,liquidity:row.metrics||{},liquidity_rank:row.liquidity_rank,universe_rule:"BYMA_BROAD_LIQUID_UNIVERSE",origin_market:underlying.toUpperCase().endsWith(".SA")?"B3":"USA"}});
            if(inserted){insertedCount++;created++;}
          }
          if(curs.length&&insertedCount){decision="ENTRY";reason="daily_bullish_ob_buy_level_touched";}else if(curs.length){decision="BLOCKED_OPEN";reason="level_already_used_or_three_long_legs_open";}else if((diag?.touches?.long?.length||0)>0)reason="daily_bullish_ob_touched_but_3_bearish_exit_points_not_available";
          if(c.t>=activatedAt)audit.push(auditRow(cycleId,"cedear",sym,underlying,curs[0]?.direction||diag?.qualifiedDirection||null,c.t,decision,reason,{diagnostic:diag,liquidityRank:row.liquidity_rank,adtv20:n(row.metrics?.adtv20),persistence:n(row.metrics?.persistence),spreadPct:n(row.metrics?.spreadPct),universeRule:"BYMA_BROAD_LIQUID_UNIVERSE",originMarket:underlying.toUpperCase().endsWith(".SA")?"B3":"USA",created:insertedCount}));
        }
        const opens=(await openSignals("cedear")).filter((s:any)=>s.symbol===sym),bars:Bar[]=d.map(v=>({t:v.t,o:v.open,h:v.high,l:v.low,c:v.close,v:v.volume}));
        for(const s of opens){const u=trackOne(s,bars,lastMs);if(u.status!==s.status||u.best_r!==s.best_r||u.worst_r!==s.worst_r||u.hit1!==s.hit1||u.hit2!==s.hit2||u.hit3!==s.hit3)await updateSignal(u);}
        const {error}=await sb.from("mtf_cedear_work").update({signal_done:true,attempts:0,last_error:null,updated_at:new Date().toISOString()}).eq("run_date",runDate).eq("symbol",sym);
        if(error)throw error;
        return{ok:true,symbol:sym};
      }catch(e){
        const attempts=Number(row.attempts||0)+1;
        await sb.from("mtf_cedear_work").update({
          attempts,signal_done:attempts>=3,last_error:String((e as Error).message||e).slice(0,800),updated_at:new Date().toISOString()
        }).eq("run_date",runDate).eq("symbol",sym);
        return{ok:false,symbol:sym,error:String((e as Error).message||e)};
      }
    });
    await flushAudit(audit);
    return{strategy_version:STRATEGY_VERSION,in_progress:true,phase:"signals",run_date:runDate,total,liquid_universe:liquid.length,processed:signalBatch.length,created,audit_rows:audit.length,errors:(results||[]).filter((x:any)=>x&&x.ok===false).length};
  }

  const {data:finalRows,error:finalErr}=await sb.from("mtf_cedear_work").select("symbol,eligible_liquid,liquidity_rank,metrics,signal_done,last_error").eq("run_date",runDate);
  if(finalErr)throw finalErr;
  const universe=(finalRows||[]).filter((x:any)=>x.eligible_liquid===true).sort((a:any,b:any)=>n(a.liquidity_rank)-n(b.liquidity_rank)),universeSet=new Set(universe.map((x:any)=>x.symbol));
  const leftovers=(await openSignals("cedear")).filter((s:any)=>!universeSet.has(s.symbol));
  const groups=new Map<string,any[]>();for(const s of leftovers){if(!groups.has(s.symbol))groups.set(s.symbol,[]);groups.get(s.symbol)!.push(s);}
  const trackingErrors:any[]=[];
  for(const [sym,signals] of groups){
    try{
      const underlying=String(signals[0]?.underlying||sym),d=await yahooDaily(underlying),bars:Bar[]=d.map(v=>({t:v.t,o:v.open,h:v.high,l:v.low,c:v.close,v:v.volume}));
      for(const s of signals){const u=trackOne(s,bars,lastMs);if(u.status!==s.status||u.best_r!==s.best_r||u.worst_r!==s.worst_r||u.hit1!==s.hit1||u.hit2!==s.hit2||u.hit3!==s.hit3)await updateSignal(u);}
    }catch(e){trackingErrors.push({symbol:sym,error:String((e as Error).message||e)});}
  }
  await sb.from("mtf_cedear_work").delete().lt("run_date",runDate);
  return{
    strategy_version:STRATEGY_VERSION,complete:true,run_date:runDate,universe:universe.length,
    universe_rule:"BYMA_BROAD_LIQUID_UNIVERSE",
    tracked_outside_universe:leftovers.length,
    work_errors:(finalRows||[]).filter((x:any)=>x.last_error).length,
    errors:trackingErrors
  };
}
async function processMerval(lastMs:number,activatedAt:number){
 const universe=await mervalUniverse(),universeSet=new Set(universe.map((x:any)=>x.symbol)),sessionDates=await bymaSessionDateSet(),errors:any[]=[],created:any[]=[],audit:any[]=[],now=Date.now(),cycleId="merval:"+iso(now);
 for(const x of universe){const sym=x.symbol;try{
  const series=await mervalSeries(x),d=series.daily,candidates=d.filter(b=>b.t>lastMs&&b.t<=now&&sessionDates.has(series.method==="ADR"?usDayKey(b.t):dayKey(b.t)));
  for(const c of candidates){const idx=d.findIndex(b=>b.t===c.t),prev=d[idx-1];if(!prev)continue;
   const curs:any[]=evalCedearAt(d,c.t),diag:any=cedearDiagnosticAt(d,c.t);let insertedCount=0,decision="NO_ENTRY",reason=diag?.proximity?.state==="NEAR"?"near_entry_atr":diag?.proximity?.state==="IN_ZONE"?"entry_zone_active":"waiting_distance_atr";
   for(const cur of curs){const source=c.t>=activatedAt?"FORWARD":"BASELINE";const inserted=await insertSignal({market:"merval",symbol:sym,underlying:series.underlying,direction:"LONG",signal_time:iso(c.t),entry:cur.entry,stop:cur.stop,tp1:cur.tp1,tp2:cur.tp2,tp3:cur.tp3,source,context:{...cur.context,pricing_method:series.method,source_panel:x.sourcePanel,source:series.source}});if(inserted){insertedCount++;created.push({sym,t:c.t,method:series.method,rank:cur.context?.entry_rank});}}
   if(curs.length&&insertedCount){decision="ENTRY";reason="daily_bullish_ob_buy_level_touched";}else if(curs.length){decision="BLOCKED_OPEN";reason="level_already_used_or_three_long_legs_open";}else if((diag?.touches?.long?.length||0)>0)reason="daily_bullish_ob_touched_but_3_bearish_exit_points_not_available";
   if(c.t>=activatedAt)audit.push(auditRow(cycleId,"merval",sym,series.underlying||sym,curs[0]?.direction||diag?.qualifiedDirection||null,c.t,decision,reason,{diagnostic:diag,pricingMethod:series.method,source:series.source,sourcePanel:x.sourcePanel,created:insertedCount}));
  }
  const opens=(await openSignals("merval")).filter((s:any)=>s.symbol===sym),bars:Bar[]=d.map(v=>({t:v.t,o:v.open,h:v.high,l:v.low,c:v.close,v:v.volume}));for(const s of opens){const u=trackOne(s,bars,lastMs);if(u.status!==s.status||u.best_r!==s.best_r||u.worst_r!==s.worst_r||u.hit1!==s.hit1||u.hit2!==s.hit2||u.hit3!==s.hit3)await updateSignal(u);}
 }catch(e){errors.push({symbol:sym,error:String((e as Error).message||e)});}}
 await flushAudit(audit);
 const leftovers=(await openSignals("merval")).filter((s:any)=>!universeSet.has(s.symbol)),groups=new Map<string,any[]>();for(const s of leftovers){if(!groups.has(s.symbol))groups.set(s.symbol,[]);groups.get(s.symbol)!.push(s);}
 for(const [sym,signals] of groups){try{const first=signals[0],underlying=String(first?.underlying||"");if(!underlying)throw new Error("Posición ADR sin underlying USD");const daily=await yahooDaily(underlying),bars:Bar[]=daily.map((v:any)=>({t:v.t,o:v.open,h:v.high,l:v.low,c:v.close,v:v.volume}));for(const s of signals){const u=trackOne(s,bars,lastMs);if(u.status!==s.status||u.best_r!==s.best_r||u.worst_r!==s.worst_r||u.hit1!==s.hit1||u.hit2!==s.hit2||u.hit3!==s.hit3)await updateSignal(u);}}catch(e){errors.push({symbol:sym,tracking:true,error:String((e as Error).message||e)});}}
 return{strategy_version:STRATEGY_VERSION,engine:"ANALYZER_CANONICAL_V3_6",operational_timeframe:"1d",dominant_context_timeframe:"1w",universe:universe.length,adr:universe.length,created:created.length,audit_rows:audit.length,tracked_outside_universe:leftovers.length,snapshot:universe.map((x:any)=>({symbol:x.symbol,name:x.name||x.symbol,sourcePanel:x.sourcePanel||null,favorite:!!x.favorite,adr:x.adr||null,method:"ADR",series:x.adr,currentVolumeAmount:n(x.currentVolumeAmount)||0})),errors};
}
function nyDailyReady(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const p:any={};for(const x of parts)p[x.type]=x.value;
  if(["Sat","Sun"].includes(p.weekday))return false;
  const mins=Number(p.hour)*60+Number(p.minute);
  return mins>=16*60+5;
}

Deno.serve(async(req:Request)=>{
 if(req.headers.get("authorization")!==`Bearer ${SERVICE_ROLE}`){
  return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
 }
 try{
  const body=await req.json().catch(()=>({})),market=String(body.market||new URL(req.url).searchParams.get("market")||"crypto").toLowerCase(),bootstrap=body.bootstrap===true,prepare=body.prepare===true,liveScan=body.live_scan===true,regulatedBaseline=body.regulated_baseline===true,initialScan=body.initial_scan===true;
  if(!["crypto","cedear","merval"].includes(market))return new Response(JSON.stringify({error:"market inválido"}),{status:400,headers:{"content-type":"application/json"}});
  if(market==="crypto")return new Response(JSON.stringify({ok:false,market,retired:true,reason:"legacy_crypto_engine_retired_in_v3.5_use_mtf-crypto-engine"}),{status:410,headers:{"content-type":"application/json"}});
  if(bootstrap&&market==="cedear"){
    const result=await bootstrapCedearUniverse();
    return new Response(JSON.stringify({ok:true,market,...result}),{headers:{"content-type":"application/json"}});
  }
  if(prepare&&market==="cedear"){
    const result=await processCedears(0,Date.now(),true);
    return new Response(JSON.stringify({ok:true,market,...result}),{headers:{"content-type":"application/json"}});
  }
  if(initialScan&&market==="cedear"){
    return new Response(JSON.stringify({ok:true,market,retired:true,reason:"initial_scan_disabled_for_order_block_strategy"}),{headers:{"content-type":"application/json"}});
  }
  if((liveScan||regulatedBaseline)&&market==="cedear"){
    const result=await processRegulatedLive(!regulatedBaseline);
    return new Response(JSON.stringify({ok:true,market:"regulated",...result}),{headers:{"content-type":"application/json"}});
  }
  if(market==="cedear"||market==="merval"){
    return new Response(JSON.stringify({ok:true,market,retired:true,reason:"daily_signal_generation_retired_in_v3.5_use_live_scanner"}),{headers:{"content-type":"application/json"}});
  }
  let state=await getState(market);const now=Date.now();
  if(!state){const activation=now,last=now-86400000;await setState(market,last,{activated_at:iso(activation),bootstrap:true});state=await getState(market);}
  const lastMs=state?.last_processed_at?new Date(state.last_processed_at).getTime():now-86400000,activatedAt=state?.meta?.activated_at?new Date(state.meta.activated_at).getTime():now;
  if(market!=="crypto"){const guard=await dailyMarketGuard(market);if(!guard.ok)return new Response(JSON.stringify({ok:true,market,skipped:guard.reason,guard}),{headers:{"content-type":"application/json"}});}
  const minGap=market==="crypto"?12*60*1000:20*3600000;
  if(state?.last_run_at&&now-new Date(state.last_run_at).getTime()<minGap)return new Response(JSON.stringify({ok:true,market,skipped:"recently_run",last_run_at:state.last_run_at}),{headers:{"content-type":"application/json"}});
  const result=market==="crypto"?await processCrypto(lastMs,activatedAt):market==="merval"?await processMerval(lastMs,activatedAt):await processCedears(lastMs,activatedAt);
  if(market==="cedear"&&result?.in_progress){
    return new Response(JSON.stringify({ok:true,market,from:iso(lastMs),to:iso(now),...result}),{headers:{"content-type":"application/json"}});
  }
  await setState(market,now,{activated_at:state?.meta?.activated_at||iso(activatedAt),strategy_version:STRATEGY_VERSION,last_result:result});
  return new Response(JSON.stringify({ok:true,market,from:iso(lastMs),to:iso(now),...result}),{headers:{"content-type":"application/json"}});
 }catch(e){
  console.error(e);
  return new Response(JSON.stringify({ok:false,error:String((e as Error).message||e)}),{status:500,headers:{"content-type":"application/json"}});
 }
});