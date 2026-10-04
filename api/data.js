const BYMA='https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';
const MAP={B:'GOLD','BA.C':'BAC',BRKB:'BRK-B',BRKA:'BRK-A',DISN:'DIS',TRVV:'TRV',UN:'NU',NOKA:'NOK',KOFM:'KOF','AKO.B':'AKO-B',ADGO:'AGRO',BNG:'BG',TXR:'TX',XROX:'XRX',BPA11:'BPAC11.SA'};
const BRAZIL_ORIGIN=new Set(['VALE3','PETR3','BBDC3','MGLU3','ITUB3','PRIO3','BBAS3','RENT3','SUZB3','ABEV3','HAPV3','LREN3','CSNA3','NATU3','WEGE3','SBSP3','VIVT3','TIMS3']);
const MERVAL_ADR={GGAL:'GGAL',YPFD:'YPF',PAMP:'PAM',BMA:'BMA',SUPV:'SUPV',BBAR:'BBAR',CEPU:'CEPU',EDN:'EDN',TGSU2:'TGS',TECO2:'TEO',LOMA:'LOMA',CRES:'CRESY',IRSA:'IRS',VIST:'VIST'};
const MERVAL_FAVORITES=new Set(['GGAL','YPFD','PAMP','BMA','SUPV','BBAR','CEPU','EDN','TGSU2','TECO2','LOMA','CRES','IRSA','VIST','TXAR','ALUA','BYMA','COME','VALO']);
const MERVAL_NAMES={GGAL:'Grupo Financiero Galicia',YPFD:'YPF',PAMP:'Pampa Energía',BMA:'Banco Macro',SUPV:'Grupo Supervielle',BBAR:'BBVA Argentina',CEPU:'Central Puerto',EDN:'Edenor',TGSU2:'Transportadora de Gas del Sur',TECO2:'Telecom Argentina',LOMA:'Loma Negra',CRES:'Cresud',IRSA:'IRSA',VIST:'Vista Energy',TXAR:'Ternium Argentina',ALUA:'Aluar',BYMA:'Bolsas y Mercados Argentinos',COME:'Sociedad Comercial del Plata',VALO:'Grupo Financiero Valores'};
const SB_URL='https://swhfftkhqmbtmbnoskoj.supabase.co';
const SB_ANON='sb_publishable_EbjOQ0SprPfdKLTQ6zER0w_DGsf128M';
const CACHE_TTL=10*60*1000;
let universeCache={at:0,data:null};
function n(v){if(v===null||v===undefined||v==='')return NaN;const x=Number(v);return Number.isFinite(x)?x:NaN}
function avg(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:NaN}
function clamp(v,a=0,b=100){return Math.max(a,Math.min(b,v))}
async function text(url,init={},ms=15000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{...init,signal:c.signal});if(!r.ok)throw Error(`${r.status} ${url}`);return await r.text()}finally{clearTimeout(t)}}
async function json(url,init={},ms=15000){return JSON.parse(await text(url,init,ms))}
function rowsFrom(o){if(Array.isArray(o))return o;if(Array.isArray(o?.data))return o.data;if(Array.isArray(o?.content))return o.content;return[]}
function panelAmount(r){const a=n(r.volumeAmount);if(a>0)return a;const tv=n(r.tradeVolume);if(tv>0)return tv;const v=n(r.volume),p=n(r.trade??r.closingPrice);return Number.isFinite(v)&&Number.isFinite(p)?v*p:0}
function pickPanel(raw){
 const withSymbol=(raw||[]).filter(r=>String(r?.symbol||'').trim());
 let stage=withSymbol;
 const ars=stage.filter(r=>String(r?.denominationCcy||'').trim().toUpperCase()==='ARS');
 if(ars.length)stage=ars;
 const settled=stage.filter(r=>String(r?.settlementType||'').trim()==='2');
 if(settled.length)stage=settled;
 if(!stage.length)stage=withSymbol;
 const groups=new Map();
 for(const r of stage){const s=String(r.symbol||'').trim().toUpperCase();if(!groups.has(s))groups.set(s,[]);groups.get(s).push(r)}
 const out=[];
 for(const [s,rows] of groups){rows.sort((a,b)=>panelAmount(b)-panelAmount(a));const best=rows[0];if(best)out.push({...best,symbol:s})}
 return out.sort((a,b)=>panelAmount(b)-panelAmount(a)||String(a.symbol).localeCompare(String(b.symbol)));
}
async function bymaPanel(){
 const payloads=[{page_size:5000},{},{T1:true,page_size:5000}];let last;
 for(const body of payloads){
  try{const rows=rowsFrom(await json(BYMA+'/cedears',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)},20000));if(rows.length)return rows;last=Error('BYMA respondió sin registros')}catch(e){last=e}
 }
 throw last||Error('BYMA no devolvió CEDEARs');
}
async function bymaHist(sym,days=260){
 const to=Math.floor(Date.now()/1000)+86400,from=to-86400*Math.max(60,days),url=`${BYMA}/chart/historical-series/history?symbol=${encodeURIComponent(sym+' 24HS')}&resolution=D&from=${from}&to=${to}`;
 let last;
 for(let attempt=0;attempt<3;attempt++){
   try{
     if(attempt)await new Promise(r=>setTimeout(r,250*attempt));
     const j=await json(url,{},18000);
     if(j?.s!=='ok'||!Array.isArray(j.t))throw Error('respuesta histórica inválida');
     const out=[];
     for(let i=0;i<j.t.length;i++){const c=n(j.c?.[i]),v=n(j.v?.[i]);if(Number.isFinite(c)&&Number.isFinite(v))out.push({t:j.t[i]*1000,open:n(j.o?.[i]),high:n(j.h?.[i]),low:n(j.l?.[i]),close:c,volume:v})}
     if(out.length<20)throw Error('histórico insuficiente');
     return out;
   }catch(e){last=e}
 }
 throw last||Error('histórico BYMA no disponible');
}
function adtv(b,d){const x=b.slice(-d);return x.length?avg(x.map(v=>v.close*v.volume)):NaN}
function persist(b){const x=b.slice(-40);return x.length?x.filter(v=>v.volume>0).length/x.length:NaN}
function liq(r,b){const bid=n(r.bidPrice??r.bid??r.bestBid),ask=n(r.offerPrice??r.ask??r.bestOffer),mid=bid>0&&ask>0?(bid+ask)/2:NaN,a5=adtv(b,5),a20=adtv(b,20),a40=adtv(b,40);return{adtv5:a5,adtv20:a20,adtv40:a40,currentVolumeAmount:panelAmount(r),tradeCount:n(r.tradeCount??r.trades??r.operations??r.quantityOperations),spreadPct:mid>0&&ask>=bid?(ask-bid)/mid*100:NaN,volumeAccelerationPct:a20>0&&a5>0?(a5/a20-1)*100:NaN,persistence:persist(b)}}
function selectLiquidUniverse(a){return a.filter(x=>{const l=x.liquidity||{},adtv20=n(l.adtv20),p=n(l.persistence),sp=n(l.spreadPct);return adtv20>0&&p>=0.60&&(!Number.isFinite(sp)||sp<=2)}).sort((x,y)=>n(y.liquidity?.adtv20)-n(x.liquidity?.adtv20)||String(x.symbol).localeCompare(String(y.symbol))).map((x,i)=>({...x,rank:i+1,adtv20:n(x.liquidity?.adtv20),persistence:n(x.liquidity?.persistence),spreadPct:n(x.liquidity?.spreadPct)}))}
async function pool(a,limit,fn){let i=0;const o=new Array(a.length).fill(null);await Promise.all(Array.from({length:Math.min(limit,a.length)},async()=>{while(i<a.length){const j=i++;try{o[j]=await fn(a[j])}catch{o[j]=null}}}));return o}
function underlying(sym){sym=String(sym||'').toUpperCase();return MAP[sym]||(BRAZIL_ORIGIN.has(sym)?sym+'.SA':sym)}
function instrumentName(r){return String(r?.securityDesc??r?.securityDescription??r?.description??r?.instrumentName??r?.denomination??r?.name??r?.issuer??'').trim()}
async function buildLiquidUniverse(){
 if(universeCache.data&&Date.now()-universeCache.at<CACHE_TTL)return universeCache.data;
 const raw=await bymaPanel(),panel=pickPanel(raw),rows=(await pool(panel,5,async r=>{const symbol=String(r.symbol||'').toUpperCase();try{const h=await bymaHist(symbol);return{symbol,name:instrumentName(r),underlying:underlying(symbol),liquidity:liq(r,h),currentVolumeAmount:panelAmount(r)}}catch{return null}})).filter(Boolean),items=selectLiquidUniverse(rows);universeCache={at:Date.now(),data:{rawCount:raw.length,items}};return universeCache.data;
}
async function bootstrapCedearServer(){
 return{scheduled:true,mode:'scheduler_owned',note:'Universo CEDEAR administrado por pg_cron/Supabase; bootstrap público deshabilitado'};
}
async function cedearPanelSnapshot(){
 try{
  const snap=await latestCedearServerSnapshot(),items=Array.isArray(snap?.items)?snap.items:[],liq=cedearLiquidityMeta(snap);
  if(items.length)return{rawCount:items.length,normalizedCount:items.length,total:items.length,items,source:liq.sourceLabel,snapshot:true,snapshotDate:snap.run_date,universeRule:snap.universe_rule,updatedAt:snap.updated_at||null,...liq};
 }catch(_){ }
 let bootstrapStatus=null;try{bootstrapStatus=await bootstrapCedearServer()}catch(e){return{rawCount:0,normalizedCount:0,total:0,items:[],snapshot:false,bootstrap:true,bootstrapInProgress:true,bootstrapError:String(e?.message||e),source:'Bootstrap CEDEAR servidor'}}
 try{
  const snap=await latestCedearServerSnapshot(),items=Array.isArray(snap?.items)?snap.items:[],liq=cedearLiquidityMeta(snap);
  if(items.length)return{rawCount:items.length,normalizedCount:items.length,total:items.length,items,source:liq.sourceLabel,snapshot:true,snapshotDate:snap.run_date,universeRule:snap.universe_rule,updatedAt:snap.updated_at||null,bootstrapCompleted:true,...liq};
 }catch(_){ }
 return{rawCount:bootstrapStatus?.total||0,normalizedCount:0,total:0,items:[],snapshot:false,bootstrap:true,bootstrapInProgress:true,bootstrapStatus,source:'Reconstruyendo universo CEDEAR en servidor'};
}
async function cedearBatch(offset=0,limit=8){
 offset=Math.max(0,Math.floor(+offset||0));limit=Math.max(1,Math.min(25,Math.floor(+limit||8)));
 const snap=await latestCedearServerSnapshot(),all=Array.isArray(snap?.items)?snap.items:[],total=all.length,liq=cedearLiquidityMeta(snap);
 if(!total)return{items:[],total:0,rawCount:0,normalizedCount:0,offset,limit,historyOk:0,historyFailed:0,failureSample:[],done:false,snapshot:false,bootstrap:true,bootstrapInProgress:true,source:'Snapshot todavía no disponible',...liq};
 const items=all.slice(offset,offset+limit);return{items,total,rawCount:total,normalizedCount:total,offset,limit,historyOk:items.length,historyFailed:0,failureSample:[],done:offset+limit>=total,snapshot:true,snapshotDate:snap.run_date,source:liq.sourceLabel,...liq};
}
async function bymaEquityRows(endpoint){
 const body={T1:true,page_size:5000};
 const rows=rowsFrom(await json(BYMA+'/'+endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)},20000));
 return rows;
}
function normalizeEquities(leading,general){
 const leadSet=new Set((leading||[]).map(r=>String(r?.symbol||'').trim().toUpperCase()).filter(Boolean));
 const all=[...(leading||[]),...(general||[])].filter(r=>{
   const s=String(r?.symbol||'').trim().toUpperCase(),st=String(r?.securityType||'').trim().toUpperCase(),mk=String(r?.market||'').trim().toUpperCase(),cc=String(r?.denominationCcy||'').trim().toUpperCase();
   return s&&(!st||st==='CS')&&(!mk||mk==='BYMA')&&(!cc||cc==='ARS');
 });
 const g=new Map();
 for(const r of all){const s=String(r.symbol||'').trim().toUpperCase();if(!g.has(s))g.set(s,[]);g.get(s).push(r)}
 const out=[];
 for(const [symbol,rows] of g){
   const settled=rows.filter(r=>String(r?.settlementType||'').trim()==='2'),pool=settled.length?settled:rows;
   pool.sort((a,b)=>panelAmount(b)-panelAmount(a));
   const best=pool[0]; if(!best)continue;
   const isLeading=leadSet.has(symbol),favorite=MERVAL_FAVORITES.has(symbol);
   if(!isLeading&&!favorite)continue;
   const adr=MERVAL_ADR[symbol]||''; if(!adr)continue;
   out.push({symbol,name:MERVAL_NAMES[symbol]||instrumentName(best)||symbol,sourcePanel:isLeading?'Líder':'Favorita',favorite,adr,method:'ADR',series:adr,currentVolumeAmount:panelAmount(best),trade:n(best.trade??best.closingPrice),volume:n(best.volume)});
 }
 return out.sort((a,b)=>{
   if(a.sourcePanel!==b.sourcePanel)return a.sourcePanel==='Líder'?-1:1;
   return (b.currentVolumeAmount||0)-(a.currentVolumeAmount||0)||a.symbol.localeCompare(b.symbol);
 });
}
async function mervalPanelSnapshot(){
 try{
  const [leading,general]=await Promise.all([bymaEquityRows('leading-equity'),bymaEquityRows('general-equity')]);
  const liveItems=normalizeEquities(leading,general),bySym=new Map(liveItems.map(x=>[String(x.symbol).toUpperCase(),x]));
  for(const [symbol,adr] of Object.entries(MERVAL_ADR)){
    if(!bySym.has(symbol))bySym.set(symbol,{symbol,name:MERVAL_NAMES[symbol]||symbol,sourcePanel:'ADR',favorite:true,adr,method:'ADR',series:adr,currentVolumeAmount:0,trade:NaN,volume:0,cachedUniverse:true});
  }
  const items=[...bySym.values()].filter(x=>x?.method==='ADR'&&x?.adr);
  if(!items.length)throw Error('BYMA no devolvió ADR argentinos disponibles');
  return {source:'BYMA universo local + universo ADR certificado',count:items.length,leadingCount:items.filter(x=>x.sourcePanel==='Líder').length,favoriteCount:items.filter(x=>x.favorite).length,items,snapshot:false};
 }catch(liveError){
  try{
   const snap=await supa('/rest/v1/rpc/mtf_latest_merval_snapshot',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   const saved=(Array.isArray(snap?.items)?snap.items:[]).filter(x=>x?.method==='ADR'&&x?.adr);
   if(saved.length)return {source:'Snapshot servidor ADR · última rueda válida',count:saved.length,leadingCount:saved.filter(x=>x.sourcePanel==='Líder').length,favoriteCount:saved.filter(x=>x.favorite).length,items:saved,snapshot:true,snapshotDate:snap.updated_at,liveError:String(liveError?.message||liveError)};
  }catch(_){ }
  const items=Object.entries(MERVAL_ADR).map(([symbol,adr])=>({symbol,name:MERVAL_NAMES[symbol]||symbol,sourcePanel:'ADR',favorite:true,adr,method:'ADR',series:adr,currentVolumeAmount:0,trade:NaN,volume:0,cachedUniverse:true}));
  return {source:'Universo base ADR argentinos · panel BYMA no disponible ahora',count:items.length,leadingCount:0,favoriteCount:items.length,items,snapshot:true,liveError:String(liveError?.message||liveError)};
 }
}
function tzParts(tz,ms=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,weekday:'short'}).formatToParts(new Date(ms)),o={};for(const p of parts)o[p.type]=p.value;return o}
function dateTZ(tz,ms=Date.now()){const p=tzParts(tz,ms);return `${p.year}-${p.month}-${p.day}`}
function dayKey(ms){return dateTZ('America/Argentina/Buenos_Aires',ms)}
function usDayKey(ms){return dateTZ('America/New_York',ms)}
async function mervalHistory(sym){
 sym=String(sym||'').trim().toUpperCase();if(!sym)throw Error('symbol requerido');
 const adr=MERVAL_ADR[sym];if(!adr)throw Error('Activo sin ADR directo en USD');
 const d=await yahoo(adr),last=d.at(-1);let live=null;try{live=await yahooLiveUsd(adr)}catch{}
 return{symbol:sym,underlying:adr,method:'ADR',source:`Yahoo Finance · ${adr} USD`,freshness:{usdDate:last?usDayKey(last.closeTime):null},live,data:{'1d':d,'1w':weeks(d)}};
}
function nyParts(ms=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,weekday:'short'}).formatToParts(new Date(ms));const o={};for(const p of parts)o[p.type]=p.value;return o}
function marketClosedNY(){const p=nyParts(),wd=p.weekday;if(wd==='Sat'||wd==='Sun')return true;const mins=+p.hour*60+(+p.minute);return mins>=16*60+10}
function weekClosedNY(){const p=nyParts(),wd=p.weekday,mins=+p.hour*60+(+p.minute);return wd==='Sat'||wd==='Sun'||(wd==='Fri'&&mins>=16*60+10)}
function dateNY(ms){const p=nyParts(ms);return `${p.year}-${p.month}-${p.day}`}
async function yahooRaw(sym){let last;for(const host of ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com']){try{const u=`${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y&includePrePost=false&events=div%2Csplits`,j=await json(u,{headers:{'user-agent':'Mozilla/5.0',accept:'application/json'}},18000),z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{},meta=z?.meta||{};if(!z?.timestamp?.length)throw Error('sin timestamps');const bars=[];for(let i=0;i<z.timestamp.length;i++){const close=n(q.close?.[i]),hi=n(q.high?.[i]),lo=n(q.low?.[i]);if(!Number.isFinite(close)||!Number.isFinite(hi)||!Number.isFinite(lo))continue;bars.push({open:n(q.open?.[i]),high:hi,low:lo,close,volume:n(q.volume?.[i])||0,closeTime:z.timestamp[i]*1000})}if(!bars.length)throw Error('sin barras');return{bars,meta}}catch(e){last=e}}throw last||Error('Yahoo sin histórico válido')}
function closedYahooBars(raw){let out=[...(raw?.bars||[])],meta=raw?.meta||{};if(!out.length)return out;const tz=String(meta.exchangeTimezoneName||'America/New_York'),last=out.at(-1),regularEnd=n(meta?.currentTradingPeriod?.regular?.end)*1000;try{if(dateTZ(tz,last.closeTime)===dateTZ(tz)&&regularEnd>0&&Date.now()<regularEnd+5*60*1000)out=out.slice(0,-1)}catch{}return out}
function brlToUsd(stock,fx,tz='America/Sao_Paulo'){const f=(fx||[]).map(x=>({k:dateTZ(tz,x.closeTime),r:n(x.close)})).filter(x=>x.r>0).sort((a,b)=>a.k.localeCompare(b.k)),out=[];let j=0,rate=NaN;for(const b of stock||[]){const k=dateTZ(tz,b.closeTime);while(j<f.length&&f[j].k<=k){rate=f[j].r;j++}if(!(rate>0))continue;out.push({...b,open:n(b.open)/rate,high:n(b.high)/rate,low:n(b.low)/rate,close:n(b.close)/rate})}return out}
async function yahoo(sym){const raw=await yahooRaw(sym);let out=closedYahooBars(raw);if(String(sym).toUpperCase().endsWith('.SA')){const fx=await yahooRaw('BRL=X');out=brlToUsd(out,fx.bars,'America/Sao_Paulo')}if(out.length<210)throw Error('histórico insuficiente');return out}

async function yahooLiveRaw(sym){
 let last;
 for(const host of ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com']){
  try{
   const u=host+'/v8/finance/chart/'+encodeURIComponent(sym)+'?interval=5m&range=1d&includePrePost=false';
   const j=await json(u,{headers:{'user-agent':'Mozilla/5.0',accept:'application/json'}},18000),z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{},ts=z?.timestamp||[];
   if(!z||!ts.length)throw Error('Yahoo live sin datos');
   const series=[];
   for(let i=0;i<ts.length;i++){const p=n(q.close?.[i]);if(Number.isFinite(p)&&p>0)series.push({t:ts[i]*1000,p})}
   if(series.length){const lastPoint=series.at(-1);return{price:lastPoint.p,t:lastPoint.t,source:'Yahoo 5m',series}}
   const p=n(z?.meta?.regularMarketPrice),t=n(z?.meta?.regularMarketTime)*1000;if(p>0)return{price:p,t,source:'Yahoo meta',series:[]};
   throw Error('Yahoo live sin precio');
  }catch(e){last=e}
 }
 throw last||Error('Yahoo live sin datos')
}
async function yahooLiveUsd(sym){
 const q=await yahooLiveRaw(sym);
 if(String(sym).toUpperCase().endsWith('.SA')){
  const fx=await yahooLiveRaw('BRL=X');if(!(fx.price>0))throw Error('FX BRL/USD live inválido');
  return{price:q.price/fx.price,t:Math.min(q.t,fx.t),source:'Yahoo 1m BRL convertido a USD'}
 }
 return{price:q.price,t:q.t,source:'Yahoo 1m USD'}
}

function weekKey(ms){const d=new Date(ms),day=(d.getUTCDay()+6)%7,m=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day));return m.toISOString().slice(0,10)}
function weeks(daily){const g=new Map;for(const b of daily){const k=weekKey(b.closeTime);if(!g.has(k))g.set(k,[]);g.get(k).push(b)}const keys=[...g.keys()].sort(),out=[];for(let i=0;i<keys.length;i++){const a=g.get(keys[i]),last=a.at(-1),isLast=i===keys.length-1,weekday=new Date(last.closeTime).getUTCDay();if(isLast&&weekday<5)continue;out.push({open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:last.close,volume:a.reduce((s,x)=>s+x.volume,0),closeTime:last.closeTime})}return out}
async function history(sym){const u=underlying(sym),d=await yahoo(u),source=u.endsWith('.SA')?'Yahoo Finance · B3 convertido BRL/USD':'Yahoo Finance USD',last=d.at(-1),tz=u.endsWith('.SA')?'America/Sao_Paulo':'America/New_York';let live=null;try{live=await yahooLiveUsd(u)}catch{}return{underlying:u,source,freshness:{usdDate:last?dateTZ(tz,last.closeTime):null,market:u.endsWith('.SA')?'B3':'USA'},live,data:{'1d':d,'1w':weeks(d)}}}
async function supa(path,init={}){const r=await fetch(SB_URL+path,{...init,headers:{apikey:SB_ANON,accept:'application/json',...(init.headers||{})}});if(!r.ok)throw Error('Supabase '+r.status+' '+await r.text());return await r.json()}
async function latestCedearServerSnapshot(){
 const j=await supa('/rest/v1/rpc/mtf_latest_cedear_snapshot',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 return j||{};
}
function cedearLiquidityMeta(snap){
 const items=Array.isArray(snap?.items)?snap.items:[],basis=String(snap?.liquidity_basis||'');
 const inferredCurrent=items.some(x=>Number(x?.adtv20??x?.liquidity?.adtv20)>0);
 const currentTurnoverValid=snap?.current_turnover_valid===true||(snap?.current_turnover_valid!==false&&basis!=='BYMA_LAST_VALID_UNIVERSE_FALLBACK'&&inferredCurrent);
 const fallback=basis==='BYMA_LAST_VALID_UNIVERSE_FALLBACK'||(!currentTurnoverValid&&items.length>0);
 const liquidityBasis=fallback?'BYMA_LAST_VALID_UNIVERSE_FALLBACK':'BYMA_CURRENT_TURNOVER';
 const fallbackRunDate=fallback?(snap?.fallback_run_date||null):null;
 const sourceLabel=fallback
   ? `Snapshot servidor · ${snap?.run_date||'—'} · liquidez BYMA degradada · universo válido ${fallbackRunDate||'anterior'}`
   : `Snapshot servidor · ${snap?.run_date||'—'} · universo dinámico por monto BYMA`;
 return{liquidityBasis,currentTurnoverValid:!fallback,fallbackRunDate,sourceLabel};
}
function isOperationalOpen(x){
 const v=String(x?.strategy_version||x?.context?.strategy_version||''),s=String(x?.status||'');
 return v==='OB-LADDER-v3.5'?['OPEN','TP1','TP2'].includes(s):s==='OPEN';
}
function openSummary(rows){
 const a=Array.isArray(rows)?rows:[];
 return{
   total:a.length,
   crypto:a.filter(x=>x.market==='crypto').length,
   regulated:a.filter(x=>x.market==='cedear'||x.market==='merval').length,
   cedear:a.filter(x=>x.market==='cedear').length,
   adr:a.filter(x=>x.market==='merval').length
 };
}
function cryptoClosedBarDiagnostic(structure){
 const out={checked:0,ready:0,touched:0,rejections:0,qualified:0,rr_pass:0,barClose:null,details:[]};
 const n=x=>Number(x),finite=x=>Number.isFinite(n(x));
 for(const s of Array.isArray(structure)?structure:[]){
  if(!s?.ready)continue;out.ready++;
  const b=s.lastClosed1h,ref=s.signalReference;
  if(!b||!ref||!finite(b.closeTime)||n(b.closeTime)!==n(ref.barClose))continue;
  out.checked++;if(!out.barClose||n(b.closeTime)>out.barClose)out.barClose=n(b.closeTime);
  const range=n(b.h)-n(b.l);if(!(range>0))continue;
  let touched=false,rejected=false,qualified=false,rrPass=false;
  for(const [dir,levels,targets] of [
   ['LONG',ref.ladder?.below||[],ref.ladder?.above||[]],
   ['SHORT',ref.ladder?.above||[],ref.ladder?.below||[]]
  ]){
   for(const l of levels){
    if(![b.o,b.h,b.l,b.c,l.point,l.zone_top,l.zone_bottom].every(finite))continue;
    const overlap=n(b.l)<=n(l.zone_top)&&n(b.h)>=n(l.zone_bottom);
    if(!overlap)continue;touched=true;
    const reject=dir==='LONG'
     ?n(b.l)<=n(l.point)&&n(b.c)>n(l.point)&&n(b.c)>n(b.o)&&(Math.min(n(b.o),n(b.c))-n(b.l))/range>=.20
     :n(b.h)>=n(l.point)&&n(b.c)<n(l.point)&&n(b.c)<n(b.o)&&(n(b.h)-Math.max(n(b.o),n(b.c)))/range>=.20;
    if(!reject)continue;rejected=true;
    const gate=s.eligibility?.[dir];if(gate?.eligible!==true)continue;qualified=true;
    const atr=n(s.context?.atr14),stop=dir==='LONG'?n(l.zone_bottom)-.30*atr:n(l.zone_top)+.30*atr,
          risk=Math.abs(n(b.c)-stop);
    if(!(atr>0&&risk>0)||(dir==='LONG'&&stop>=n(b.c))||(dir==='SHORT'&&stop<=n(b.c)))continue;
    if(targets.some(t=>finite(t.point)&&(dir==='LONG'?n(t.point)>n(b.c):n(t.point)<n(b.c))&&Math.abs(n(t.point)-n(b.c))/risk>=1.8))rrPass=true;
   }
  }
  if(touched)out.touched++;if(rejected)out.rejections++;if(qualified)out.qualified++;if(rrPass)out.rr_pass++;
  if(touched||rejected||qualified)out.details.push({symbol:s.symbol,touched,rejected,qualified,rr_pass:rrPass});
 }
 if(out.barClose)out.barClose=new Date(out.barClose).toISOString();
 return out;
}
async function runtimeSnapshot(market='crypto'){
 if(market==='crypto'){
   const [opens,structureRows,liveRows]=await Promise.all([
     supaAll('/rest/v1/mtf_signals?strategy_version=in.(OB-LADDER-v3.5,OB-LADDER-v3.6,ADR-OB-v1.0,OB-LADDER-v3.7.2,OB-LADDER-v3.7.3)&source=eq.FORWARD&status=in.(OPEN,TP1,TP2)&select=id,market,symbol,underlying,direction,signal_time,created_at,entry,stop,tp1,tp2,tp3,status,hit1,hit2,hit3,hit1_at,hit2_at,hit3_at,best_r,worst_r,source,strategy_version,context&order=signal_time.asc'),
     supa('/rest/v1/mtf_state?market=eq.crypto_structure&select=meta,last_run_at&limit=1'),
     supa('/rest/v1/mtf_state?market=eq.crypto_live&select=meta,last_run_at&limit=1')
   ]);
   const structure=structureRows?.[0]?.meta?.snapshot||[],live=liveRows?.[0]?.meta?.snapshot||[],
         cryptoOpens=(opens||[]).filter(x=>x.market==='crypto'&&isOperationalOpen(x));
   return{
     opens:cryptoOpens,
     openSummary:openSummary(cryptoOpens),
     decisions:[],
     structureStates:Array.isArray(structure)?structure:[],
     structureGeneratedAt:structureRows?.[0]?.meta?.generated_at||structureRows?.[0]?.last_run_at||null,
     liveStates:Array.isArray(live)?live:[],
     funnel:liveRows?.[0]?.meta?.funnel||null,
     hourlyConfirmation:liveRows?.[0]?.meta?.hourlyConfirmation||null,
     lastClosedDiagnostic:cryptoClosedBarDiagnostic(structure),
     liveGeneratedAt:liveRows?.[0]?.meta?.generated_at||liveRows?.[0]?.last_run_at||null,
     generatedAt:new Date().toISOString()
   };
 }
 const [opens,decisions,liveRows]=await Promise.all([
   supaAll('/rest/v1/mtf_signals?strategy_version=in.(OB-LADDER-v3.5,OB-LADDER-v3.6,ADR-OB-v1.0,OB-LADDER-v3.7.2,OB-LADDER-v3.7.3)&source=eq.FORWARD&status=in.(OPEN,TP1,TP2)&select=id,market,symbol,underlying,direction,signal_time,created_at,entry,stop,tp1,tp2,tp3,status,hit1,hit2,hit3,hit1_at,hit2_at,hit3_at,best_r,worst_r,source,strategy_version,context&order=signal_time.desc'),
   supa('/rest/v1/rpc/mtf_latest_decisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_market:market})}),
   supa('/rest/v1/mtf_state?market=eq.'+(market==='merval'?'adr_live':'regulated_live')+'&select=meta,last_run_at&limit=1')
 ]);
 const snap=liveRows?.[0]?.meta?.snapshot||[],
       filteredOpens=(opens||[]).filter(x=>(!market||x.market===market)&&isOperationalOpen(x));
 return{
   opens:filteredOpens,
   openSummary:openSummary(filteredOpens),
   decisions:Array.isArray(decisions)?decisions:[],
   liveStates:Array.isArray(snap)?snap.filter(x=>!market||x.market===market):[],
   liveGeneratedAt:liveRows?.[0]?.meta?.generated_at||liveRows?.[0]?.last_run_at||null,
   generatedAt:new Date().toISOString()
 };
}
async function statusSnapshot(){const [j,httpErrors,audit,adrCertification,cedearSnapshot]=await Promise.all([supa('/rest/v1/rpc/mtf_system_status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),supa('/rest/v1/rpc/mtf_http_error_status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),supa('/rest/v1/rpc/mtf_audit_status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),supa('/rest/v1/rpc/mtf_adr_certification_status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>({})),latestCedearServerSnapshot().catch(()=>({}))]);const liq=cedearLiquidityMeta(cedearSnapshot);return{...j,audit:audit||{},adrCertification:adrCertification||{},cedearLiquidity:{runDate:cedearSnapshot?.run_date||null,total:Number(cedearSnapshot?.total)||0,universeRule:cedearSnapshot?.universe_rule||null,...liq},errors:{...(j.errors||{}),...(httpErrors||{})},ui_version:'7.0.0',build_id:'MTF-Market-Command-Center-7.0.0-FINAL-CONSOLE',api_generated_at:new Date().toISOString()}}
async function telegramCanary(){throw Error('Canary público deshabilitado en v3.8.0')}
async function supaAll(path,pageSize=1000,maxRows=20000){const out=[];for(let offset=0;offset<maxRows;offset+=pageSize){const sep=path.includes('?')?'&':'?';const batch=await supa(`${path}${sep}limit=${pageSize}&offset=${offset}`);out.push(...batch);if(batch.length<pageSize)break}return out}
async function marketStatus(){try{const rows=await supa('/rest/v1/mtf_state?market=eq.market_guard&select=meta,last_run_at&limit=1'),row=rows?.[0],age=row?.last_run_at?Date.now()-new Date(row.last_run_at).getTime():Infinity;if(row?.meta&&age<180000)return row.meta;return{generatedAt:new Date().toISOString(),byma:{code:'UNKNOWN',text:'BYMA sin estado reciente'},usa:{code:'UNKNOWN',text:'USA sin estado reciente'},combined:{code:'STALE',text:'Estado de mercados desactualizado · no confiar en alertas intradía',actionable:false,validDaily:false}}}catch(e){return{generatedAt:new Date().toISOString(),byma:{code:'ERROR',text:'BYMA sin estado'},usa:{code:'ERROR',text:'USA sin estado'},combined:{code:'STALE',text:'No se pudo validar estado de mercados',actionable:false,validDaily:false}}}}

function sessionState(tz,openH,openM,closeH,closeM){
 const p=tzParts(tz),wd=String(p.weekday||''),mins=(Number(p.hour)||0)*60+(Number(p.minute)||0),
       open=openH*60+openM,close=closeH*60+closeM,weekend=wd==='Sat'||wd==='Sun',isOpen=!weekend&&mins>=open&&mins<close;
 return{state:isOpen?'OPEN':'CLOSED',localTime:String(p.hour||'00').padStart(2,'0')+':'+String(p.minute||'00').padStart(2,'0'),timezone:tz};
}
async function globalQuote(symbol){
 let raw=null,live=null;
 try{raw=await yahooRaw(symbol)}catch{}
 try{live=await yahooLiveRaw(symbol)}catch{}
 const meta=raw?.meta||{},bars=raw?.bars||[],tz=String(meta.exchangeTimezoneName||'America/New_York');
 let value=n(live?.price),prev=NaN;
 const last=bars.at(-1),before=bars.at(-2);
 if(value>0){
   const lastIsToday=!!last&&dateTZ(tz,last.closeTime)===dateTZ(tz);
   prev=n(lastIsToday?before?.close:last?.close);
 }else if(last){value=n(last.close);prev=n(before?.close)}
 if(!(value>0))value=n(meta.regularMarketPrice);
 if(!(prev>0))prev=n(meta.chartPreviousClose??meta.previousClose);
 const changePct=value>0&&prev>0?(value/prev-1)*100:null;
 const sparkline=Array.isArray(live?.series)&&live.series.length>1?live.series.slice(-72).map(x=>n(x.p)).filter(Number.isFinite):bars.slice(-48).map(b=>n(b?.close)).filter(Number.isFinite);
 return{symbol,value:Number.isFinite(value)?value:null,changePct:Number.isFinite(changePct)?changePct:null,asOf:live?.t?new Date(live.t).toISOString():null,sparkline};
}
async function globalContext(){
 const jobs=await Promise.allSettled([
  globalQuote('^N225'),globalQuote('^STOXX50E'),globalQuote('^GSPC'),
  globalQuote('DX-Y.NYB'),globalQuote('^TNX'),globalQuote('^VIX'),
  json('https://api.coingecko.com/api/v3/global',{headers:{accept:'application/json'}},12000)
 ]);
 const val=i=>jobs[i].status==='fulfilled'?jobs[i].value:null,
       asia=val(0),europe=val(1),ny=val(2),dxy=val(3),us10y=val(4),vix=val(5),cg=val(6),
       btcDom=n(cg?.data?.market_cap_percentage?.btc);
 let score=0,evidence=0;
 const vote=(v,positiveIsRiskOn)=>{if(!Number.isFinite(v)||Math.abs(v)<0.01)return;evidence++;score+=(positiveIsRiskOn?(v>0?1:-1):(v<0?1:-1))};
 vote(n(ny?.changePct),true);vote(n(dxy?.changePct),false);vote(n(us10y?.changePct),false);vote(n(vix?.changePct),false);
 const risk=evidence<2?'NEUTRAL':score>=2?'FAVORABLE':score<=-2?'ADVERSE':'NEUTRAL';
 return{
  generatedAt:new Date().toISOString(),
  sessions:[
   {key:'ASIA',label:'ASIA',...sessionState('Asia/Tokyo',9,0,15,30),performancePct:asia?.changePct??null,index:'Nikkei 225'},
   {key:'EUROPE',label:'EUROPA',...sessionState('Europe/Berlin',9,0,17,30),performancePct:europe?.changePct??null,index:'Euro Stoxx 50'},
   {key:'NEW_YORK',label:'NUEVA YORK',...sessionState('America/New_York',9,30,16,0),performancePct:ny?.changePct??null,index:'S&P 500'}
  ],
  macro:{
   btcDominance:{label:'BTC.D',value:Number.isFinite(btcDom)?btcDom:null,changePct:null,unit:'%'},
   dxy:{label:'DXY',value:dxy?.value??null,changePct:dxy?.changePct??null,unit:'',sparkline:dxy?.sparkline??[]},
   us10y:{label:'US10Y',value:us10y?.value??null,changePct:us10y?.changePct??null,unit:'%'},
   vix:{label:'VIX',value:vix?.value??null,changePct:vix?.changePct??null,unit:''},
   sp500:{label:'S&P 500',value:ny?.value??null,changePct:ny?.changePct??null,unit:''}
  },
  risk:{state:risk,score,evidence,label:risk==='FAVORABLE'?'ENTORNO FAVORABLE PARA RIESGO':risk==='ADVERSE'?'ENTORNO ADVERSO PARA RIESGO':'ENTORNO NEUTRAL PARA RIESGO'}
 };
}

async function statsSnapshot(){
 const [j,rr,ar,cr]=await Promise.all([
   supa('/rest/v1/rpc/mtf_stats_snapshot',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),
   supa('/rest/v1/mtf_state?market=eq.regulated_live&select=meta&limit=1').catch(()=>[]),
   supa('/rest/v1/mtf_state?market=eq.adr_live&select=meta&limit=1').catch(()=>[]),
   supa('/rest/v1/mtf_state?market=eq.crypto_live&select=meta&limit=1').catch(()=>[])
 ]);
 const names=new Map(),prices=new Map();
 for(const x of [...(rr?.[0]?.meta?.snapshot||[]),...(ar?.[0]?.meta?.snapshot||[])]){
   const key=String(x.market||'')+':'+String(x.symbol||'');
   if(x?.symbol&&x?.name)names.set(key,String(x.name));
   if(x?.symbol&&Number.isFinite(+x.price))prices.set(key,+x.price);
 }
 for(const x of cr?.[0]?.meta?.snapshot||[])if(x?.symbol&&Number.isFinite(+x.price))prices.set('crypto:'+String(x.symbol),+x.price);
 const signals=(Array.isArray(j?.operations)?j.operations:[]).map(x=>{
   const key=String(x.market||'')+':'+String(x.symbol||''),current=prices.get(key),entry=+x.entry,dir=String(x.direction||'LONG');
   const move=Number.isFinite(current)&&Number.isFinite(entry)&&entry!==0?(dir==='SHORT'?(entry-current)/entry:(current-entry)/entry)*100:null;
   return{...x,name:names.get(key)||'',current_price:Number.isFinite(current)?current:null,move_pct:Number.isFinite(move)?move:null}
 });
 return{
   signals,
   summary:j?.summary||{},
   metrics:j?.metrics||{},
   alertSummary:j?.alerts||{},
   reconciliation:j?.reconciliation||{},
   definition:j?.definition||'Todas las operaciones canónicas válidas',
   collectionStartedAt:j?.collection_started_at||null,
   collectionLabel:j?.collection_label||'Canonical valid operations',
   generatedAt:j?.generated_at||new Date().toISOString()
 };
}
module.exports=async function handler(req,res){try{const op=String(req.query?.op||'');if(op==='stats'){res.setHeader('cache-control','no-store');return res.status(200).json(await statsSnapshot())}if(op==='runtime'){res.setHeader('cache-control','no-store');return res.status(200).json(await runtimeSnapshot(String(req.query?.market||'crypto')))}if(op==='status'){res.setHeader('cache-control','no-store');return res.status(200).json(await statusSnapshot())}if(op==='canary'){res.setHeader('cache-control','no-store');return res.status(403).json({error:'Canary público deshabilitado en v3.8.0'})}res.setHeader('cache-control','s-maxage=120, stale-while-revalidate=600');if(op==='health')return res.status(200).json({ok:true,strategy_version:'OB-LADDER-v3.7.3',regulated_strategy_version:'OB-LADDER-v3.6',adr_strategy_version:'ADR-OB-v1.0',ui_version:'7.0.0',build_id:'MTF-Market-Command-Center-7.0.0-FINAL-CONSOLE'});if(op==='market-status'){res.setHeader('cache-control','s-maxage=20, stale-while-revalidate=20');return res.status(200).json(await marketStatus())}if(op==='global-context'){res.setHeader('cache-control','s-maxage=30, stale-while-revalidate=30');return res.status(200).json(await globalContext())}if(op==='cedears-panel'||op==='cedears')return res.status(200).json(await cedearPanelSnapshot());if(op==='cedears-batch')return res.status(200).json(await cedearBatch(req.query?.offset,req.query?.limit));if(op==='merval-panel')return res.status(200).json(await mervalPanelSnapshot());if(op==='merval-history'){const sym=String(req.query?.symbol||'').trim().toUpperCase();if(!sym)return res.status(400).json({error:'symbol requerido'});return res.status(200).json(await mervalHistory(sym))}if(op==='history'){const sym=String(req.query?.symbol||'').trim().toUpperCase();if(!sym)return res.status(400).json({error:'symbol requerido'});return res.status(200).json(await history(sym))}return res.status(400).json({error:'op inválido'})}catch(e){return res.status(500).json({error:String(e?.message||e)})}}
