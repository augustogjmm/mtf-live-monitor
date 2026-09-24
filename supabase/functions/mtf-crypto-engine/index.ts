import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const VERSION="OB-LADDER-v3.5";
const ENGINE="ANALYZER_CANONICAL_V3_5";
const STABLES=new Set(["USDT","USDC","DAI","FDUSD","TUSD","USDE","PYUSD","USDS","FRAX","USD1","USDD"]);
const FALLBACK=["BTC","ETH","BNB","XRP","SOL","DOGE","ADA","TRX","AVAX","LINK","SUI","XLM","HBAR","BCH","LTC","DOT","UNI","AAVE","NEAR","APT"];
const HOUR=3600000;

type Bar={t:number;o:number;h:number;l:number;c:number;v:number;closeTime?:number};
type OB={origin:number;confirm:number;originTime:number;confirmTime:number;top:number;bottom:number;avg:number};
type DetectorState={os:number;bulls:OB[];bears:OB[];tail:Bar[];processed:number;lastOpen:number|null};
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
async function universe(){
  let eligible=new Set<string>();
  try{const j=await binance("/api/v3/exchangeInfo");for(const x of j?.symbols||[])if(x?.status==="TRADING"&&x?.quoteAsset==="USDT"&&x?.isSpotTradingAllowed!==false)eligible.add(String(x.symbol).toUpperCase())}catch{}
  const out:string[]=[];
  try{
    const j=await fetchJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false",{},15000);
    for(const x of j||[]){const s=String(x.symbol||"").toUpperCase(),p=s+"USDT";if(!s||STABLES.has(s)||out.includes(s)||!eligible.has(p))continue;out.push(s);if(out.length===20)break}
  }catch{}
  for(const s of FALLBACK){if(out.length===20)break;if(!out.includes(s)&&eligible.has(s+"USDT"))out.push(s)}
  if(out.length<20)for(const p of eligible){if(out.length===20)break;const s=p.endsWith("USDT")?p.slice(0,-4):"";if(s&&!STABLES.has(s)&&!out.includes(s))out.push(s)}
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
  const bulls=(st.bulls||[]).slice(0,3).sort((a,b)=>b.avg-a.avg).map((ob,i)=>({rank:i+1,point:ob.avg,side:"below" as const,detectorSide:"bull" as const,ob}));
  const bears=(st.bears||[]).slice(0,3).sort((a,b)=>a.avg-b.avg).map((ob,i)=>({rank:i+1,point:ob.avg,side:"above" as const,detectorSide:"bear" as const,ob}));
  return{referencePrice:price,below:bulls,above:bears,complete:bulls.length===3&&bears.length===3};
}
function publicLevel(x:Level){return{rank:x.rank,point:x.point,side:x.side,detector_side:x.detectorSide,origin_time:x.ob.originTime,confirm_time:x.ob.confirmTime,zone_bottom:x.ob.bottom,zone_top:x.ob.top}}
async function rebuild(sym:string){
  const pair=sym+"USDT",st=emptyState();let start=0,pages=0,last=-1;
  while(pages<160){
    const rows=await klines(pair,"1h",1000,start);if(!rows.length)break;
    const now=Date.now(),closed=rows.filter(x=>(x.closeTime||0)<now);
    for(const b of closed){if(st.lastOpen!=null&&b.t<=st.lastOpen)continue;step(st,b)}
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
    let advanced=false;for(const b of closed){if(st.lastOpen!=null&&b.t<=st.lastOpen)continue;step(st,b);advanced=true}
    pages++;if(!rows.length||rows.length<1000||!advanced)break;start=(st.lastOpen??start)+HOUR;
  }
  if(JSON.stringify(st)!==JSON.stringify(row.state)){
    const {error}=await sb.from("mtf_analyzer_state").update({state:st,updated_at:iso()}).eq("market","crypto").eq("symbol",sym).eq("timeframe","1h");if(error)throw error;
  }
  return st;
}
function ema(vals:number[],period:number){const out:number[]=[],k=2/(period+1);let e:number|null=null;for(const v of vals){e=e==null?v:v*k+e*(1-k);out.push(e)}return out}
function context(b:Bar[]){
  if(b.length<210)return{ready:false,trend:"RANGO"};
  const c=b.map(x=>x.c),e10=ema(c,10),e55=ema(c,55),e200=ema(c,200),fast=ema(c,12),slow=ema(c,26),mac=c.map((_,i)=>fast[i]-slow[i]),sig=ema(mac,9),i=c.length-1;
  const a10=e10[i],a55=e55[i],a200=e200[i],ml=mac[i],ms=sig[i],mh=ml-ms,s55=i>=3?a55-e55[i-3]:0;
  const lr=[c[i]>a10,a10>a55,c[i]>a55,c[i]>a200,ml>ms,mh>=0,s55>=0],sr=[c[i]<a10,a10<a55,c[i]<a55,c[i]<a200,ml<ms,mh<=0,s55<=0];
  const longScore=lr.filter(Boolean).length,shortScore=sr.filter(Boolean).length,trend=longScore-shortScore>=3?"ALCISTA":longScore-shortScore<=-3?"BAJISTA":"RANGO";
  const tr=b.map((x,j)=>j?Math.max(x.h-x.l,Math.abs(x.h-b[j-1].c),Math.abs(x.l-b[j-1].c)):x.h-x.l);let atr=tr.slice(0,14).reduce((a,z)=>a+z,0)/14;for(let j=14;j<tr.length;j++)atr=(atr*13+tr[j])/14;
  const vols=b.slice(-20).map(x=>x.v),vavg=vols.reduce((a,z)=>a+z,0)/Math.max(1,vols.length);
  return{ready:true,trend,close:c[i],ema10:a10,ema55:a55,ema200:a200,macd:ml,signal:ms,histogram:mh,ema55Slope:s55,volumeRatio:vavg>0?b[i].v/vavg:NaN,atr14:atr,longScore,shortScore};
}
function proximity(ladder:any,price:number,atr:number,regulated=false){
  const a:any[]=[];for(const x of ladder?.below||[])a.push({direction:"LONG",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distanceAtr:atr>0?Math.abs(price-x.point)/atr:NaN,in_zone:price>=x.ob.bottom&&price<=x.ob.top});
  if(!regulated)for(const x of ladder?.above||[])a.push({direction:"SHORT",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distanceAtr:atr>0?Math.abs(price-x.point)/atr:NaN,in_zone:price>=x.ob.bottom&&price<=x.ob.top});
  a.sort((x,y)=>x.distance-y.distance);const near=a[0]||null,state=near?.in_zone?"IN_ZONE":Number.isFinite(near?.distanceAtr)&&near.distanceAtr<=1?"NEAR":"WAIT";return{state,thresholdAtr:1,nearest:near,candidates:a};
}
function stopFor(direction:string,ladder:any,atr:number){const a=direction==="LONG"?ladder.below:ladder.above;if(a.length<3)return NaN;const x=a[2],buf=atr>0?atr*.25:Math.abs(x.point)*.0025;return direction==="LONG"?x.ob.bottom-buf:x.ob.top+buf}
function trendRelation(direction:string,trend:string){if(trend==="RANGO")return"RANGO";return(direction==="LONG"&&trend==="ALCISTA")||(direction==="SHORT"&&trend==="BAJISTA")?"A_FAVOR":"CONTRA_TENDENCIA"}

async function snapshotOne(sym:string){
  const row=await loadState(sym);if(!row)return{symbol:sym,ready:false,reason:"detector_not_initialized"};
  const st=await catchup(sym,row),pair=sym+"USDT";
  const [h1,h4,d1]=await Promise.all([klines(pair,"1h",1000),klines(pair,"4h",1000),klines(pair,"1d",1000)]);
  const live=h1[h1.length-1];if(!live)return{symbol:sym,ready:false,reason:"missing_live_1h"};
  const preview=clone(st);if(st.lastOpen==null||live.t>st.lastOpen)step(preview,live);
  const ladder=ladderFromState(preview,live.c),c1=context(h1),c4=context(h4),cd=context(d1);
  if(!c1.ready||!c4.ready||!cd.ready)return{symbol:sym,ready:false,reason:"context_insufficient",ladder};
  const trends=[c1.trend,c4.trend,cd.trend],bull=trends.filter(x=>x==="ALCISTA").length,bear=trends.filter(x=>x==="BAJISTA").length,macro=bull>=2?"ALCISTA":bear>=2?"BAJISTA":"RANGO";
  const prox=proximity(ladder,live.c,c1.atr14,false);
  return{symbol:sym,pair,ready:ladder.complete,reason:ladder.complete?null:"less_than_3x3_active_obs",price:live.c,live1h:{t:live.t,h:live.h,l:live.l,c:live.c},historyProcessed:st.processed,
    ladder:{reference_price:live.c,below:ladder.below.map(publicLevel),above:ladder.above.map(publicLevel)},
    context:c1,macroContext:{trend:macro,h1:c1,h4:c4,d1:cd},proximity:prox,stops:{LONG:stopFor("LONG",ladder,c1.atr14),SHORT:stopFor("SHORT",ladder,c1.atr14)},generatedAt:iso()};
}
async function structure(){
  let base=await universe();
  const [{data:openRows,error:openErr},{data:prevStructure,error:prevStructErr}]=await Promise.all([
    sb.from("mtf_signals").select("symbol").eq("strategy_version",VERSION).eq("market","crypto").in("source",["FORWARD","MIGRATED_STRICT"]).in("status",["OPEN","TP1","TP2"]),
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
  const carried=[...new Set((openRows||[]).map((x:any)=>String(x.symbol||"").toUpperCase()).filter(Boolean))].filter((s:string)=>!base.includes(s));
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
  const {data,error}=await sb.from("mtf_signals").select("*").eq("strategy_version",VERSION).eq("market","crypto").eq("symbol",sym).in("status",["OPEN","TP1","TP2"]).order("signal_time");if(error)throw error;return data||[];
}
async function insertLeg(row:any){
  const {data,error}=await sb.from("mtf_signals").insert({...row,strategy_version:VERSION,status:"OPEN",best_r:0,worst_r:0,hit1:false,hit2:false,hit3:false,created_at:iso(),updated_at:iso()}).select("*").single();
  if(error){if(String((error as any)?.code)==="23505")return null;throw error}return data;
}
function setupId(sym:string,dir:string,when:number){return[VERSION,"crypto",sym,dir,Math.floor(when/60000)].join(":")}
function signalFromLevel(sym:string,dir:string,level:Level,snap:any,id:string,bar:Bar){
  const entries=(dir==="LONG"?snap.ladder.below:snap.ladder.above).map(levelFromPublic),targets=(dir==="LONG"?snap.ladder.above:snap.ladder.below).map(levelFromPublic);
  if(entries.length<3||targets.length<3)return null;
  const stop=n(snap.stops?.[dir]);if(!Number.isFinite(stop))return null;
  const eventTime=n(bar.closeTime)||bar.t+60000;
  return{market:"crypto",symbol:sym,underlying:sym,direction:dir,signal_time:iso(eventTime),entry:level.point,stop,tp1:targets[0].point,tp2:targets[1].point,tp3:targets[2].point,source:"FORWARD",
    context:{strategy_version:VERSION,engine:ENGINE,setup_id:id,entry_rank:level.rank,operational_timeframe:"1h",trigger_timeframe:"1m",trigger_basis:"entry_only_when_1m_range_crosses_exact_OB_center_line",
      entry_level:publicLevel(level),ob_key:"1h:"+dir+":"+level.ob.originTime,
      ladder_snapshot:snap.ladder,context:snap.context,macro_context:snap.macroContext,trend_relation:trendRelation(dir,snap.macroContext?.trend||"RANGO"),proximity:snap.proximity,
      trigger_bar:{t:bar.t,closeTime:eventTime,h:bar.h,l:bar.l,c:bar.c},stop_basis:"beyond_entry_3_zone_plus_0_25_ATR"}};
}
async function live(createEntries=true){
  const [{data:st,error:stErr},{data:prevRow,error:prevErr}]=await Promise.all([
    sb.from("mtf_state").select("*").eq("market","crypto_structure").maybeSingle(),
    sb.from("mtf_state").select("*").eq("market","crypto_live").maybeSingle()
  ]);
  if(stErr)throw stErr;if(prevErr)throw prevErr;
  const snaps:any[]=st?.meta?.snapshot||[];if(!snaps.length)return{ready:false,reason:"missing_structure_snapshot"};
  const prevMap=new Map<string,any>((prevRow?.meta?.snapshot||[]).map((x:any)=>[String(x.symbol),x]));
  const prices=await currentPrices(),liveStates:any[]=[],created:any[]=[];
  for(const snap0 of snaps){
    const sym=String(snap0.symbol),pair=sym+"USDT",prev=prevMap.get(sym)||null;
    if(!snap0.ready){
      liveStates.push({symbol:sym,state:"NO_ANALYSIS",reason:snap0.reason,last_bar_close:n(prev?.last_bar_close)||null,updated_at:iso()});
      continue;
    }
    const price=prices.get(pair)??n(snap0.price),
      ladder={below:(snap0.ladder?.below||[]).map(levelFromPublic),above:(snap0.ladder?.above||[]).map(levelFromPublic)},
      atr=n(snap0.context?.atr14),prox=proximity(ladder,price,atr,false);
    let opens=await openSignals(sym),freshBars:Bar[]=[];
    const previousObserved=!!prev;
    let lastSeen=n(prev?.last_bar_close);
    if(!(lastSeen>0)&&prev?.updated_at)lastSeen=Math.max(0,new Date(prev.updated_at).getTime()-60000);
    try{
      const now=Date.now(),
            start=lastSeen>0?Math.max(0,lastSeen+1):now-5*60000,
            m=await klines(pair,"1m",1000,start);
      freshBars=m.filter((b:Bar)=>{
        const ct=n(b.closeTime)||b.t+60000;
        return ct<now-250 && (!(lastSeen>0)||ct>lastSeen);
      }).sort((a:Bar,b:Bar)=>(n(a.closeTime)||a.t+60000)-(n(b.closeTime)||b.t+60000));
    }catch{}

    for(const bar of freshBars){
      const barClose=n(bar.closeTime)||bar.t+60000;
      if(opens.length){
        const anchor=opens[0],ctx=anchor.context||{},dir=String(anchor.direction),
          raw=dir==="LONG"?(ctx.ladder_snapshot?.below||[]):(ctx.ladder_snapshot?.above||[]);
        if(!["TP1","TP2"].includes(String(anchor.status))){
          const used=new Set(opens.map((x:any)=>n(x.context?.entry_rank)));
          for(const p of raw){
            const lv=levelFromPublic(p);
            if(used.has(lv.rank)||!touched(bar,lv))continue;
            const row=signalFromLevel(sym,dir,lv,{
              ladder:ctx.ladder_snapshot,stops:{[dir]:anchor.stop},context:ctx.context,
              macroContext:ctx.macro_context,proximity:prox
            },String(ctx.setup_id),bar);
            if(row){
              row.stop=anchor.stop;row.tp1=anchor.tp1;row.tp2=anchor.tp2;row.tp3=anchor.tp3;
              const ins=await insertLeg(row);
              if(ins){opens.push(ins);used.add(lv.rank);created.push({symbol:sym,direction:dir,rank:lv.rank,setup_id:ctx.setup_id,bar_close:barClose})}
            }
          }
        }
      }else if(createEntries&&previousObserved){
        const longs=ladder.below.filter((x:Level)=>touched(bar,x)),shorts=ladder.above.filter((x:Level)=>touched(bar,x));
        if(!(longs.length&&shorts.length)){
          const dir=longs.length?"LONG":shorts.length?"SHORT":null;
          if(dir){
            const fresh=await snapshotOne(sym);
            if(fresh.ready){
              const fl={below:(fresh.ladder.below||[]).map(levelFromPublic),above:(fresh.ladder.above||[]).map(levelFromPublic)},
                ft=(dir==="LONG"?fl.below:fl.above).filter((x:Level)=>touched(bar,x));
              if(ft.length){
                const id=setupId(sym,dir,barClose);
                for(const lv of ft){
                  const row=signalFromLevel(sym,dir,lv,fresh,id,bar);
                  if(row){const ins=await insertLeg(row);if(ins){opens.push(ins);created.push({symbol:sym,direction:dir,rank:lv.rank,setup_id:id,bar_close:barClose})}}
                }
              }
            }
          }
        }
      }
      lastSeen=Math.max(lastSeen||0,barClose);
    }

    liveStates.push({
      symbol:sym,price,state:opens.length?"OPEN":prox.state,proximity:prox,open_count:opens.length,
      setup_id:opens[0]?.context?.setup_id||null,direction:opens[0]?.direction||null,
      last_bar_close:lastSeen>0?lastSeen:(n(prev?.last_bar_close)||null),
      baseline:!createEntries,updated_at:iso()
    });
  }
  const meta={strategy_version:VERSION,engine:ENGINE,generated_at:iso(),baseline:!createEntries,snapshot:liveStates};
  const {error}=await sb.from("mtf_state").upsert({
    market:"crypto_live",last_processed_at:iso(),last_run_at:iso(),meta,updated_at:iso()
  },{onConflict:"market"});if(error)throw error;
  return{ready:true,baseline:!createEntries,created:created.length,created_signals:created,states:liveStates.length};
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