import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const VERSION="OB-LADDER-v3.7.3";
const LEGACY_VERSION="OB-LADDER-v3.7.2";
const ENGINE="MTF_OB_TREND_RESTORED_V3_7_3";
const MIN_RR=1.8;
const ATR_STOP_BUFFER=.30;
const STABLES=new Set(["USDT","USDC","DAI","FDUSD","TUSD","USDE","PYUSD","USDS","FRAX","USD1","USDD"]);
const FALLBACK=["BTC","ETH","BNB","XRP","SOL","DOGE","ADA","TRX","AVAX","LINK","SUI","XLM","HBAR","BCH","LTC","DOT","UNI","AAVE","NEAR","APT"];
const HOUR=3600000;

type Bar={t:number;o:number;h:number;l:number;c:number;v:number;closeTime?:number};
type OB={origin:number;confirm:number;originTime:number;confirmTime:number;top:number;bottom:number;avg:number};
type DetectorState={os:number;bulls:OB[];bears:OB[];tail:Bar[];processed:number;lastOpen:number|null;lastEval?:any};
type Level={rank:number;point:number;side:"below"|"above";detectorSide:"bull"|"bear";ob:OB};

const n=(v:any)=>Number(v);
const iso=(ms=Date.now())=>new Date(ms).toISOString();
function clone<T>(x:T):T{return JSON.parse(JSON.stringify(x))}
async function fetchJson(url:string,init:any={},timeout=20000){
  const c=new AbortController(),tm=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{...init,signal:c.signal});const tx=await r.text();let j:any=null;try{j=tx?JSON.parse(tx):null}catch{}if(!r.ok)throw new Error("HTTP "+r.status+" "+tx.slice(0,240));return j}
  finally{clearTimeout(tm)}
}
async function binance(path:string){
  let last:any;
  for(const host of ["https://api.binance.com","https://data-api.binance.vision"]){
    try{return await fetchJson(host+path,{},25000)}catch(e){last=e}
  }
  throw last||new Error("Binance unavailable");
}
function rowBar(x:any[]):Bar{return{t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],closeTime:+x[6]}}
async function klines(pair:string,interval:string,limit=1000,startTime?:number,endTime?:number){
  let p="/api/v3/klines?symbol="+pair+"&interval="+interval+"&limit="+limit;
  if(startTime!=null)p+="&startTime="+Math.floor(startTime);
  if(endTime!=null)p+="&endTime="+Math.floor(endTime);
  const a=await binance(p);return (a||[]).map(rowBar);
}
async function currentPrices(){
  const a=await binance("/api/v3/ticker/price"),m=new Map<string,number>();
  for(const x of a||[]){const p=n(x.price);if(p>0)m.set(String(x.symbol),p)}
  return m;
}
async function hasMatureContext(sym:string){
  const pair=sym+"USDT";
  try{
    const now=Date.now(),d1=await klines(pair,"1d",211),closed=d1.filter(x=>(x.closeTime||0)<now);
    return closed.length>=210;
  }catch{return false}
}
async function universe(){
  let eligible=new Set<string>();
  try{const j=await binance("/api/v3/exchangeInfo");for(const x of j?.symbols||[])if(x?.status==="TRADING"&&x?.quoteAsset==="USDT"&&x?.isSpotTradingAllowed!==false)eligible.add(String(x.symbol).toUpperCase())}catch{}
  const candidates:string[]=[];
  try{
    const j=await fetchJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false",{},15000);
    for(const x of j||[]){const s=String(x.symbol||"").toUpperCase(),p=s+"USDT";if(!s||STABLES.has(s)||candidates.includes(s)||!eligible.has(p))continue;candidates.push(s);if(candidates.length===60)break}
  }catch{}
  for(const s of FALLBACK)if(!candidates.includes(s)&&eligible.has(s+"USDT"))candidates.push(s);
  if(candidates.length<60)for(const p of eligible){const s=p.endsWith("USDT")?p.slice(0,-4):"";if(s&&!STABLES.has(s)&&!candidates.includes(s))candidates.push(s);if(candidates.length===60)break}
  const out:string[]=[];
  for(let i=0;i<candidates.length&&out.length<20;i+=8){
    const batch=candidates.slice(i,i+8),mature=await Promise.all(batch.map(async s=>({s,ok:await hasMatureContext(s)})));
    for(const x of mature){if(x.ok)out.push(x.s);if(out.length===20)break}
  }
  return out.slice(0,20);
}

function emptyState():DetectorState{return{os:0,bulls:[],bears:[],tail:[],processed:0,lastOpen:null}}
function mitigate(arr:OB[],target:number,bull:boolean){for(let i=arr.length-1;i>=0;i--)if(bull?target<arr[i].bottom:target>arr[i].top)arr.splice(i,1)}
function step(st:DetectorState,b:Bar){
  const w=[...(st.tail||[]),b],i=st.processed;
  if(i>=5&&w.length>=6){
    const p=w.length-6,rs=w.length-5,tail5=w.slice(rs),up=Math.max(...tail5.map(x=>x.h)),lo=Math.min(...tail5.map(x=>x.l)),c=w[p];
    if(c.h>up)st.os=0;else if(c.l<lo)st.os=1;
    if(i>=10&&w.length>=11){
      const pivotWin=w.slice(-11),center=pivotWin[5],pv=center.v,pivot=pivotWin.every((x,j)=>j===5||pv>x.v);
      if(pivot){
        const half=(center.h+center.l)/2,origin=i-5;
        if(st.os===1){const bottom=center.l,top=half;st.bulls.unshift({origin,confirm:i,originTime:center.t,confirmTime:b.t,top,bottom,avg:(top+bottom)/2})}
        else{const top=center.h,bottom=half;st.bears.unshift({origin,confirm:i,originTime:center.t,confirmTime:b.t,top,bottom,avg:(top+bottom)/2})}
      }
    }
    mitigate(st.bulls,lo,true);mitigate(st.bears,up,false);
  }
  st.tail=w.slice(-10);st.processed=i+1;st.lastOpen=b.t;return st;
}
function ladderFromState(st:DetectorState,price:number){
  const bulls=(st.bulls||[])
    .filter(ob=>n(ob.avg)<price)
    .sort((a,b)=>b.avg-a.avg)
    .slice(0,3)
    .map((ob,i)=>({rank:i+1,point:ob.avg,side:"below" as const,detectorSide:"bull" as const,ob}));
  const bears=(st.bears||[])
    .filter(ob=>n(ob.avg)>price)
    .sort((a,b)=>a.avg-b.avg)
    .slice(0,3)
    .map((ob,i)=>({rank:i+1,point:ob.avg,side:"above" as const,detectorSide:"bear" as const,ob}));
  return{referencePrice:price,below:bulls,above:bears,complete:bulls.length===3&&bears.length===3};
}
function publicLevel(x:Level){return{rank:x.rank,point:x.point,side:x.side,detector_side:x.detectorSide,origin_time:x.ob.originTime,confirm_time:x.ob.confirmTime,zone_bottom:x.ob.bottom,zone_top:x.ob.top}}
function captureEvalReference(st:DetectorState,b:Bar){
  const pre=ladderFromState(st,b.o);
  st.lastEval={
    strategyVersion:VERSION,
    barOpen:b.t,
    barClose:n(b.closeTime)||b.t+HOUR,
    ladder:{reference_price:b.o,below:pre.below.map(publicLevel),above:pre.above.map(publicLevel)},
    complete:pre.complete
  };
}
async function rebuild(sym:string){
  const pair=sym+"USDT",st=emptyState();let start=0,pages=0,last=-1;
  while(pages<160){
    const rows=await klines(pair,"1h",1000,start);if(!rows.length)break;
    const now=Date.now(),closed=rows.filter(x=>(x.closeTime||0)<now);
    for(const b of closed){if(st.lastOpen!=null&&b.t<=st.lastOpen)continue;captureEvalReference(st,b);step(st,b)}
    pages++;
    const maxOpen=Math.max(...rows.map(x=>x.t));
    if(maxOpen<=last)break;last=maxOpen;start=maxOpen+HOUR;
    if(rows.length<1000||maxOpen+HOUR>Date.now())break;
  }
  if(!st.processed)throw new Error("No history "+sym);
  const nowIso=iso();
  const {error}=await sb.from("mtf_analyzer_state").upsert({market:"crypto",symbol:sym,timeframe:"1h",state:st,initialized_at:nowIso,updated_at:nowIso},{onConflict:"market,symbol,timeframe"});
  if(error)throw error;
  return{symbol:sym,pages,processed:st.processed,bulls:st.bulls.length,bears:st.bears.length,lastOpen:st.lastOpen};
}
async function loadState(sym:string){
  const {data,error}=await sb.from("mtf_analyzer_state").select("*").eq("market","crypto").eq("symbol",sym).eq("timeframe","1h").maybeSingle();
  if(error)throw error;return data||null;
}
async function catchup(sym:string,row:any){
  const st:DetectorState=clone(row.state||emptyState()),pair=sym+"USDT";let start=(st.lastOpen??0)+HOUR,pages=0;
  while(start<Date.now()&&pages<8){
    const rows=await klines(pair,"1h",1000,start),closed=rows.filter(x=>(x.closeTime||0)<Date.now());
    let advanced=false;for(const b of closed){if(st.lastOpen!=null&&b.t<=st.lastOpen)continue;captureEvalReference(st,b);step(st,b);advanced=true}
    pages++;if(!rows.length||rows.length<1000||!advanced)break;start=(st.lastOpen??start)+HOUR;
  }
  if(JSON.stringify(st)!==JSON.stringify(row.state)){
    const {error}=await sb.from("mtf_analyzer_state").update({state:st,updated_at:iso()}).eq("market","crypto").eq("symbol",sym).eq("timeframe","1h");if(error)throw error;
  }
  return st;
}
function ema(vals:number[],period:number){const out:number[]=[],k=2/(period+1);let e:number|null=null;for(const v of vals){e=e==null?v:v*k+e*(1-k);out.push(e)}return out}
function rsi(vals:number[],period=14){
  if(vals.length<=period)return NaN;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=vals[i]-vals[i-1];if(d>=0)gain+=d;else loss-=d}
  gain/=period;loss/=period;
  let value=loss===0?100:100-100/(1+gain/loss);
  for(let i=period+1;i<vals.length;i++){
    const d=vals[i]-vals[i-1];gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;
    value=loss===0?100:100-100/(1+gain/loss);
  }
  return value;
}
function marketStructure(b:Bar[]){
  if(b.length<45)return"RANGO";
  const curr=b.slice(-20),prev=b.slice(-40,-20);
  const ch=Math.max(...curr.map(x=>x.h)),cl=Math.min(...curr.map(x=>x.l)),ph=Math.max(...prev.map(x=>x.h)),pl=Math.min(...prev.map(x=>x.l));
  if(ch>ph&&cl>pl)return"ALCISTA";
  if(ch<ph&&cl<pl)return"BAJISTA";
  return"RANGO";
}
function context(b:Bar[]){
  if(b.length<210)return{ready:false,trend:"RANGO",structure:"RANGO"};
  const c=b.map(x=>x.c),e10=ema(c,10),e55=ema(c,55),e200=ema(c,200),fast=ema(c,12),slow=ema(c,26),mac=c.map((_,i)=>fast[i]-slow[i]),sig=ema(mac,9),i=c.length-1;
  const a10=e10[i],a55=e55[i],a200=e200[i],ml=mac[i],ms=sig[i],mh=ml-ms,prevHist=i>0?mac[i-1]-sig[i-1]:mh,s55=i>=3?a55-e55[i-3]:0;
  const lr=[c[i]>a10,a10>a55,c[i]>a55,c[i]>a200,ml>ms,mh>=0,s55>0],sr=[c[i]<a10,a10<a55,c[i]<a55,c[i]<a200,ml<ms,mh<=0,s55<0];
  const longScore=lr.filter(Boolean).length,shortScore=sr.filter(Boolean).length,trend=longScore-shortScore>=3?"ALCISTA":longScore-shortScore<=-3?"BAJISTA":"RANGO";
  const tr=b.map((x,j)=>j?Math.max(x.h-x.l,Math.abs(x.h-b[j-1].c),Math.abs(x.l-b[j-1].c)):x.h-x.l);let atr=tr.slice(0,14).reduce((a,z)=>a+z,0)/14;for(let j=14;j<tr.length;j++)atr=(atr*13+tr[j])/14;
  const priorVols=b.slice(-21,-1).map(x=>x.v),vavg=priorVols.reduce((a,z)=>a+z,0)/Math.max(1,priorVols.length),r=rsi(c,14),structure=marketStructure(b);
  return{ready:true,trend,structure,close:c[i],ema10:a10,ema55:a55,ema200:a200,macd:ml,signal:ms,histogram:mh,histogramPrev:prevHist,histogramImproving:mh>prevHist,ema55Slope:s55,rsi14:r,volumeRatio:vavg>0?b[i].v/vavg:NaN,atr14:atr,longScore,shortScore};
}
function proximity(ladder:any,price:number,atr:number,regulated=false){
  const a:any[]=[];for(const x of ladder?.below||[])a.push({direction:"LONG",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distanceAtr:atr>0?Math.abs(price-x.point)/atr:NaN,in_zone:price>=x.ob.bottom&&price<=x.ob.top});
  if(!regulated)for(const x of ladder?.above||[])a.push({direction:"SHORT",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distanceAtr:atr>0?Math.abs(price-x.point)/atr:NaN,in_zone:price>=x.ob.bottom&&price<=x.ob.top});
  a.sort((x,y)=>x.distance-y.distance);const near=a[0]||null,state=near?.in_zone?"IN_ZONE":Number.isFinite(near?.distanceAtr)&&near.distanceAtr<=1?"NEAR":"WAIT";return{state,thresholdAtr:1,nearest:near,candidates:a};
}
function stopFor(direction:string,ladder:any,atr:number){const a=direction==="LONG"?ladder.below:ladder.above;if(a.length<3)return NaN;const x=a[2],buf=atr>0?atr*.25:Math.abs(x.point)*.0025;return direction==="LONG"?x.ob.bottom-buf:x.ob.top+buf}
function trendRelation(direction:string,trend:string){if(trend==="RANGO")return"RANGO";return(direction==="LONG"&&trend==="ALCISTA")||(direction==="SHORT"&&trend==="BAJISTA")?"A_FAVOR":"CONTRA_TENDENCIA"}
function directionEligibility(direction:string,snap:any){
  const want=direction==="LONG"?"ALCISTA":"BAJISTA",against=direction==="LONG"?"BAJISTA":"ALCISTA",
    c1=snap?.context||{},macroTrend=String(snap?.macroContext?.trend||"RANGO"),
    h1Trend=String(c1.trend||"RANGO"),eligible=h1Trend===want&&macroTrend!==against,
    relation=eligible?"A_FAVOR":macroTrend===against?"CONTRA_TENDENCIA":"RANGO",
    rsiOk=direction==="LONG"?n(c1.rsi14)>50:n(c1.rsi14)<50,
    macdOk=direction==="LONG"?n(c1.macd)>n(c1.signal):n(c1.macd)<n(c1.signal),
    volumeOk=n(c1.volumeRatio)>=1;
  return{eligible,relation,contextOk:macroTrend!==against,macroTrend,h1Trend,
    structureOk:true,momentumScore:[rsiOk,macdOk,volumeOk].filter(Boolean).length,
    rsiOk,macdOk,volumeOk,indicatorsRole:"context_only",emaFilter:false,
    reasons:eligible?[]:["trend_not_aligned"]};
}
function rejectsZone(bar:Bar,level:Level,direction:string){
  const range=Math.max(1e-12,bar.h-bar.l),overlap=bar.l<=level.ob.top&&bar.h>=level.ob.bottom;
  if(!overlap)return false;
  if(direction==="LONG"){
    const lowerWick=(Math.min(bar.o,bar.c)-bar.l)/range;
    return bar.l<=level.point&&bar.c>level.point&&bar.c>bar.o&&lowerWick>=.20;
  }
  const upperWick=(bar.h-Math.max(bar.o,bar.c))/range;
  return bar.h>=level.point&&bar.c<level.point&&bar.c<bar.o&&upperWick>=.20;
}
function tradePlan(direction:string,level:Level,snap:any,entry:number){
  const atr=n(snap?.context?.atr14),entries=direction==="LONG"?snap?.ladder?.below:snap?.ladder?.above,
        raw=direction==="LONG"?snap?.ladder?.above:snap?.ladder?.below;
  if(!(atr>0)||!entries?.length||!raw?.length)return null;
  const third=levelFromPublic(entries[Math.min(2,entries.length-1)]),
        stop=direction==="LONG"?third.ob.bottom-.25*atr:third.ob.top+.25*atr,
        risk=Math.abs(entry-stop);
  if(!(risk>0)||(direction==="LONG"&&stop>=entry)||(direction==="SHORT"&&stop<=entry))return null;
  const targets=raw.map(levelFromPublic).filter((x:Level)=>direction==="LONG"?x.point>entry:x.point<entry);
  if(!targets.length)return null;
  return{stop,risk,rr:Math.abs(targets[0].point-entry)/risk,tp1:targets[0].point,
    tp2:targets[1]?.point??targets[0].point,tp3:targets[2]?.point??targets[targets.length-1].point,
    target_rank:targets[0].rank};
}
async function snapshotOne(sym:string){
  const row=await loadState(sym);if(!row)return{symbol:sym,ready:false,reason:"detector_not_initialized"};
  const st=await catchup(sym,row),pair=sym+"USDT",now=Date.now();
  const [h1,h4,d1]=await Promise.all([klines(pair,"1h",1000),klines(pair,"4h",1000),klines(pair,"1d",1000)]);
  const live=h1[h1.length-1];if(!live)return{symbol:sym,ready:false,reason:"missing_live_1h"};
  const h1c=h1.filter(x=>(x.closeTime||0)<now),h4c=h4.filter(x=>(x.closeTime||0)<now),d1c=d1.filter(x=>(x.closeTime||0)<now),lastClosed=h1c[h1c.length-1];
  const ladder=ladderFromState(st,live.c),c1=context(h1c),c4=context(h4c),cd=context(d1c);
  if(!c1.ready||!c4.ready||!cd.ready||!lastClosed)return{symbol:sym,pair,ready:false,reason:"context_insufficient",price:live.c,historyProcessed:st.processed,contextBars:{h1:h1c.length,h4:h4c.length,d1:d1c.length,required:210},ladder:{reference_price:live.c,below:ladder.below.map(publicLevel),above:ladder.above.map(publicLevel)},generatedAt:iso()};
  const trends=[c1.trend,c4.trend,cd.trend],bull=trends.filter(x=>x==="ALCISTA").length,bear=trends.filter(x=>x==="BAJISTA").length,macro=bull>=2?"ALCISTA":bear>=2?"BAJISTA":"RANGO";
  const publicLadder={reference_price:live.c,below:ladder.below.map(publicLevel),above:ladder.above.map(publicLevel)},base={context:c1,macroContext:{trend:macro,h1:c1,h4:c4,d1:cd}};
  const prox=proximity(ladder,live.c,c1.atr14,false);
  const temp={...base,ladder:publicLadder};
  return{symbol:sym,pair,ready:ladder.complete,reason:ladder.complete?null:"less_than_3x3_active_obs",price:live.c,live1h:{t:live.t,h:live.h,l:live.l,c:live.c},
    lastClosed1h:{t:lastClosed.t,closeTime:lastClosed.closeTime,h:lastClosed.h,l:lastClosed.l,o:lastClosed.o,c:lastClosed.c,v:lastClosed.v},historyProcessed:st.processed,
    ladder:publicLadder,signalReference:st.lastEval?.strategyVersion===VERSION?st.lastEval:null,context:c1,macroContext:base.macroContext,eligibility:{LONG:directionEligibility("LONG",temp),SHORT:directionEligibility("SHORT",temp)},proximity:prox,
    stops:{LONG:stopFor("LONG",ladder,c1.atr14),SHORT:stopFor("SHORT",ladder,c1.atr14)},generatedAt:iso()};
}
async function structure(){
  let base=await universe();
  const [{data:openRows,error:openErr},{data:prevStructure,error:prevStructErr}]=await Promise.all([
    sb.from("mtf_signals").select("symbol,strategy_version,status").in("strategy_version",[LEGACY_VERSION,VERSION]).eq("market","crypto").in("source",["FORWARD","MIGRATED_STRICT"]).in("status",["OPEN","TP1","TP2"]),
    sb.from("mtf_state").select("meta").eq("market","crypto_structure").maybeSingle()
  ]);
  if(openErr)throw openErr;if(prevStructErr)throw prevStructErr;
  const prevBase:any[]=Array.isArray(prevStructure?.meta?.universe)?prevStructure.meta.universe.map((x:any)=>String(x).toUpperCase()):[],
        overlap=prevBase.length?base.filter((s:string)=>prevBase.includes(s)).length:base.length;
  let universeFallback=false;
  if(base.length<15||(prevBase.length>=15&&overlap<10)){
    base=(prevBase.length>=15?prevBase:FALLBACK.slice(0,20));universeFallback=true;
  }
  base=[...new Set(base)].slice(0,20);
  const operationalRows=(openRows||[]).filter((x:any)=>String(x.strategy_version)===LEGACY_VERSION?["OPEN","TP1","TP2"].includes(String(x.status)):String(x.status)==="OPEN");
  const carried=[...new Set(operationalRows.map((x:any)=>String(x.symbol||"").toUpperCase()).filter(Boolean))].filter((s:string)=>!base.includes(s));
  const syms=[...base,...carried],out:any[]=[];let rebuilt=0;
  for(const sym of syms){
    try{
      let snap=await snapshotOne(sym);
      if(!snap.ready&&snap.reason==="detector_not_initialized"&&rebuilt<1){
        await rebuild(sym);rebuilt++;snap=await snapshotOne(sym);
      }
      out.push(snap);
    }catch(e){out.push({symbol:sym,ready:false,reason:String((e as Error).message||e)})}
  }
  const meta={strategy_version:VERSION,engine:ENGINE,generated_at:iso(),universe:base,scan_universe:syms,carried_open:carried,auto_rebuilt:rebuilt,universe_fallback:universeFallback,snapshot:out};
  const {error}=await sb.from("mtf_state").upsert({market:"crypto_structure",last_processed_at:iso(),last_run_at:iso(),meta,updated_at:iso()},{onConflict:"market"});if(error)throw error;
  return{universe:base.length,scan_universe:syms.length,carried_open:carried,auto_rebuilt:rebuilt,universe_fallback:universeFallback,ready:out.filter(x=>x.ready).length,notReady:out.filter(x=>!x.ready).map(x=>({symbol:x.symbol,reason:x.reason})),snapshot:out};
}
function levelFromPublic(p:any):Level{return{rank:n(p.rank),point:n(p.point),side:p.side==="above"?"above":"below",detectorSide:p.detector_side==="bear"?"bear":"bull",ob:{origin:0,confirm:0,originTime:n(p.origin_time),confirmTime:n(p.confirm_time),top:n(p.zone_top),bottom:n(p.zone_bottom),avg:n(p.point)}}}
function touched(bar:Bar,x:Level){return bar.l<=x.point&&bar.h>=x.point}
async function openSignals(sym:string){
  const {data,error}=await sb.from("mtf_signals").select("*").eq("strategy_version",VERSION).eq("market","crypto").eq("symbol",sym).eq("status","OPEN").order("signal_time");if(error)throw error;return data||[];
}
async function legacyOperationalSignals(sym:string){
  const {data,error}=await sb.from("mtf_signals").select("*").eq("strategy_version",LEGACY_VERSION).eq("market","crypto").eq("symbol",sym)
    .in("source",["FORWARD","MIGRATED_STRICT"]).in("status",["OPEN","TP1","TP2"]).order("signal_time");
  if(error)throw error;return data||[];
}
async function insertLeg(row:any){
  const legacy=await legacyOperationalSignals(String(row?.symbol||""));if(legacy.length)return null;
  const {data,error}=await sb.from("mtf_signals").insert({...row,strategy_version:VERSION,status:"OPEN",best_r:0,worst_r:0,hit1:false,hit2:false,hit3:false,created_at:iso(),updated_at:iso()}).select("*").single();
  if(error){if(String((error as any)?.code)==="23505")return null;throw error}return data;
}
function setupId(sym:string,dir:string,when:number){return[VERSION,"crypto",sym,dir,Math.floor(when/60000)].join(":")}
function signalFromConfirmation(sym:string,dir:string,level:Level,snap:any,id:string,bar:Bar,plan:any){
  const eventTime=n(bar.closeTime)||bar.t+HOUR,gate=directionEligibility(dir,snap);
  return{market:"crypto",symbol:sym,underlying:sym,direction:dir,signal_time:iso(eventTime),entry:level.point,stop:plan.stop,tp1:plan.tp1,tp2:plan.tp2,tp3:plan.tp3,source:"FORWARD",
    context:{strategy_version:VERSION,engine:ENGINE,setup_id:id,entry_rank:level.rank,operational_timeframe:"1h",trigger_timeframe:"1m",trigger_basis:"1m_range_crosses_active_1h_OB_point",
      entry_price_basis:"OB_center_line",entry_level:publicLevel(level),ob_key:"1h:"+dir+":"+level.ob.originTime,
      ladder_basis:"pre_confirmation_detector_state",ladder_snapshot:snap.ladder,context:snap.context,macro_context:snap.macroContext,eligibility:gate,trend_relation:gate.relation,proximity:snap.proximity,
      entry_policy:"OB_touch_plus_H1_trend_without_opposing_macro; indicators_context_only",exit_policy:"TP1_OR_STRUCTURAL_SL_WITH_1R_BE",
      rr_min:null,planned_rr:plan.rr,target_rank:plan.target_rank,initial_stop:plan.stop,
      protection_policy:"after_closed_1m_reaches_1R_move_active_stop_to_break_even_for_next_bar",
      trigger_bar:{t:bar.t,closeTime:eventTime,o:bar.o,h:bar.h,l:bar.l,c:bar.c,v:bar.v},stop_basis:"third_entry_OB_far_edge_plus_0_25_ATR"}};
}
async function live(createEntries=true){
  const [{data:st,error:stErr},{data:prevRow,error:prevErr}]=await Promise.all([
    sb.from("mtf_state").select("*").eq("market","crypto_structure").maybeSingle(),
    sb.from("mtf_state").select("*").eq("market","crypto_live").maybeSingle()
  ]);
  if(stErr)throw stErr;if(prevErr)throw prevErr;
  const snaps:any[]=st?.meta?.snapshot||[];if(!snaps.length)return{ready:false,reason:"missing_structure_snapshot"};
  const prevMap=new Map<string,any>((prevRow?.meta?.snapshot||[]).map((x:any)=>[String(x.symbol),x]));
  let hourlyConfirmation:any=prevRow?.meta?.hourlyConfirmation||null;
  const prices=await currentPrices(),liveStates:any[]=[],created:any[]=[],
        funnel:any={assets:snaps.length,ready:0,near_or_zone:0,context_allowed:0,structure_allowed:0,momentum_allowed:0,eligible_current:0,confirmation_bars_checked:0,rejection_hits:0,rr_pass:0,entries:0};
  for(const snap0 of snaps){
    const sym=String(snap0.symbol),pair=sym+"USDT",prev=prevMap.get(sym)||null;
    if(!snap0.ready){
      liveStates.push({symbol:sym,state:"NO_ANALYSIS",reason:snap0.reason,last_h1_close:n(prev?.last_h1_close)||null,last_m1_close:n(prev?.last_m1_close)||null,updated_at:iso()});
      continue;
    }
    funnel.ready++;
    const price=prices.get(pair)??n(snap0.price),legacy=await legacyOperationalSignals(sym);let opens=await openSignals(sym);
    const prox0={below:(snap0.ladder?.below||[]).map(levelFromPublic),above:(snap0.ladder?.above||[]).map(levelFromPublic)};
    const prox=proximity(prox0,price,n(snap0.context?.atr14),false),
          nearestDir=String(prox?.nearest?.direction||""),currentGate=nearestDir?(snap0?.eligibility?.[nearestDir]||directionEligibility(nearestDir,snap0)):null;
    if(["NEAR","IN_ZONE"].includes(String(prox.state))){
      funnel.near_or_zone++;
      if(currentGate?.contextOk){funnel.context_allowed++;if(currentGate?.structureOk){funnel.structure_allowed++;if(Number(currentGate?.momentumScore||0)>=2)funnel.momentum_allowed++;}}
      if(currentGate?.eligible)funnel.eligible_current++;
    }
    let lastH1=n(prev?.last_h1_close)||0,lastM1=n(prev?.last_m1_close)||0;
    let minuteBars:Bar[]=[];
    try{const rows=await klines(pair,"1m",12);
      minuteBars=rows.filter((x:Bar)=>(x.closeTime||0)<Date.now()).sort((x:Bar,y:Bar)=>x.t-y.t);}catch{}
    // Baseline on first observation; replay only bars strictly newer than the persisted watermark.
    if(!lastM1&&minuteBars.length)lastM1=n(minuteBars[minuteBars.length-1].closeTime)||minuteBars[minuteBars.length-1].t+60000;
    const freshBars=minuteBars.filter((bar:Bar)=>(n(bar.closeTime)||bar.t+60000)>lastM1);
    for(const bar of freshBars){
      const barClose=n(bar.closeTime)||bar.t+60000;
      if(createEntries&&prev&&n(prev.last_m1_close)>0){
        funnel.confirmation_bars_checked++;
        if(!legacy.length&&!opens.length){
          const candidates=[
            ...prox0.below.filter((x:Level)=>directionEligibility("LONG",snap0).eligible&&touched(bar,x))
              .map((level:Level)=>({dir:"LONG",level})),
            ...prox0.above.filter((x:Level)=>directionEligibility("SHORT",snap0).eligible&&touched(bar,x))
              .map((level:Level)=>({dir:"SHORT",level}))
          ].sort((a:any,b:any)=>a.level.rank-b.level.rank);
          funnel.rejection_hits+=candidates.length;
          for(const candidate of candidates){
            const gate=directionEligibility(candidate.dir,snap0),
                  plan=tradePlan(candidate.dir,candidate.level,snap0,candidate.level.point);
            if(!plan)continue;
            funnel.rr_pass++;
            const id=setupId(sym,candidate.dir,barClose),
                  row=signalFromConfirmation(sym,candidate.dir,candidate.level,snap0,id,bar,plan),
                  ins=await insertLeg(row);
            if(ins){opens.push(ins);funnel.entries++;created.push({symbol:sym,direction:candidate.dir,
              rank:candidate.level.rank,setup_id:id,entry:row.entry,stop:row.stop,tp1:row.tp1,
              rr:plan.rr,trend_relation:gate.relation});break}
          }
        }
      }
      lastM1=Math.max(lastM1,barClose);
    }
    try{const rows=await klines(pair,"1h",2),closed=rows.filter((x:Bar)=>(x.closeTime||0)<Date.now());
      const bar=closed[closed.length-1];if(bar)lastH1=Math.max(lastH1,n(bar.closeTime)||bar.t+HOUR);}catch{}
    const operational=legacy.length?legacy:opens;
    const eligible=snap0.eligibility||{};
    liveStates.push({
      symbol:sym,price,state:operational.length?"OPEN":prox.state,proximity:prox,open_count:operational.length,
      setup_id:operational[0]?.context?.setup_id||null,direction:operational[0]?.direction||null,
      active_strategy_version:operational[0]?.strategy_version||null,legacy_active:legacy.length>0,
      eligibility:eligible,last_h1_close:lastH1||null,last_bar_close:lastH1||null,last_m1_close:lastM1||null,
      baseline:!createEntries,updated_at:iso()
    });
  }
  const meta={strategy_version:VERSION,engine:ENGINE,generated_at:iso(),baseline:!createEntries,funnel,hourlyConfirmation,snapshot:liveStates};
  const {error}=await sb.from("mtf_state").upsert({
    market:"crypto_live",last_processed_at:iso(),last_run_at:iso(),meta,updated_at:iso()
  },{onConflict:"market"});if(error)throw error;
  return{ready:true,baseline:!createEntries,created:created.length,created_signals:created,states:liveStates.length,funnel};
}
Deno.serve(async(req:Request)=>{
  if(req.headers.get("authorization")!==`Bearer ${SERVICE_ROLE}`){
    return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  }
  try{
    const body=await req.json().catch(()=>({})),mode=String(body.mode||"structure"),symbol=String(body.symbol||"").toUpperCase();
    let result:any;
    if(mode==="rebuild"){if(!symbol)throw new Error("symbol required");result=await rebuild(symbol)}
    else if(mode==="structure")result=await structure();
    else if(mode==="live")result=await live(true);
    else if(mode==="baseline")result=await live(false);
    else if(mode==="snapshot"){if(!symbol)throw new Error("symbol required");result=await snapshotOne(symbol)}
    else if(mode==="universe")result={universe:await universe()};
    else throw new Error("unknown mode");
    return new Response(JSON.stringify({ok:true,strategy_version:VERSION,engine:ENGINE,mode,...result}),{headers:{"content-type":"application/json"}});
  }catch(e){
    console.error(e);return new Response(JSON.stringify({ok:false,error:String((e as Error).message||e)}),{status:500,headers:{"content-type":"application/json"}});
  }
});