import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const STRATEGY_VERSION = "MACD-OB-v1.0";
const PREVIOUS_CRYPTO_STRATEGY_VERSION = "OB-LADDER-v3.7.2";
const REGULATED_STRATEGY_VERSION = "OB-LADDER-v3.6";
const ADR_STRATEGY_VERSION = "ADR-OB-v1.0";
const LEGACY_STRATEGY_VERSION = "OB-LADDER-v3.5";
const ACTIVE_STRATEGY_VERSIONS = [REGULATED_STRATEGY_VERSION, ADR_STRATEGY_VERSION, STRATEGY_VERSION];
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession:false, autoRefreshToken:false } });

type Signal = {
  id:number; market:"crypto"|"cedear"|"merval"; symbol:string; underlying?:string|null;
  direction:string; signal_time:string; created_at:string; entry:number; stop:number; tp1:number; tp2:number; tp3:number; status:string; strategy_version?:string; context?:any;
};
type Bar = { t:number; h:number; l:number; c:number };

const n=(v:any)=>{if(v===null||v===undefined||v==="")return NaN;const x=Number(v);return Number.isFinite(x)?x:NaN};
const esc=(s:any)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const fmt=(v:any)=>Number.isFinite(n(v))?n(v).toLocaleString("en-US",{maximumFractionDigits:8}):"—";
const pct=(direction:string,entry:any,level:any)=>{
  const e=n(entry),l=n(level); if(!(e>0)||!Number.isFinite(l)) return NaN;
  const raw=(l/e-1)*100; return direction==="SHORT"?-raw:raw;
};
const entryGroupKey=(s:Signal)=>[String(s.context?.setup_id||[s.market,s.symbol,s.direction,s.signal_time].join(":")),"ENTRY",String(s.context?.entry_rank||"1")].join(":");
const setupGroupKey=(s:Signal)=>String(s.context?.setup_id||[s.market,s.symbol,s.direction,s.signal_time].join(":"));
const avgEntry=(a:Signal[])=>a.length?a.reduce((z,x)=>z+n(x.entry),0)/a.length:NaN;
const entryBarEnd=(s:Signal)=>{const t=new Date(s.signal_time).getTime();return Number.isFinite(t)?Math.floor(t/60000)*60000+60000:0;};
function baTime(v:any){
  const d=new Date(v),p=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Argentina/Buenos_Aires",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(d),o:any={};
  for(const x of p)o[x.type]=x.value;
  return `${o.day}/${o.month}/${o.year} ${o.hour}:${o.minute}:${o.second}`;
}

async function fetchJson(url:string, init:RequestInit={}, timeout=12000){
  const c=new AbortController(), tm=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{...init,signal:c.signal}); if(!r.ok)throw new Error(`${r.status} ${url}`); return await r.json();}
  finally{clearTimeout(tm)}
}

async function cryptoBars(symbol:string,since:number):Promise<Bar[]>{
  const start=Math.max(0,since-120000), pair=encodeURIComponent(symbol+"USDT");
  let last:any;
  for(const host of ["https://api.binance.com","https://data-api.binance.vision"]){
    try{
      const a=await fetchJson(`${host}/api/v3/klines?symbol=${pair}&interval=1m&startTime=${start}&limit=1000`,{},10000);
      return (Array.isArray(a)?a:[]).map((x:any[])=>({t:+x[6],h:+x[2],l:+x[3],c:+x[4]}))
        .filter((x:Bar)=>x.t>=start&&Number.isFinite(x.h)&&Number.isFinite(x.l));
    }catch(e){last=e}
  }
  throw last||new Error("Binance 1m no disponible");
}

function nyNow(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const o:any={}; for(const p of parts)o[p.type]=p.value; return o;
}
function nyMarketWindow(){
  const p=nyNow(); if(["Sat","Sun"].includes(p.weekday))return false;
  const m=Number(p.hour)*60+Number(p.minute); return m>=570&&m<=965;
}

async function yahooMinuteRaw(symbol:string,since:number):Promise<Bar[]>{
 let last:any;
 for(const host of ["https://query1.finance.yahoo.com","https://query2.finance.yahoo.com"]){
  try{
   const u=`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`;
   const j=await fetchJson(u,{headers:{"user-agent":"Mozilla/5.0",accept:"application/json"}},10000),z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{},ts=z?.timestamp||[],out:Bar[]=[];
   for(let i=0;i<ts.length;i++){const h=n(q.high?.[i]),l=n(q.low?.[i]),c=n(q.close?.[i]),t=Number(ts[i])*1000+60000;if(t>=since-120000&&Number.isFinite(h)&&Number.isFinite(l)&&Number.isFinite(c))out.push({t,h,l,c});}
   return out;
  }catch(e){last=e;}
 }
 throw last||new Error("Yahoo 1m no disponible");
}
async function cedearBars(underlying:string,since:number):Promise<Bar[]>{
 const out=await yahooMinuteRaw(underlying,since);
 if(!String(underlying).toUpperCase().endsWith(".SA"))return out;
 const fx=await yahooMinuteRaw("BRL=X",since-10*60000).catch(()=>[]);
 if(!fx.length)return[];
 let j=0,rate=n(fx[0]?.c),usd:Bar[]=[];
 for(const b of out){while(j+1<fx.length&&fx[j+1].t<=b.t){j++;rate=n(fx[j].c);}if(!(rate>0))continue;usd.push({t:b.t,h:b.h/rate,l:b.l/rate,c:b.c/rate});}
 return usd;
}


const BYMA="https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free";
const CCL_PROXY={local:"PAMP",adr:"PAM",ratio:25};
let mervalQuotesCache:any={at:0,map:null};
let cclNowCache:any={at:0,value:NaN};


function tzParts(tz:string,t=Date.now()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,weekday:"short"}).formatToParts(new Date(t)),o:any={};for(const p of parts)o[p.type]=p.value;return o;}
function dateTZ(tz:string,t=Date.now()){const p=tzParts(tz,t);return `${p.year}-${p.month}-${p.day}`;}
function minsTZ(tz:string,t=Date.now()){const p=tzParts(tz,t);return Number(p.hour)*60+Number(p.minute);}
function weekendTZ(tz:string,t=Date.now()){return ["Sat","Sun"].includes(tzParts(tz,t).weekday);}
async function bymaMinuteBars(symbol:string,since:number):Promise<Bar[]>{
 const to=Math.floor(Date.now()/1000)+120,from=Math.floor(Math.max(Date.now()-86400000*3,since-120000)/1000),url=BYMA+"/chart/historical-series/history?symbol="+encodeURIComponent(symbol+" 24HS")+"&resolution=1&from="+from+"&to="+to;
 const j=await fetchJson(url,{},10000);if(j?.s!=="ok"||!Array.isArray(j.t))return[];const out:Bar[]=[];
 for(let i=0;i<j.t.length;i++){const c=n(j.c?.[i]),h=n(j.h?.[i]),l=n(j.l?.[i]),t=Number(j.t[i])*1000;if(t>=since-120000&&Number.isFinite(c)&&Number.isFinite(h)&&Number.isFinite(l))out.push({t,h,l,c});}
 return out;
}
async function marketLiveState(since:number){
 const now=Date.now(),baWeekend=weekendTZ("America/Argentina/Buenos_Aires"),usWeekend=weekendTZ("America/New_York"),baM=minsTZ("America/Argentina/Buenos_Aires"),usM=minsTZ("America/New_York");
 if(baWeekend||usWeekend)return{bothOpen:false,reason:"weekend"};
 if(!(baM>=11*60&&baM<=17*60))return{bothOpen:false,reason:"byma_closed"};
 if(!(usM>=9*60+30&&usM<=16*60))return{bothOpen:false,reason:"usa_closed"};
 const [ba,us]=await Promise.all([bymaMinuteBars("GGAL",since).catch(()=>[]),cedearBars("SPY",since).catch(()=>[])]);
 const baLast=ba.at(-1),usLast=us.at(-1),todayBA=dateTZ("America/Argentina/Buenos_Aires",now),todayUS=dateTZ("America/New_York",now);
 const baFresh=!!baLast&&dateTZ("America/Argentina/Buenos_Aires",baLast.t)===todayBA&&(now-baLast.t)<=15*60000;
 const usFresh=!!usLast&&dateTZ("America/New_York",usLast.t)===todayUS&&(now-usLast.t)<=15*60000;
 return{bothOpen:baFresh&&usFresh,reason:baFresh?(usFresh?"live":"usa_no_fresh_data"):"byma_no_fresh_data",bymaLast:baLast?.t||null,usaLast:usLast?.t||null};
}
function rowsFrom(o:any){if(Array.isArray(o))return o;if(Array.isArray(o?.data))return o.data;if(Array.isArray(o?.content))return o.content;return[];}
function quotePrice(r:any){for(const v of [r?.trade,r?.closingPrice,r?.lastPrice,r?.price]){const x=n(v);if(x>0)return x;}return NaN;}
async function mervalQuotes(){
 if(mervalQuotesCache.map&&Date.now()-mervalQuotesCache.at<30000)return mervalQuotesCache.map;
 const body=JSON.stringify({T1:true,page_size:5000}),headers={"content-type":"application/json",accept:"application/json"};
 const [a,b]=await Promise.all([
   fetchJson(BYMA+"/leading-equity",{method:"POST",headers,body},10000),
   fetchJson(BYMA+"/general-equity",{method:"POST",headers,body},10000)
 ]);
 const map=new Map<string,number>();
 for(const r of [...rowsFrom(a),...rowsFrom(b)]){const s=String(r?.symbol||"").trim().toUpperCase(),p=quotePrice(r);if(s&&p>0)map.set(s,p);}
 mervalQuotesCache={at:Date.now(),map};return map;
}
async function cclNow(since:number){
 if(Number.isFinite(cclNowCache.value)&&Date.now()-cclNowCache.at<30000)return cclNowCache.value;
 const [quotes,pam]=await Promise.all([mervalQuotes(),cedearBars(CCL_PROXY.adr,since)]);
 const local=quotes.get(CCL_PROXY.local),adr=pam.at(-1)?.c;
 const fx=n(local)*CCL_PROXY.ratio/n(adr);if(!(fx>0))throw new Error("CCL intradía no disponible o desalineado");
 cclNowCache={at:Date.now(),value:fx};return fx;
}
async function mervalSyntheticBars(symbol:string,since:number):Promise<Bar[]>{
 const [quotes,fx]=await Promise.all([mervalQuotes(),cclNow(since)]),local=quotes.get(symbol),usd=n(local)/fx;
 if(!(usd>0))return[];return[{t:Date.now(),h:usd,l:usd,c:usd}];
}

function tradeHourAgeMinutes(h:string){
 const p=tzParts("America/Argentina/Buenos_Aires"),now=Number(p.hour)*3600+Number(p.minute)*60+Number(p.second||0),m=String(h||"").match(/^(\d{1,2}):(\d{2}):(\d{2})$/);if(!m)return Infinity;
 const sec=Number(m[1])*3600+Number(m[2])*60+Number(m[3]),d=now-sec;return d>=0?d/60:Infinity;
}
async function bymaLiveSnapshot(){
 const body=JSON.stringify({T1:true,page_size:200}),headers={"content-type":"application/json",accept:"application/json"};
 const j=await fetchJson(BYMA+"/leading-equity",{method:"POST",headers,body},10000),rows=rowsFrom(j),wanted=["GGAL","PAMP","YPFD","BMA"],snap:any={};
 for(const sym of wanted){const r=rows.find((x:any)=>String(x?.symbol||"").toUpperCase()===sym);if(r)snap[sym]={volume:n(r.volume),tradeHour:String(r.tradeHour||""),trade:n(r.trade)};}
 return snap;
}
async function computeMarketGuard(){
 const now=Date.now(),todayBA=dateTZ("America/Argentina/Buenos_Aires",now),todayUS=dateTZ("America/New_York",now);
 const {data:prevRow}=await sb.from("mtf_state").select("meta").eq("market","market_guard").maybeSingle(),prev=prevRow?.meta||{},prevByma=prev?.byma||{};
 let snapshot:any={};try{snapshot=await bymaLiveSnapshot()}catch(_){}
 let changed=false,recent=false,hasTradeEvidence=false;
 for(const [sym,v] of Object.entries(snapshot) as any){
   const pv=prevByma?.snapshot?.[sym];
   if(!pv||n(pv.volume)!==n(v.volume)||String(pv.tradeHour||"")!==String(v.tradeHour||""))changed=true;
   if(tradeHourAgeMinutes(v.tradeHour)<=15)recent=true;
   if(n(v.volume)>0||n(v.trade)>0||String(v.tradeHour||"").trim())hasTradeEvidence=true;
 }
 const prevSnapshot=prevByma?.snapshot||{};
 const prevHasTradeEvidence=Object.values(prevSnapshot).some((v:any)=>n(v?.volume)>0||n(v?.trade)>0||String(v?.tradeHour||"").trim());
 const usePreviousSnapshot=!hasTradeEvidence&&prevHasTradeEvidence&&prevByma.sessionDate===todayBA;
 if(usePreviousSnapshot)snapshot=prevSnapshot;
 let bymaSessionDate=(recent||hasTradeEvidence)?todayBA:(usePreviousSnapshot?todayBA:null),
     bymaLastChange=(recent||hasTradeEvidence)?new Date(now).toISOString():(usePreviousSnapshot?(prevByma.lastChangeAt||null):null);
 const baM=minsTZ("America/Argentina/Buenos_Aires",now),usM=minsTZ("America/New_York",now),baWeekend=weekendTZ("America/Argentina/Buenos_Aires",now),usWeekend=weekendTZ("America/New_York",now);
 const bymaOpen=!baWeekend&&baM>=11*60&&baM<=17*60&&bymaSessionDate===todayBA&&bymaLastChange&&(now-new Date(bymaLastChange).getTime())<=15*60000;
 let usBars:Bar[]=[];try{usBars=await cedearBars("SPY",now-20*60000)}catch(_){}
 const usLast=usBars.at(-1),usSessionDate=usLast?dateTZ("America/New_York",usLast.t):(prev?.usa?.sessionDate||null),usaOpen=!usWeekend&&usM>=9*60+30&&usM<=16*60&&usLast&&usSessionDate===todayUS&&(now-usLast.t)<=15*60000;
 const bymaSessionToday=bymaSessionDate===todayBA,usaSessionToday=usSessionDate===todayUS;
 let code="CLOSED",text="Mercados cerrados",actionable=false,validDaily=false;
 if(baWeekend||usWeekend){code="WEEKEND";text="Fin de semana · CEDEAR/Merval sin rueda";}
 else if(baM<11*60||usM<9*60+30){code="PREOPEN";text="Preapertura · se conserva última lectura válida";}
 else if(bymaOpen&&usaOpen){code="LIVE";text="BYMA y USA abiertos · watcher activo";actionable=true;}
 else if(baM>17*60&&usM>16*60&&bymaSessionToday&&usaSessionToday){code="COMPLETE";text="Rueda completa en ambos mercados · cierre USD válido";validDaily=true;}
 else if(!bymaSessionToday&&usaSessionToday){code="BYMA_CLOSED";text="BYMA sin rueda · USA operó · no se generan entradas locales";}
 else if(!usaSessionToday&&bymaSessionToday){code="USA_CLOSED";text="USA sin rueda · BYMA operó · USD desactualizado, sin señal";}
 else if(bymaSessionToday&&usaSessionToday){code="PARTIAL";text="Fuera de superposición de mercados · niveles pausados";}
 else {code="NO_SESSION";text="Sin rueda válida simultánea · alertas locales pausadas";}
 const bymaCode=bymaOpen?"OPEN":(!baWeekend&&baM<11*60&&!bymaSessionToday)?"PREOPEN":bymaSessionToday?"SESSION_TODAY":"NO_SESSION";
 const usaCode=usaOpen?"OPEN":(!usWeekend&&usM<9*60+30&&!usaSessionToday)?"PREOPEN":usaSessionToday?"SESSION_TODAY":"NO_SESSION";
 const meta={generatedAt:new Date(now).toISOString(),byma:{code:bymaCode,text:bymaCode==="OPEN"?"BYMA abierto":bymaCode==="PREOPEN"?"BYMA en preapertura":bymaSessionToday?"BYMA operó hoy":"BYMA sin rueda hoy",sessionDate:bymaSessionDate,lastChangeAt:bymaLastChange,snapshot},usa:{code:usaCode,text:usaCode==="OPEN"?"USA abierto":usaCode==="PREOPEN"?"USA en preapertura":usaSessionToday?"USA operó hoy":"USA sin rueda hoy",sessionDate:usSessionDate,lastBarAt:usLast?new Date(usLast.t).toISOString():null},combined:{code,text,actionable,validDaily}};
 await sb.from("mtf_state").upsert({market:"market_guard",last_processed_at:new Date(now).toISOString(),last_run_at:new Date(now).toISOString(),meta,updated_at:new Date(now).toISOString()});
 return meta;
}
async function createEvent(ev:any){
  const fingerprint=String(ev.group_key)+":"+String(ev.event_type);
  const {data:sent,error:sentErr}=await sb.from("mtf_alert_delivery_ledger").select("fingerprint").eq("fingerprint",fingerprint).maybeSingle();
  if(sentErr)throw sentErr;
  if(sent)return false;
  const {error}=await sb.from("mtf_alert_events").upsert(
    {...ev,strategy_version:String(ev.strategy_version||STRATEGY_VERSION),updated_at:new Date().toISOString()},
    {onConflict:"group_key,event_type",ignoreDuplicates:true}
  );
  if(error)throw error;
  return true;
}
async function syncSignals(ids:number[],patch:any){
  if(!ids?.length)return;
  const {error}=await sb.from("mtf_signals").update({...patch,updated_at:new Date().toISOString()}).in("id",ids);
  if(error)throw error;
}

function eventText(e:any){
  const market=e.market==="crypto"?"Crypto":e.market==="cedear"?"CEDEAR":e.market==="merval"?"Merval USD":"Sistema";
  const dir=String(e.direction||""),isShort=dir==="SHORT",dirIcon=isShort?"🔴":"🟢",displayDir=e.market==="crypto"?dir:(dir==="LONG"?"COMPRA":dir);
  const p=Number.isFinite(n(e.move_pct))?(n(e.move_pct)>=0?"+":"")+n(e.move_pct).toFixed(2)+"%":"—";
  const ctx=e.payload?.context||{},macro=e.payload?.macro_context||{};
  const relation=String(e.payload?.trend_relation||"");
  const risk=String(e.payload?.risk_profile||"");
  const rank=e.payload?.entry_rank?String(e.payload.entry_rank):"";
  const plannedRR=n(e.payload?.planned_rr);
  const contextLine=e.market==="crypto"
    ?`Contexto: 1H ${esc(macro?.h1?.trend||ctx?.trend||"—")} · 4H ${esc(macro?.h4?.trend||"—")} · D ${esc(macro?.d1?.trend||"—")}${relation?" · <b>"+esc(relation.replaceAll("_"," "))+"</b>":""}`
    :`Contexto: Diario ${esc(macro?.d1?.trend||ctx?.trend||"—")} · Semanal ${esc(macro?.w1?.trend||macro?.trend||"—")}${relation?" · <b>"+esc(relation.replaceAll("_"," "))+"</b>":""}${risk?" · Riesgo <b>"+esc(risk)+"</b>":""}`;
  if(e.event_type==="SYSTEM"&&e.payload?.alert_kind==="CRYPTO_NEAR"){
    const d=Number.isFinite(n(e.payload?.distance_atr))?n(e.payload.distance_atr).toFixed(2)+" ATR":"—";
    const dp=Number.isFinite(n(e.payload?.distance_pct))?n(e.payload.distance_pct).toFixed(2)+"%":"—";
    return [
      `🟡 <b>ALERTA CERCA · ${esc(dir)}${rank?" "+rank:""} · ${esc(e.symbol)}</b>`,
      `Crypto · todavía sin entrada`,
      contextLine,
      `Precio actual: <b>${fmt(e.price)}</b>`,
      `Entrada exacta: <b>${fmt(e.entry)}</b>`,
      `Distancia: ${d} · ${dp}`,
      `Zona OB: ${fmt(e.payload?.zone_bottom)} – ${fmt(e.payload?.zone_top)}`
    ].join("\n");
  }
  if(e.event_type==="SYSTEM"&&e.payload?.alert_kind==="REGULATED_ZONE"){
    const d=Number.isFinite(n(e.payload?.distance_atr))?n(e.payload.distance_atr).toFixed(2)+" ATR":"—";
    const dp=Number.isFinite(n(e.payload?.distance_pct))?n(e.payload.distance_pct).toFixed(2)+"%":"—";
    return [
      `🟠 <b>ALERTA EN ZONA · COMPRA${rank?" "+rank:""} · ${esc(e.symbol)}</b>`,
      `${market}${e.underlying&&e.underlying!==e.symbol?" · "+esc(e.underlying):""} · todavía sin entrada`,
      contextLine,
      `Precio actual: <b>${fmt(e.price)}</b>`,
      `Entrada exacta: <b>${fmt(e.entry)}</b>`,
      `Distancia: ${d} · ${dp}`,
      `Zona OB: ${fmt(e.payload?.zone_bottom)} – ${fmt(e.payload?.zone_top)}`
    ].join("\n");
  }
  if(e.event_type==="ENTRY"){
    const entryTitle=e.market==="crypto"?`${dirIcon} <b>ENTRADA ${esc(dir)}${rank?" "+rank:""} · ${esc(e.symbol)}</b>`:`${dirIcon} <b>COMPRA${rank?" "+rank:""} · ${esc(e.symbol)}</b>`;
    const riskLine=e.market==="crypto"
      ?`Stop estructural: ${fmt(e.stop)} · <b>${pct(dir,e.entry,e.stop).toFixed(2)}%</b>`
      :"Sin stop loss automático";
    return [
      entryTitle,
      `${market}${e.underlying&&e.underlying!==e.symbol?" · "+esc(e.underlying):""}`,
      contextLine,
      `Entrada: <b>${fmt(e.entry)}</b>`,
      riskLine,
      `Salida del sistema (TP1): ${fmt(e.tp1)} · <b>+${Math.abs(pct(dir,e.entry,e.tp1)).toFixed(2)}%</b>`,
      Number.isFinite(plannedRR)?(e.market==="crypto"
        ?`R:R planificado: <b>${plannedRR.toFixed(2)}R</b> · protección BE desde +1R`
        :`R:R planificado: <b>${plannedRR.toFixed(2)}R</b> · invalidación técnica ${fmt(e.stop)} (referencia, sin stop automático)`):"",
      `Confirmada: ${baTime(e.detected_at||e.created_at||e.signal_time)}`,
      `Vela base: ${baTime(e.signal_time)}`
    ].join("\n");
  }
  if(e.event_type==="TP1") return [
    `✅ <b>TP1 ALCANZADO · ${esc(displayDir)} · ${esc(e.symbol)}</b>`,
    `Nivel: ${fmt(e.tp1)} · <b>${p}</b>`,
    `Entrada promedio del setup: ${fmt(e.entry)}`,
    "Operación cerrada por objetivo."
  ].join("\n");
  if(e.event_type==="TP2") return [
    `🎯 <b>TP2 ALCANZADO · ${esc(displayDir)} · ${esc(e.symbol)}</b>`,
    `Nivel: ${fmt(e.tp2)} · <b>${p}</b>`,
    `Entrada promedio del setup: ${fmt(e.entry)}`,
    `TP3 pendiente: ${fmt(e.tp3)}`
  ].join("\n");
  if(e.event_type==="TP3") return [
    `🏁 <b>TP3 ALCANZADO · ${esc(displayDir)} · ${esc(e.symbol)}</b>`,
    `Nivel: ${fmt(e.tp3)} · <b>${p}</b>`,
    `Entrada promedio del setup: ${fmt(e.entry)}`,
    "Setup completado."
  ].join("\n");
  if(e.event_type==="SL"&&e.payload?.exit_reason==="BREAK_EVEN") return [
    `🟦 <b>BREAK EVEN · ${esc(displayDir)} · ${esc(e.symbol)}</b>`,
    `Nivel protegido: ${fmt(e.stop)} · <b>${p}</b>`,
    `Entrada: ${fmt(e.entry)}`,
    "La operación había alcanzado +1R y el stop se protegió en entrada."
  ].join("\n");
  if(e.event_type==="SL") return [
    `🛑 <b>STOP ESTRUCTURAL · ${esc(displayDir)} · ${esc(e.symbol)}</b>`,
    `Nivel: ${fmt(e.stop)} · <b>${p}</b>`,
    `Entrada promedio del setup: ${fmt(e.entry)}`,
    "Se cerraron las entradas activas del setup."
  ].join("\n");
  if(e.event_type==="AMBIGUOUS") return [
    `⚠️ <b>TOQUE AMBIGUO · ${esc(displayDir)} · ${esc(e.symbol)}</b>`,
    "En la misma vela de 1 minuto se tocaron objetivo y stop.",
    "El orden intraminuto no puede determinarse con estos datos."
  ].join("\n");
  return `ℹ️ <b>MTF Live Monitor</b>\n${esc(e.payload?.message||"Evento del sistema")}`;
}
async function telegramConfig(config:any){
  if(!TELEGRAM_BOT_TOKEN)return {token:"",chatId:"",linked:false,reason:"TELEGRAM_BOT_TOKEN no configurado"};
  let chatId=String(config.telegram_public_chat_id||config.telegram_chat_id||"");
  if(chatId)return {token:TELEGRAM_BOT_TOKEN,chatId,linked:true};
  try{
    const j=await fetchJson(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=100&timeout=0`,{},10000);
    const expected=`/VINCULAR ${String(config.telegram_pair_code||"").toUpperCase()}`;
    const updates=Array.isArray(j?.result)?j.result:[];
    const hit=[...updates].reverse().find((u:any)=>{
      const txt=String(u?.message?.text||"").trim().toUpperCase();
      return txt===expected && u?.message?.chat?.id!=null;
    });
    if(hit){
      chatId=String(hit.message.chat.id);
      await sb.from("mtf_alert_config").update({telegram_chat_id:chatId,telegram_linked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",1);
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({chat_id:chatId,text:"✅ MTF Live Monitor vinculado. Las alertas en tiempo real quedaron activadas."})
      });
      return {token:TELEGRAM_BOT_TOKEN,chatId,linked:true};
    }
    return {token:TELEGRAM_BOT_TOKEN,chatId:"",linked:false,reason:"Esperando comando de vinculación"};
  }catch(e){return {token:TELEGRAM_BOT_TOKEN,chatId:"",linked:false,reason:String((e as Error).message||e)}}
}

async function sendPending(config:any){
  const tg=await telegramConfig(config);
  if(!tg.linked)return {configured:!!tg.token,linked:false,reason:tg.reason,sent:0};

  const staleCutoff=new Date(Date.now()-5*60*1000).toISOString();
  await sb.from("mtf_alert_events")
    .update({status:"FAILED",updated_at:new Date().toISOString(),last_error:"Stale SENDING claim: not retried to avoid duplicate Telegram delivery"})
    .in("strategy_version",ACTIVE_STRATEGY_VERSIONS).eq("status","SENDING").lt("updated_at",staleCutoff);

  const {data:events,error}=await sb.from("mtf_alert_events")
    .select("*").in("strategy_version",ACTIVE_STRATEGY_VERSIONS).eq("status","PENDING")
    .order("detected_at",{ascending:true}).order("id",{ascending:true}).limit(15);
  if(error)throw error;

  let sent=0,failed=0,claimed=0;
  for(const e of events||[]){
    const claimTime=new Date().toISOString();
    const {data:claim,error:claimErr}=await sb.from("mtf_alert_events")
      .update({status:"SENDING",updated_at:claimTime})
      .eq("id",e.id).eq("status","PENDING").select("*").maybeSingle();
    if(claimErr)throw claimErr;
    if(!claim)continue;
    const fingerprint=String(claim.group_key)+":"+String(claim.event_type);
    const {data:alreadySent,error:ledgerErr}=await sb.from("mtf_alert_delivery_ledger").select("fingerprint").eq("fingerprint",fingerprint).maybeSingle();
    if(ledgerErr)throw ledgerErr;
    if(alreadySent){
      await sb.from("mtf_alert_events").update({
        status:"SKIPPED",last_error:"Already delivered previously",updated_at:new Date().toISOString()
      }).eq("id",claim.id).eq("status","SENDING");
      continue;
    }
    claimed++;
    try{
      const r=await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({chat_id:tg.chatId,text:eventText(claim),parse_mode:"HTML",disable_web_page_preview:true})
      });
      const body=await r.text();
      if(!r.ok)throw new Error(`Telegram ${r.status}: ${body.slice(0,300)}`);
      const sentAt=new Date().toISOString();
      await sb.from("mtf_alert_events").update({
        status:"SENT",sent_at:sentAt,attempts:(claim.attempts||0)+1,last_error:null,updated_at:sentAt
      }).eq("id",claim.id).eq("status","SENDING");
      const {error:ledgerWriteErr}=await sb.from("mtf_alert_delivery_ledger").upsert({
        fingerprint,group_key:claim.group_key,event_type:claim.event_type,market:claim.market,symbol:claim.symbol,
        direction:claim.direction,strategy_version:claim.strategy_version,sent_at:sentAt
      },{onConflict:"fingerprint",ignoreDuplicates:true});
      if(ledgerWriteErr)throw ledgerWriteErr;
      sent++;
    }catch(err){
      const attempts=(claim.attempts||0)+1;
      await sb.from("mtf_alert_events").update({
        status:attempts>=5?"FAILED":"PENDING",attempts,last_error:String((err as Error).message||err).slice(0,1000),updated_at:new Date().toISOString()
      }).eq("id",claim.id).eq("status","SENDING");
      failed++;
    }
  }
  return {configured:true,linked:true,claimed,sent,failed};
}


function proximityAlertKey(market:string,x:any){
  const p=x?.proximity?.nearest||{},dir=String(p.direction||"LONG"),rank=String(p.rank||""),point=n(p.point);
  return [market,String(x?.symbol||""),dir,rank,Number.isFinite(point)?String(point):""].join(":");
}
function regulatedRiskFromSnapshot(x:any){
  const d=String(x?.context?.trend||"RANGO"),w=String(x?.macroContext?.w1?.trend||x?.macroContext?.trend||"RANGO");
  if(d==="ALCISTA"&&w==="ALCISTA")return{relation:"A_FAVOR",risk:"MENOR"};
  if(d==="BAJISTA"&&w==="BAJISTA")return{relation:"CONTRA_TENDENCIA",risk:"MAYOR"};
  return{relation:"SIN_CONFLUENCIA",risk:"INTERMEDIO"};
}
async function syncPreEntryAlerts(marketGuard:any){
  const {data:states,error}=await sb.from("mtf_state").select("market,meta,last_run_at").in("market",["crypto_live","crypto_structure","regulated_live","prealert_live"]);
  if(error)throw error;
  const sm=new Map<string,any>((states||[]).map((r:any)=>[String(r.market),r]));
  const prev=sm.get("prealert_live")?.meta||{},prevKeys=new Set<string>(Array.isArray(prev.keys)?prev.keys:[]),current:any[]=[];
  const cs=new Map<string,any>((sm.get("crypto_structure")?.meta?.snapshot||[]).map((x:any)=>[String(x.symbol),x]));
  for(const x of sm.get("crypto_live")?.meta?.snapshot||[]){
    if(String(x?.state)!=="NEAR"||Number(x?.open_count||0)>0)continue;
    const p=x?.proximity?.nearest;if(!p||!Number.isFinite(n(p.point)))continue;
    const st=cs.get(String(x.symbol))||{},price=n(x.price),entry=n(p.point),distPct=entry?Math.abs(price-entry)/Math.abs(entry)*100:NaN,
          direction=String(p.direction||"LONG"),gate=st?.eligibility?.[direction]||{},relation=gate.eligible===true?"A_FAVOR":"BLOQUEADO";
    if(gate.eligible!==true)continue;
    current.push({
      key:proximityAlertKey("crypto",x),kind:"CRYPTO_NEAR",market:"crypto",symbol:String(x.symbol),underlying:String(x.symbol),
      direction:String(p.direction||"LONG"),rank:Number(p.rank||0),price,entry,distanceAtr:n(p.distanceAtr),distancePct:distPct,
      zoneBottom:n(p.zone_bottom),zoneTop:n(p.zone_top),context:st?.context||{},macro:st?.macroContext||{},relation
    });
  }
  const regOpen=String(marketGuard?.byma?.code||"")==="OPEN";
  if(regOpen){
    for(const x of sm.get("regulated_live")?.meta?.snapshot||[]){
      if(String(x?.state)!=="IN_ZONE"||Number(x?.open_count||0)>0)continue;
      const p=x?.proximity?.nearest;if(!p||!Number.isFinite(n(p.point)))continue;
      const r=regulatedRiskFromSnapshot(x),price=n(x.price),entry=n(p.point),distPct=entry?Math.abs(price-entry)/Math.abs(entry)*100:NaN;
      if(r.relation!=="A_FAVOR")continue;
      current.push({
        key:proximityAlertKey(String(x.market||"cedear"),x),kind:"REGULATED_ZONE",market:String(x.market||"cedear"),symbol:String(x.symbol),underlying:String(x.underlying||x.symbol),
        direction:"LONG",rank:Number(p.rank||0),price,entry,distanceAtr:n(p.distance_atr??p.distanceAtr),distancePct:distPct,
        zoneBottom:n(p.zone_bottom),zoneTop:n(p.zone_top),context:x?.context||{},macro:x?.macroContext||{},relation:r.relation,risk:r.risk
      });
    }
  }
  let created=0;
  if(prev.initialized===true){
    for(const a of current){
      if(prevKeys.has(a.key))continue;
      const made=await createEvent({
        strategy_version:a.market==="crypto"?STRATEGY_VERSION:REGULATED_STRATEGY_VERSION,
        group_key:"PREALERT:"+a.key,event_type:"SYSTEM",market:a.market,symbol:a.symbol,underlying:a.underlying,direction:a.direction,
        signal_time:new Date().toISOString(),signal_ids:[],price:a.price,entry:a.entry,stop:null,tp1:null,tp2:null,tp3:null,move_pct:null,detected_at:new Date().toISOString(),
        payload:{alert_kind:a.kind,entry_rank:a.rank,distance_atr:a.distanceAtr,distance_pct:a.distancePct,zone_bottom:a.zoneBottom,zone_top:a.zoneTop,context:a.context,macro_context:a.macro,trend_relation:a.relation,risk_profile:a.risk||null},
        status:"PENDING"
      });
      if(made)created++;
    }
  }
  const meta={initialized:true,generated_at:new Date().toISOString(),keys:current.map(x=>x.key),crypto_near:current.filter(x=>x.kind==="CRYPTO_NEAR").length,regulated_zone:current.filter(x=>x.kind==="REGULATED_ZONE").length};
  const {error:saveErr}=await sb.from("mtf_state").upsert({market:"prealert_live",last_processed_at:new Date().toISOString(),last_run_at:new Date().toISOString(),meta,updated_at:new Date().toISOString()},{onConflict:"market"});
  if(saveErr)throw saveErr;
  return{baseline:prev.initialized!==true,created,crypto_near:meta.crypto_near,regulated_zone:meta.regulated_zone};
}

Deno.serve(async(req:Request)=>{
  if(req.headers.get("authorization")!==`Bearer ${SERVICE_ROLE}`){
    return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  }
  try{
    const body=await req.json().catch(()=>({}));
    const {data:config,error:cfgErr}=await sb.from("mtf_alert_config").select("*").eq("id",1).single();
    if(cfgErr)throw cfgErr;
    if(!config.enabled)return new Response(JSON.stringify({ok:true,skipped:"disabled"}),{headers:{"content-type":"application/json"}});

    if(body?.test===true){
      await createEvent({
        group_key:"system:test:"+new Date().toISOString().slice(0,16),
        event_type:"SYSTEM",market:"system",symbol:"MTF",direction:null,
        detected_at:new Date().toISOString(),payload:{message:"Prueba de alertas: conexión Telegram operativa."},status:"PENDING"
      });
      const delivery=await sendPending(config);
      return new Response(JSON.stringify({ok:true,test:true,delivery}),{headers:{"content-type":"application/json"}});
    }

    const now=Date.now(), activated=new Date(config.activated_at).getTime();
    const since=config.last_watcher_at?new Date(config.last_watcher_at).getTime():Math.max(activated,now-60000);
    const dirFilter=String(config.entry_direction||"LONG");

    let q=sb.from("mtf_signals").select("*").in("strategy_version",[REGULATED_STRATEGY_VERSION,ADR_STRATEGY_VERSION,STRATEGY_VERSION]).eq("source","FORWARD").gte("created_at",new Date(Math.max(activated,since-120000)).toISOString());
    if(dirFilter!=="BOTH")q=q.eq("direction",dirFilter);
    const {data:newSignals,error:newErr}=await q;
    if(newErr)throw newErr;
    const eligibleNew=((newSignals||[]) as Signal[]).filter((s:any)=>
      (s.market==="crypto"&&String(s.strategy_version)===STRATEGY_VERSION)||
      (s.market==="cedear"&&String(s.strategy_version)===REGULATED_STRATEGY_VERSION)||
      (s.market==="merval"&&[REGULATED_STRATEGY_VERSION,ADR_STRATEGY_VERSION].includes(String(s.strategy_version)))
    );
    const entryGroups=new Map<string,Signal[]>();
    for(const s of eligibleNew){const k=entryGroupKey(s);if(!entryGroups.has(k))entryGroups.set(k,[]);entryGroups.get(k)!.push(s)}
    for(const [k,a] of entryGroups){
      const rep=a[0];
      if(rep.market!=="crypto"&&rep.direction!=="LONG")continue;
      await createEvent({
        strategy_version:rep.strategy_version,
        group_key:k,event_type:"ENTRY",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
        signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.entry,
        entry:rep.entry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,move_pct:0,detected_at:new Date().toISOString(),
        payload:{strategy:"confirmed_pullback",setup_id:rep.context?.setup_id,entry_rank:rep.context?.entry_rank,context:rep.context?.context,macro_context:rep.context?.macro_context,trend_relation:rep.context?.trend_relation,risk_profile:rep.context?.risk_profile,planned_rr:rep.context?.planned_rr},status:"PENDING"
      });
    }

    const {data:allOpenCandidates,error:openErr}=await sb.from("mtf_signals").select("*")
      .in("strategy_version",ACTIVE_STRATEGY_VERSIONS)
      .in("source",["FORWARD","MIGRATED_STRICT"]).in("status",["OPEN","TP1","TP2"]).order("signal_time");
    if(openErr)throw openErr;
    const opens=((allOpenCandidates||[]) as Signal[]).filter((s:any)=>{
      const v=String(s.strategy_version);
      if(s.market==="crypto")return v===STRATEGY_VERSION&&String(s.status)==="OPEN";
      if(s.market==="merval")return v===ADR_STRATEGY_VERSION&&String(s.status)==="OPEN";
      return v===REGULATED_STRATEGY_VERSION&&String(s.status)==="OPEN";
    });

    const openGroups=new Map<string,Signal[]>();
    for(const s of opens as Signal[]){const k=setupGroupKey(s);if(!openGroups.has(k))openGroups.set(k,[]);openGroups.get(k)!.push(s)}

    const keys=[...openGroups.keys()];
    const prior=new Map<string,Set<string>>();
    if(keys.length){
      const {data:evs,error:evErr}=await sb.from("mtf_alert_events").select("group_key,event_type,strategy_version")
        .in("strategy_version",ACTIVE_STRATEGY_VERSIONS).in("group_key",keys);
      if(evErr)throw evErr;
      for(const e of evs||[]){if(!prior.has(e.group_key))prior.set(e.group_key,new Set());prior.get(e.group_key)!.add(e.event_type)}
    }

    const needLocalWatch=[...openGroups.values()].some((a:any)=>a?.[0]?.market!=="crypto");
    const marketGuard=await computeMarketGuard().catch((e)=>({combined:{actionable:false,code:"ERROR",text:"No se pudo validar mercados"},error:String((e as Error).message||e)}));
    const liveState={bothOpen:!!marketGuard?.combined?.actionable,reason:marketGuard?.combined?.code||"UNKNOWN"};
    const preAlerts=await syncPreEntryAlerts(marketGuard);
    const cache=new Map<string,Bar[]>();
    let checked=0,createdLevels=0;
    for(const [k,a] of openGroups){
      const rep=a[0], isLegacy=false,
            isV37Crypto=rep.market==="crypto"&&String(rep.strategy_version)===STRATEGY_VERSION,
            setupEntry=avgEntry(a), initialStop=n(rep.context?.initial_stop), setupRisk=Math.abs(setupEntry-(Number.isFinite(initialStop)?initialStop:n(rep.stop))),
            setupPayload={setup_id:rep.context?.setup_id,strategy_version:rep.strategy_version,entries:a.map((x:any)=>({rank:x.context?.entry_rank,entry:x.entry,status:x.status})),context:rep.context?.context,macro_context:rep.context?.macro_context,trend_relation:rep.context?.trend_relation,planned_rr:rep.context?.planned_rr}, seen=prior.get(k)||new Set<string>(),
            setupEligibleAfter=Math.min(...a.map(entryBarEnd).filter((x:number)=>x>0)),
            signalStart=Math.min(...a.map((x:any)=>new Date(x.signal_time).getTime()).filter((x:number)=>Number.isFinite(x)&&x>0)),
            fetchFrom=Number.isFinite(signalStart)?Math.max(since,signalStart):since,
            dataKey=rep.market+":"+(rep.market==="crypto"?rep.symbol:(rep.underlying||rep.symbol))+":"+Math.floor(fetchFrom/60000);
      if(rep.market==="merval"){
        const adrV1=String(rep.strategy_version)===ADR_STRATEGY_VERSION;
        if(adrV1&&String(marketGuard?.usa?.code||"")!=="OPEN"){checked++;continue;}
        if(!adrV1&&!liveState.bothOpen){checked++;continue;}
      }
      if(rep.market==="cedear"&&String(marketGuard?.byma?.code||"")!=="OPEN"){checked++;continue;}
      let bars=cache.get(dataKey);
      if(!bars){
        try{
          if(rep.market==="crypto")bars=await cryptoBars(rep.symbol,fetchFrom);
          else if(rep.market==="merval"&&String(rep.context?.pricing_method||"").toUpperCase()==="SYNTH")bars=await mervalSyntheticBars(rep.symbol,fetchFrom);
          else bars=await cedearBars(rep.underlying||rep.symbol,fetchFrom);
        }catch(_){bars=[]}
        cache.set(dataKey,bars);
      }
      checked++;
      const isLong=rep.direction!=="SHORT",
            excursionStart=new Map<number,{best:number,worst:number}>();
      for(const s of a)excursionStart.set(s.id,{best:n((s as any).best_r)||0,worst:n((s as any).worst_r)||0});
      for(const b of bars){
        for(const s of a){
          if(b.t<entryBarEnd(s))continue;
          const originalStop=n(s.context?.initial_stop),R=Math.abs(n(s.entry)-(Number.isFinite(originalStop)?originalStop:n(s.stop)));if(!(R>0))continue;
          const fav=isLong?(b.h-n(s.entry))/R:(n(s.entry)-b.l)/R,adv=isLong?(b.l-n(s.entry))/R:(n(s.entry)-b.h)/R;
          (s as any).best_r=Math.max(n((s as any).best_r)||0,fav);
          (s as any).worst_r=Math.min(n((s as any).worst_r)||0,adv);
        }
        if(Number.isFinite(setupEligibleAfter)&&setupEligibleAfter>0&&b.t<setupEligibleAfter)continue;
        if(isLegacy){
          const hardStop=isLong?b.l<=n(rep.stop):b.h>=n(rep.stop),
            t1=isLong?b.h>=n(rep.tp1):b.l<=n(rep.tp1),
            t2=isLong?b.h>=n(rep.tp2):b.l<=n(rep.tp2),
            t3=isLong?b.h>=n(rep.tp3):b.l<=n(rep.tp3),
            newTarget=(!seen.has("TP1")&&t1)||(!seen.has("TP2")&&t2)||(!seen.has("TP3")&&t3),
            eventVersion=LEGACY_STRATEGY_VERSION;
          if(hardStop&&newTarget&&!seen.has("SL")&&!seen.has("AMBIGUOUS")){
            await createEvent({strategy_version:eventVersion,group_key:k,event_type:"AMBIGUOUS",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:b.c,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              detected_at:new Date(b.t).toISOString(),payload:{bar:b,...setupPayload},status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"AMBIGUOUS",closed_at:new Date(b.t).toISOString()});seen.add("AMBIGUOUS");createdLevels++;break;
          }
          if(t3&&!seen.has("TP3")){
            const hitAt=new Date(b.t).toISOString();
            if(!seen.has("TP1"))await createEvent({strategy_version:eventVersion,group_key:k,event_type:"TP1",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp1,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp1),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            if(!seen.has("TP2"))await createEvent({strategy_version:eventVersion,group_key:k,event_type:"TP2",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp2,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp2),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await createEvent({strategy_version:eventVersion,group_key:k,event_type:"TP3",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp3,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp3),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"TP3",hit1:true,hit2:true,hit3:true,hit1_at:(a[0] as any).hit1_at||hitAt,hit2_at:(a[0] as any).hit2_at||hitAt,hit3_at:hitAt,closed_at:hitAt});
            seen.add("TP1");seen.add("TP2");seen.add("TP3");createdLevels++;break;
          }
          if(t2&&!seen.has("TP2")){
            const hitAt=new Date(b.t).toISOString();
            if(!seen.has("TP1"))await createEvent({strategy_version:eventVersion,group_key:k,event_type:"TP1",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp1,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp1),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await createEvent({strategy_version:eventVersion,group_key:k,event_type:"TP2",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp2,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp2),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"TP2",hit1:true,hit2:true,hit1_at:(a[0] as any).hit1_at||hitAt,hit2_at:hitAt});
            seen.add("TP1");seen.add("TP2");createdLevels++;
          }else if(t1&&!seen.has("TP1")){
            const hitAt=new Date(b.t).toISOString();
            await createEvent({strategy_version:eventVersion,group_key:k,event_type:"TP1",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp1,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp1),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"TP1",hit1:true,hit1_at:hitAt});seen.add("TP1");createdLevels++;
          }
          if(hardStop&&!seen.has("SL")&&!seen.has("AMBIGUOUS")){
            const hitAt=new Date(b.t).toISOString();
            await createEvent({strategy_version:eventVersion,group_key:k,event_type:"SL",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.stop,entry:setupEntry,stop:rep.stop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.stop),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"SL",closed_at:hitAt});seen.add("SL");createdLevels++;break;
          }
          if(seen.has("TP3")||seen.has("SL")||seen.has("AMBIGUOUS"))break;
        }else{
          const activeStop=n(rep.stop),hardStop=rep.market==="crypto"&&(isLong?b.l<=activeStop:b.h>=activeStop),
            t1=isLong?b.h>=n(rep.tp1):b.l<=n(rep.tp1),newTarget=!seen.has("TP1")&&t1,
            protected1R=isV37Crypto&&!!rep.context?.protection_1r_at,
            reaches1R=isV37Crypto&&setupRisk>0&&(isLong?b.h>=setupEntry+setupRisk:b.l<=setupEntry-setupRisk);
          if(hardStop&&newTarget&&!seen.has("SL")&&!seen.has("AMBIGUOUS")){
            await createEvent({strategy_version:rep.strategy_version,group_key:k,event_type:"AMBIGUOUS",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:b.c,entry:setupEntry,stop:activeStop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              detected_at:new Date(b.t).toISOString(),payload:{bar:b,...setupPayload},status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"AMBIGUOUS",closed_at:new Date(b.t).toISOString()});seen.add("AMBIGUOUS");createdLevels++;break;
          }
          if(isV37Crypto&&!protected1R&&hardStop&&reaches1R&&!seen.has("AMBIGUOUS")){
            await createEvent({strategy_version:rep.strategy_version,group_key:k,event_type:"AMBIGUOUS",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:b.c,entry:setupEntry,stop:activeStop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              detected_at:new Date(b.t).toISOString(),payload:{bar:b,...setupPayload,reason:"same_1m_bar_reached_1R_and_initial_stop"},status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"AMBIGUOUS",closed_at:new Date(b.t).toISOString()});seen.add("AMBIGUOUS");createdLevels++;break;
          }
          if(t1&&!seen.has("TP1")){
            const hitAt=new Date(b.t).toISOString();
            if(config.alert_tp1)await createEvent({strategy_version:rep.strategy_version,group_key:k,event_type:"TP1",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:rep.tp1,entry:setupEntry,stop:activeStop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,rep.tp1),detected_at:hitAt,payload:setupPayload,status:"PENDING"});
            await syncSignals(a.map(x=>x.id),{status:"TP1",hit1:true,hit1_at:hitAt,closed_at:hitAt});
            seen.add("TP1");createdLevels++;break;
          }
          if(hardStop&&!seen.has("SL")&&!seen.has("AMBIGUOUS")){
            const hitAt=new Date(b.t).toISOString(),exitReason=protected1R?"BREAK_EVEN":"STRUCTURAL_SL";
            if(config.alert_sl)await createEvent({strategy_version:rep.strategy_version,group_key:k,event_type:"SL",market:rep.market,symbol:rep.symbol,underlying:rep.underlying,direction:rep.direction,
              signal_time:rep.signal_time,signal_ids:a.map(x=>x.id),price:activeStop,entry:setupEntry,stop:activeStop,tp1:rep.tp1,tp2:rep.tp2,tp3:rep.tp3,
              move_pct:pct(rep.direction,setupEntry,activeStop),detected_at:hitAt,payload:{...setupPayload,exit_reason:exitReason},status:"PENDING"});
            for(const s of a){
              const ctx={...(s.context||{}),exit_reason:exitReason};
              await syncSignals([s.id],{status:"SL",closed_at:hitAt,context:ctx});(s as any).context=ctx;
            }
            seen.add("SL");createdLevels++;break;
          }
          if(isV37Crypto&&!protected1R&&reaches1R&&setupRisk>0){
            const armedAt=new Date(b.t).toISOString();
            for(const s of a){
              const ctx={...(s.context||{}),initial_stop:Number.isFinite(n(s.context?.initial_stop))?n(s.context?.initial_stop):n(s.stop),protection_1r_at:armedAt,protection_stop:setupEntry};
              await syncSignals([s.id],{stop:setupEntry,context:ctx});(s as any).stop=setupEntry;(s as any).context=ctx;
            }
            (rep as any).stop=setupEntry;(rep as any).context={...(rep.context||{}),protection_1r_at:armedAt,protection_stop:setupEntry};
          }
        }
      }
      for(const s of a){
        const start=excursionStart.get(s.id),best=n((s as any).best_r)||0,worst=n((s as any).worst_r)||0;
        if(start&&(best!==start.best||worst!==start.worst))await syncSignals([s.id],{best_r:best,worst_r:worst});
      }
    }

    await sb.from("mtf_alert_config").update({last_watcher_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",1);
    const freshCfg=(await sb.from("mtf_alert_config").select("*").eq("id",1).single()).data||config;
    const delivery=await sendPending(freshCfg);
    return new Response(JSON.stringify({ok:true,strategy_version:STRATEGY_VERSION,since:new Date(since).toISOString(),entryGroups:entryGroups.size,openGroups:openGroups.size,preAlerts,checked,createdLevels,marketLive:liveState,marketGuard,delivery}),{headers:{"content-type":"application/json"}});
  }catch(e){
    console.error(e);
    return new Response(JSON.stringify({ok:false,error:String((e as Error).message||e)}),{status:500,headers:{"content-type":"application/json"}});
  }
});
