import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENGINE_PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
async function authorizedEngineRequest(req: Request) {
  if (!SERVICE_ROLE || !SUPABASE_URL) return false;
  const authorization = req.headers.get("authorization") || "";
  if (authorization === `Bearer ${SERVICE_ROLE}`) return true;
  if (!authorization.startsWith("Bearer ") || !ENGINE_PUBLIC_KEY) return false;
  try {
    const encoded = authorization.slice(7).split(".")[1];
    const claims = JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")));
    // This is only a prefilter. PostgREST must verify the signature and role.
    if (claims.role !== "service_role") return false;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mtf_engine_auth_status`, {
      method: "POST", headers: {apikey: ENGINE_PUBLIC_KEY, authorization,
        "content-type": "application/json"}, body: "{}", signal: AbortSignal.timeout(5000)
    });
    return response.ok && await response.json() === true;
  } catch { return false; }
}

const sb=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});

const VERSION="ADR-OB-v1.0";
const ENGINE="ADR_DW_15M_RECOVERY_V1";
const MIN_RR=1.8;
const WICK_MIN=0.20;
const CHASE_ATR=0.25;
const CHUNK=14;
const ADRS:{symbol:string;underlying:string}[]=[
 {symbol:"GGAL",underlying:"GGAL"},{symbol:"YPFD",underlying:"YPF"},{symbol:"PAMP",underlying:"PAM"},
 {symbol:"BMA",underlying:"BMA"},{symbol:"SUPV",underlying:"SUPV"},{symbol:"BBAR",underlying:"BBAR"},
 {symbol:"CEPU",underlying:"CEPU"},{symbol:"EDN",underlying:"EDN"},{symbol:"TGSU2",underlying:"TGS"},
 {symbol:"TECO2",underlying:"TEO"},{symbol:"LOMA",underlying:"LOMA"},{symbol:"CRES",underlying:"CRESY"},
 {symbol:"IRSA",underlying:"IRS"},{symbol:"VIST",underlying:"VIST"}
];

type Bar={t:number;o:number;h:number;l:number;c:number;v:number};
type OB={origin:number;confirm:number;originTime:number;confirmTime:number;top:number;bottom:number;avg:number};
type Level={rank:number;point:number;ob:OB};

const n=(v:any)=>{if(v===null||v===undefined||v==="")return NaN;const x=Number(v);return Number.isFinite(x)?x:NaN};
const avg=(a:number[])=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN};
const iso=(t=Date.now())=>new Date(t).toISOString();

async function fetchJson(url:string,timeout=18000){
 const c=new AbortController(),tm=setTimeout(()=>c.abort(),timeout);
 try{
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0","accept":"application/json"},signal:c.signal});
  if(!r.ok)throw new Error("HTTP "+r.status+" "+url);
  return await r.json();
 }finally{clearTimeout(tm)}
}
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
function atr(b:Bar[],p=14){
 const tr=b.map((x,i)=>i?Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)):x.h-x.l),
       o:(number|null)[]=Array(tr.length).fill(null);
 if(tr.length<p)return o;let a=tr.slice(0,p).reduce((x,y)=>x+y,0)/p;o[p-1]=a;
 for(let i=p;i<tr.length;i++){a=(a*(p-1)+tr[i])/p;o[i]=a;}return o;
}
function numericVolume(b:Bar){const v=Number(b?.v);return Number.isFinite(v)?v:0}
function obMax(a:Bar[],s:number,e:number,k:"h"|"l"){let v=-Infinity;for(let i=s;i<=e;i++)if(a[i][k]>v)v=a[i][k];return v}
function obMin(a:Bar[],s:number,e:number,k:"h"|"l"){let v=Infinity;for(let i=s;i<=e;i++)if(a[i][k]<v)v=a[i][k];return v}
function volumePivot(a:Bar[],confirm:number,piv=5){
 const p=confirm-piv,l=p-piv;if(l<0)return false;const v=numericVolume(a[p]);
 for(let i=l;i<=confirm;i++)if(i!==p&&!(v>numericVolume(a[i])))return false;return true;
}
function mitigateObs(arr:OB[],target:number,bull:boolean){for(let i=arr.length-1;i>=0;i--)if(bull?target<arr[i].bottom:target>arr[i].top)arr.splice(i,1)}
function analyzerOrderBlocks(a:Bar[],limit=6){
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
 if(!b.length)return{ready:false,net:0};
 const closes=b.map(x=>x.c),e10=emaAnalyzer(closes,10),e55=emaAnalyzer(closes,55),e200=emaAnalyzer(closes,200),m=macdAnalyzer(closes),i=closes.length-1,
       c=closes[i],a10=n(e10[i]),a55=n(e55[i]),a200=n(e200[i]),ml=n(m.line[i]),ms=n(m.signal[i]),mh=n(m.hist[i]),
       s55=i>=3&&e55[i-3]!=null?a55-n(e55[i-3]):0,
       longRules=[c>a10,a10>a55,c>a55,Number.isFinite(a200)?c>a200:true,ml>ms,mh>=0,s55>=0],
       shortRules=[c<a10,a10<a55,c<a55,Number.isFinite(a200)?c<a200:true,ml<ms,mh<=0,s55<=0],
       longScore=longRules.filter(Boolean).length,shortScore=shortRules.filter(Boolean).length,
       vols=b.slice(-20).map(numericVolume).filter(v=>v>0),vavg=vols.length?avg(vols):NaN,
       volumeRatio=Number.isFinite(vavg)&&vavg>0?numericVolume(b[i])/vavg:NaN;
 return{ready:b.length>=55,longScore,shortScore,net:longScore-shortScore,close:c,ema10:a10,ema55:a55,ema200:a200,macd:ml,signal:ms,histogram:mh,ema55Slope:s55,volumeRatio,longRules,shortRules};
}
function contextOnly(b:Bar[]){
 const x:any=tfAnalyzer(b),trend=x.net>=3?"ALCISTA":x.net<=-3?"BAJISTA":"RANGO",a=atr(b,14);
 return{...x,trend,atr14:n(a[a.length-1])};
}
function weekKey(t:number){const d=new Date(t),day=(d.getUTCDay()+6)%7,monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));return monday.toISOString().slice(0,10)}
function weeksFromDaily(d:Bar[]):Bar[]{
 const groups=new Map<string,Bar[]>();for(const b of d){const k=weekKey(b.t);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(b);}
 const keys=[...groups.keys()].sort(),out:Bar[]=[],currentWeek=weekKey(Date.now());
 for(let i=0;i<keys.length;i++){
  const g=groups.get(keys[i])!,last=g[g.length-1],isLast=i===keys.length-1,weekday=new Date(last.t).getUTCDay();
  if(isLast&&keys[i]===currentWeek&&weekday<5)continue;
  out.push({t:last.t,o:g[0].o,h:Math.max(...g.map(v=>v.h)),l:Math.min(...g.map(v=>v.l)),c:last.c,v:g.reduce((s,v)=>s+v.v,0)});
 }
 return out;
}
function publicLevel(x:Level){return{rank:x.rank,point:x.point,origin_time:x.ob.originTime,confirm_time:x.ob.confirmTime,zone_bottom:x.ob.bottom,zone_top:x.ob.top,detector_side:"bull"}}
function publicBear(x:Level){return{rank:x.rank,point:x.point,origin_time:x.ob.originTime,confirm_time:x.ob.confirmTime,zone_bottom:x.ob.bottom,zone_top:x.ob.top,detector_side:"bear"}}

async function yahooChart(symbol:string,interval:string,range:string){
 const hosts=["https://query1.finance.yahoo.com","https://query2.finance.yahoo.com"];let last:any;
 for(const host of hosts){try{
  const j=await fetchJson(host+"/v8/finance/chart/"+encodeURIComponent(symbol)+"?interval="+interval+"&range="+range+"&includePrePost=false&events=div%2Csplits"),
        z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{},ts=z?.timestamp||[];
  if(!z||!ts.length)throw new Error("Yahoo sin datos "+symbol+" "+interval);
  const bars:Bar[]=[];
  for(let i=0;i<ts.length;i++){
   const c=n(q.close?.[i]),o=n(q.open?.[i]),h=n(q.high?.[i]),l=n(q.low?.[i]),v=n(q.volume?.[i]);
   if(!(c>0)||!Number.isFinite(h)||!Number.isFinite(l))continue;
   bars.push({t:ts[i]*1000,o:Number.isFinite(o)?o:c,h,l,c,v:Number.isFinite(v)?v:0});
  }
  return{bars,meta:z.meta||{}};
 }catch(e){last=e}}
 throw last||new Error("Yahoo error "+symbol);
}
async function yahooDaily(symbol:string){
 const raw=await yahooChart(symbol,"1d","5y");let out=[...raw.bars];
 const end=n(raw.meta?.currentTradingPeriod?.regular?.end)*1000,last=out.at(-1);
 if(last&&end>0&&Date.now()<end+5*60*1000)out=out.slice(0,-1);
 if(out.length<80)throw new Error("histórico diario insuficiente "+symbol);
 return out;
}
async function yahoo15m(symbol:string){
 const raw=await yahooChart(symbol,"15m","5d"),now=Date.now();
 const out=raw.bars.filter(b=>b.t+15*60*1000<=now-60*1000);
 if(!out.length)throw new Error("sin velas 15m cerradas "+symbol);
 return out;
}
async function usaOpen(){
 const {data,error}=await sb.from("mtf_state").select("meta,last_run_at").eq("market","market_guard").maybeSingle();
 if(error)return false;const age=data?.last_run_at?Date.now()-new Date(data.last_run_at).getTime():Infinity;
 return age<180000&&String(data?.meta?.usa?.code||"").toUpperCase()==="OPEN";
}
function diagnostic(daily:Bar[],price:number){
 const d=contextOnly(daily),weeklyBars=weeksFromDaily(daily),w=contextOnly(weeklyBars);
 if(!d.ready||!w.ready)return{ready:false,reason:"context_not_mature"};
 const obs=analyzerOrderBlocks(daily,6),
       bulls=obs.bulls.map((ob,i)=>({rank:i+1,point:ob.avg,ob})).sort((a,b)=>Math.abs(price-a.point)-Math.abs(price-b.point)),
       bears=obs.bears.map((ob,i)=>({rank:i+1,point:ob.avg,ob})).sort((a,b)=>a.point-b.point),
       atr14=n(d.atr14),
       candidates=bulls.map(x=>({direction:"LONG",rank:x.rank,point:x.point,zone_bottom:x.ob.bottom,zone_top:x.ob.top,distance:Math.abs(price-x.point),distance_atr:atr14>0?Math.abs(price-x.point)/atr14:NaN,in_zone:price>=x.ob.bottom&&price<=x.ob.top})).sort((a,b)=>a.distance-b.distance),
       nearest=candidates[0]||null,
       proximity={state:nearest?.in_zone?"IN_ZONE":Number.isFinite(nearest?.distance_atr)&&nearest.distance_atr<=1?"NEAR":"WAIT",threshold_atr:1,nearest,candidates};
 return{ready:true,context:d,macroContext:{trend:w.trend,d1:d,w1:w,dominant_timeframe:"1w"},ladder:{reference_price:price,below:bulls.map(publicLevel),above:bears.map(publicBear),complete:bulls.length>=1&&bears.length>=1,exact_analyzer:true},raw:{bulls,bears},proximity,entry_allowed:d.trend==="ALCISTA"&&w.trend==="ALCISTA"};
}
function confirmationPlan(bar:Bar,diag:any){
 if(!diag?.entry_allowed)return null;
 const atr14=n(diag?.context?.atr14);if(!(atr14>0))return null;
 const range=Math.max(1e-12,bar.h-bar.l),lowerWick=(Math.min(bar.o,bar.c)-bar.l)/range;
 const candidates:(any[])=(diag?.raw?.bulls||[]).slice().sort((a:any,b:any)=>a.rank-b.rank);
 for(const level of candidates){
  const ob=level.ob as OB,overlap=bar.l<=ob.top&&bar.h>=ob.bottom,crossCenter=bar.l<=level.point&&bar.c>level.point,
        bullish=bar.c>bar.o,wickOk=lowerWick>=WICK_MIN,chaseOk=bar.c<=ob.top+CHASE_ATR*atr14;
  if(!(overlap&&crossCenter&&bullish&&wickOk&&chaseOk))continue;
  const entry=bar.c,invalidation=ob.bottom-0.25*atr14,risk=entry-invalidation;if(!(risk>0))continue;
  const targets=(diag?.raw?.bears||[]).filter((x:any)=>x.point>entry).sort((a:any,b:any)=>a.point-b.point);
  if(!targets.length)continue;
  const tp1=targets[0].point,reward=tp1-entry,rr=reward/risk;if(!(reward>0&&rr>=MIN_RR))continue;
  return{level,entry,invalidation,tp1,tp2:targets[1]?.point??null,tp3:targets[2]?.point??null,rr,lowerWick,bar};
 }
 return null;
}
async function openFor(symbol:string){
 const {data,error}=await sb.from("mtf_signals").select("*").eq("market","merval").eq("symbol",symbol)
  .in("strategy_version",["OB-LADDER-v3.6",VERSION]).eq("source","FORWARD").eq("status","OPEN").order("signal_time");
 if(error)throw error;return data||[];
}
async function insertPlan(symbol:string,underlying:string,diag:any,plan:any){
 const already=await openFor(symbol);if(already.length)return null;
 const setupId=[VERSION,"merval",symbol,"LONG","15m",String(plan.level.ob.originTime),String(plan.bar.t)].join(":");
 const context={
  strategy_version:VERSION,engine:ENGINE,setup_id:setupId,entry_rank:1,operational_timeframe:"15m_execution_daily_structure",
  pricing_method:"ADR",entry_policy:"D1_ALCISTA_AND_W1_ALCISTA_plus_closed_15m_OB_recovery_confirmation_plus_RR",
  trigger_basis:"closed_15m_bar_overlaps_daily_bullish_OB_crosses_center_and_closes_back_above_with_bullish_rejection",
  daily_weekly_policy:"both_must_be_ALCISTA",intraday_role:"execution_confirmation_only_not_directional_trend",
  stop_policy:"REFERENCE_ONLY_NO_AUTO_EXIT",exit_policy:"TP1_FINAL",minimum_rr:MIN_RR,planned_rr:plan.rr,
  initial_stop:plan.invalidation,technical_invalidation:plan.invalidation,wick_ratio:plan.lowerWick,
  order_block:plan.level.ob,entry_level:publicLevel(plan.level),
  ladder_snapshot:diag.ladder,context:diag.context,macro_context:diag.macroContext,trend_relation:"A_FAVOR",risk_profile:"CONFIRMED",
  confirmation_bar:{t:plan.bar.t,o:plan.bar.o,h:plan.bar.h,l:plan.bar.l,c:plan.bar.c},
  one_entry_per_asset:true
 };
 const {data,error}=await sb.from("mtf_signals").insert({
  market:"merval",symbol,underlying,direction:"LONG",signal_time:iso(plan.bar.t+15*60*1000),entry:plan.entry,stop:plan.invalidation,
  tp1:plan.tp1,tp2:plan.tp2,tp3:plan.tp3,source:"FORWARD",strategy_version:VERSION,status:"OPEN",
  best_r:0,worst_r:0,hit1:false,hit2:false,hit3:false,context,updated_at:iso()
 }).select("*").single();
 if(error){if(String((error as any)?.code||"")==="23505")return null;throw error}return data;
}
function compactAuditContext(context:any){
 const d=context?.diagnostic||context?.diag||null,nearest=d?.proximity?.nearest||null;
 return{
  ...(context||{}),
  ...(d?{diagnostic:{
    ready:d.ready!==false,reason:d.reason||null,entry_allowed:d.entry_allowed??null,
    trend:d?.context?.trend||null,weeklyTrend:d?.macroContext?.w1?.trend||d?.macroContext?.trend||null,
    proximity:d.proximity?{state:d.proximity.state||null,nearest:nearest?{rank:nearest.rank??null,point:n(nearest.point),distance_atr:n(nearest.distance_atr??nearest.distanceAtr),in_zone:!!nearest.in_zone}:null}:null
  }}:{})
 };
}
async function audit(cycleId:string,symbol:string,underlying:string,signalTime:number,decision:string,reason:string,context:any){
 const compact=compactAuditContext(context);
 if(compact.diag)delete compact.diag;
 const {error}=await sb.from("mtf_decision_audit").upsert({
  strategy_version:VERSION,cycle_id:cycleId,market:"merval",symbol,underlying,direction:"LONG",signal_time:iso(signalTime),
  evaluated_at:iso(),decision,reason,context:compact
 },{onConflict:"strategy_version,cycle_id,market,symbol,signal_time"});
 if(error)throw error;
}
function selftest(){
 const ob:OB={origin:1,confirm:2,originTime:1000,confirmTime:2000,bottom:90,top:100,avg:95},
       bear=(point:number):any=>({rank:1,point,ob:{origin:3,confirm:4,originTime:3000,confirmTime:4000,bottom:point-1,top:point+1,avg:point}}),
       base:any={entry_allowed:true,context:{atr14:4},raw:{bulls:[{rank:1,point:95,ob}],bears:[bear(112)]}},
       valid:Bar={t:5000,o:94,h:99,l:92,c:97,v:100},
       poorWick:Bar={t:5000,o:94.8,h:99,l:94.5,c:97,v:100},
       chase:Bar={t:5000,o:94,h:104,l:92,c:103,v:100};
 const good=confirmationPlan(valid,base),
       blocked=confirmationPlan(valid,{...base,entry_allowed:false}),
       wick=confirmationPlan(poorWick,base),
       lowRR=confirmationPlan(valid,{...base,raw:{...base.raw,bears:[bear(104)]}}),
       chased=confirmationPlan(chase,base);
 const tests=[
  {name:"valid_confirmation_passes",ok:!!good&&good.rr>=MIN_RR},
  {name:"context_blocked_rejected",ok:blocked===null},
  {name:"poor_wick_rejected",ok:wick===null},
  {name:"low_rr_rejected",ok:lowRR===null},
  {name:"chase_rejected",ok:chased===null},
  {name:"technical_invalidation_reference",ok:!!good&&Math.abs(good.invalidation-89)<1e-9},
  {name:"entry_is_confirmation_close",ok:!!good&&good.entry===valid.c},
  {name:"target_is_nearest_bearish_ob",ok:!!good&&good.tp1===112}
 ];
 return{ok:tests.every(x=>x.ok),strategy_version:VERSION,engine:ENGINE,tests,passed:tests.filter(x=>x.ok).length,total:tests.length};
}
async function pool<T,R>(a:T[],limit:number,fn:(x:T)=>Promise<R>){let i=0;const o:(R|null)[]=new Array(a.length).fill(null);await Promise.all(Array.from({length:Math.min(limit,a.length)},async()=>{while(i<a.length){const j=i++;try{o[j]=await fn(a[j])}catch(_){o[j]=null}}}));return o}

function forwardConfirmation(bar:Bar,lastSeen:number,now:number){
 const close=bar.t+15*60000,age=now-close;
 return Number.isFinite(lastSeen)&&lastSeen>0&&bar.t>lastSeen&&
   Number.isFinite(age)&&age>=0&&age<=20*60000&&
   [bar.o,bar.h,bar.l,bar.c].every(v=>typeof v==="number"&&Number.isFinite(v))&&
   bar.l>0&&bar.h>=Math.max(bar.o,bar.c)&&bar.l<=Math.min(bar.o,bar.c);
}
async function run(mode:"baseline"|"live"){
 const cycleId="adr:"+iso();
 const marketOpen=await usaOpen();if(mode==="live"&&!marketOpen)return{ok:true,strategy_version:VERSION,engine:ENGINE,skipped:"usa_not_open"};
 const {data:state,error:stateError}=await sb.from("mtf_state").select("meta").eq("market","adr_live").maybeSingle();
 if(stateError)throw stateError;
 const prev:any[]=state?.meta?.snapshot||[],prevMap=new Map(prev.map((x:any)=>[String(x.symbol),x])),
       cursor=Math.max(0,Math.floor(n(state?.meta?.cursor)||0))%ADRS.length,
       batch=mode==="baseline"?ADRS:Array.from({length:Math.min(CHUNK,ADRS.length)},(_,i)=>ADRS[(cursor+i)%ADRS.length]),
       nextCursor=mode==="baseline"?0:(cursor+batch.length)%ADRS.length,
       funnel:any={assets:ADRS.length,scanned:0,ready:0,dw_bullish:0,near_or_zone:0,confirmation_bars:0,rejection_pass:0,target_pass:0,rr_pass:0,entries:0},
       created:any[]=[],errors:any[]=[];
 const results=await pool(batch,2,async(item)=>{
  const prevRow=prevMap.get(item.symbol)||null;funnel.scanned++;
  try{
   const [daily,intra]=await Promise.all([yahooDaily(item.underlying),yahoo15m(item.underlying)]),last=intra.at(-1)!,
         diag:any=diagnostic(daily,last.c);if(!diag.ready)throw new Error(diag.reason||"not_ready");
   funnel.ready++;if(diag.entry_allowed)funnel.dw_bullish++;if(["NEAR","IN_ZONE"].includes(diag.proximity.state))funnel.near_or_zone++;
   const active=await openFor(item.symbol),lastSeen=mode==="baseline"?last.t:n(prevRow?.last_processed_15m),
         fresh=mode==="baseline"?[]:intra.filter(b=>forwardConfirmation(b,lastSeen,Date.now())),plans:any[]=[];
   for(const b of fresh){
    funnel.confirmation_bars++;const p=confirmationPlan(b,diagnostic(daily,b.c));if(!p)continue;
    funnel.rejection_pass++;funnel.target_pass++;funnel.rr_pass++;plans.push(p);
   }
   let inserted:any=null;
   if(mode==="live"&&!active.length&&plans.length){inserted=await insertPlan(item.symbol,item.underlying,diagnostic(daily,plans[0].entry),plans[0]);if(inserted){created.push({symbol:item.symbol,underlying:item.underlying,entry:inserted.entry,tp1:inserted.tp1,rr:inserted.context?.planned_rr});funnel.entries++;}}
   const operational=inserted?[inserted]:active,latestPlan=plans.at(-1)||null;
   const stateName=operational.length?"OPEN":diag.entry_allowed?diag.proximity.state:"BLOCKED";
   const reason=operational.length?null:!diag.entry_allowed?"context_requires_daily_and_weekly_bullish":latestPlan?"confirmed_waiting_insert":"waiting_15m_recovery_confirmation";
   await audit(cycleId,item.symbol,item.underlying,last.t,inserted?"ENTRY":"NO_ENTRY",inserted?"confirmed_15m_recovery_rr_pass":reason,{diagnostic:diag,latest_plan:latestPlan?{rr:latestPlan.rr,entry:latestPlan.entry,tp1:latestPlan.tp1,bar:latestPlan.bar}:null});
   return{ok:true,ready:true,market:"merval",symbol:item.symbol,underlying:item.underlying,name:"",price:last.c,t:last.t,source:"Yahoo 15m USD",
    state:stateName,reason,actionable:diag.entry_allowed&&!operational.length,entry_allowed:diag.entry_allowed,confirmation_required:true,
    confirmation_state:latestPlan?"CONFIRMED":"WAITING",planned_rr:latestPlan?.rr??null,technical_invalidation:latestPlan?.invalidation??null,
    proximity:diag.proximity,ladder:diag.ladder,context:diag.context,macroContext:diag.macroContext,stops:{LONG:latestPlan?.invalidation??null},
    stop_policy:"REFERENCE_ONLY_NO_AUTO_EXIT",exit_policy:"TP1_FINAL",open_count:operational.length,
    setup_id:operational[0]?.context?.setup_id||null,direction:operational[0]?.direction||null,active_strategy_version:operational[0]?.strategy_version||null,
    last_processed_15m:last.t,engine:ENGINE,strategy_version:VERSION};
  }catch(e){const msg=String((e as Error).message||e);errors.push({symbol:item.symbol,error:msg});return{ok:false,ready:false,market:"merval",symbol:item.symbol,underlying:item.underlying,state:"NO_ANALYSIS",reason:msg,last_processed_15m:n(prevRow?.last_processed_15m)||0,strategy_version:VERSION,engine:ENGINE}}
 });
 const merged=new Map<string,any>(prev.map((x:any)=>[String(x.symbol),x]));for(const r of results)if(r)merged.set(String((r as any).symbol),r);
 const snapshot=[...merged.values()].filter((x:any)=>ADRS.some(a=>a.symbol===x.symbol));
 const {error:saveError}=await sb.from("mtf_state").upsert({market:"adr_live",last_processed_at:iso(),last_run_at:iso(),meta:{
  strategy_version:VERSION,engine:ENGINE,baseline:mode==="baseline",generated_at:iso(),snapshot,cursor:nextCursor,
  universe_size:ADRS.length,chunk_size:mode==="baseline"?ADRS.length:CHUNK,funnel,certification_schema:"ADR_CERT_V1"
 },updated_at:iso()},{onConflict:"market"});
 if(saveError)throw saveError;
 return{ok:true,strategy_version:VERSION,engine:ENGINE,mode,market_open:marketOpen,created:created.length,created_signals:created,funnel,errors};
}

Deno.serve(async(req:Request)=>{
 if (!(await authorizedEngineRequest(req))){
  return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
 }
 try{
  const body=await req.json().catch(()=>({})),raw=String(body?.mode||"live").toLowerCase();
  if(raw==="selftest")return new Response(JSON.stringify(selftest()),{headers:{"content-type":"application/json"}});
  const mode=raw==="baseline"?"baseline":"live";
  return new Response(JSON.stringify(await run(mode as "baseline"|"live")),{headers:{"content-type":"application/json"}});
 }catch(e){
  return new Response(JSON.stringify({ok:false,strategy_version:VERSION,error:String((e as Error).message||e)}),{status:500,headers:{"content-type":"application/json"}});
 }
});
