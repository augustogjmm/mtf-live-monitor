const active=new Set(['MACD-OB-v2.0','CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0']);
export function monitorRow(row){
  const take=(object,fields)=>Object.fromEntries(fields.filter(x=>Object.hasOwn(object||{},x)).map(x=>[x,object[x]]));
  const level=x=>take(x,['rank','point','zone_bottom','zone_top']);
  return {...take(row,['market','symbol','pair','name','price','t','updated_at','ready','state','serverState','stale_data','stops','generatedAt']),
    context:take(row.context,['trend','rsi14','macd','signal','atr14','volumeRatio']),
    macroContext:Object.fromEntries(['trend','h1','h4','d1','w1'].filter(x=>Object.hasOwn(row.macroContext||{},x))
      .map(x=>[x,x==='trend'?row.macroContext[x]:take(row.macroContext[x],['trend'])])),
    ladder:{below:(row.ladder?.below||[]).map(level),above:(row.ladder?.above||[]).map(level)},
    proximity:{state:row.proximity?.state,nearest:row.proximity?.nearest?
      take(row.proximity.nearest,['rank','point','zone_bottom','zone_top','direction','distanceAtr','distance_atr']):null}};
}
async function rows(store,table){const result=await store.from(table).select('*');if(result.error)throw Error(result.error.message);return result.data;}
export async function publicRpc(store,name,args={},options={}){
  const now=new Date().toISOString();
  if(name==='mtf_monitor_state'){
    if(!['crypto_structure','crypto_live','regulated_live','adr_live'].includes(args.p_market))throw Error('Invalid market');
    const row=store.readState(args.p_market);return row?[{...row,meta:{...row.meta,snapshot:(row.meta?.snapshot||[]).map(monitorRow)}}]:[];
  }
  if(name==='mtf_stats_price_inputs')return ['regulated_live','adr_live','crypto_live'].map(market=>({market,
    meta:{snapshot:(store.readState(market)?.meta?.snapshot||[]).map(x=>({market:x.market,symbol:x.symbol,name:x.name,price:x.price}))}}));
  if(name==='mtf_latest_cedear_snapshot'){
    const eligible=(await rows(store,'mtf_cedear_work')).filter(x=>x.eligible_liquid);
    const date=eligible.map(x=>x.run_date).sort().at(-1)||null;
    const latest=eligible.filter(x=>x.run_date===date).sort((a,b)=>(a.liquidity_rank??Infinity)-(b.liquidity_rank??Infinity)||a.symbol.localeCompare(b.symbol));
    const valid=latest.some(x=>Number(x.metrics?.adtv20)>0);
    const fallback=eligible.filter(x=>x.run_date<date&&Number(x.metrics?.adtv20)>0).map(x=>x.run_date).sort().at(-1)||null;
    return {run_date:date,total:latest.length,updated_at:latest.map(x=>x.updated_at).sort().at(-1)||null,
      universe_rule:valid?'BYMA_CURRENT_TURNOVER_CUM90_SPREAD2':'FALLBACK_LAST_VALID_BYMA_UNIVERSE',
      liquidity_basis:valid?'BYMA_CURRENT_TURNOVER':'BYMA_LAST_VALID_UNIVERSE_FALLBACK',current_turnover_valid:valid,fallback_run_date:valid?null:fallback,
      items:latest.map(x=>({symbol:x.symbol,name:x.raw?.securityDesc||x.raw?.description||x.symbol,underlying:x.underlying,
        rank:x.liquidity_rank,adtv20:x.metrics?.adtv20??null,persistence:x.metrics?.persistence??null,
        spreadPct:x.metrics?.spreadPct??null,liquidity:x.metrics,currentVolumeAmount:Number(x.raw?.volumeAmount)||0}))};
  }
  if(name==='mtf_latest_merval_snapshot')return {updated_at:store.readState('adr_live')?.last_run_at,
    items:(store.readState('adr_live')?.meta?.snapshot||[]).map(x=>({symbol:x.symbol,name:x.name,adr:x.underlying,method:'ADR',sourcePanel:'ADR',favorite:true}))};
  if(name==='mtf_latest_decisions')return (await store.from('mtf_decision_audit').select('*').eq('market',args.p_market).order('evaluated_at',{ascending:false}).limit(20)).data;
  if(name==='mtf_stats_snapshot_fast'){
    const registry=await rows(store,'mtf_strategy_registry');
    const activated=registry.filter(x=>active.has(x.version)).map(x=>x.activated_at).filter(Boolean).sort().at(-1)||null;
    const activation=new Map(registry.map(x=>[x.version,x.activated_at]));
    const operations=(await rows(store,'mtf_signals')).filter(x=>x.source==='FORWARD'&&active.has(x.strategy_version)&&!x.context?.stats_epoch_excluded&&!x.context?.audit_duplicate&&(!activation.get(x.strategy_version)||Date.parse(x.signal_time)>=Date.parse(activation.get(x.strategy_version)))).map(x=>({...x,status:x.status==='SL'&&x.context?.exit_reason==='BREAK_EVEN'?'BE':x.status}));
    const closed=operations.filter(x=>['TP1','TP2','TP3','SL','BE','CLOSED','AMBIGUOUS'].includes(x.status));
    return {operations,summary:{total:operations.length,open:operations.filter(x=>x.status==='OPEN').length,closed:closed.length},
      metrics:{validated:false},alerts:{},reconciliation:{},definition:'Señales FORWARD de la cohorte activa; rentabilidad sin validar',
      collection_started_at:activated,collection_label:'Cohorte activa preservada',generated_at:now};
  }
  if(name==='mtf_http_error_status'){
    const errors=await rows(store,'mtf_runtime_errors');
    return {http_5xx_30m:errors.filter(x=>x.status_code>=500&&Date.now()-Date.parse(x.created_at)<1800000).length,
      http_5xx_24h:errors.filter(x=>x.status_code>=500&&Date.now()-Date.parse(x.created_at)<86400000).length};
  }
  if(name==='mtf_audit_status'){
    const audits=(await store.from('mtf_decision_audit').select('*').order('evaluated_at',{ascending:false}).limit(20)).data;
    const count=store.rows("SELECT count(*) AS n FROM mtf_records WHERE bucket='mtf_decision_audit' AND json_extract(value,'$.evaluated_at')>=?",new Date(Date.now()-86400000).toISOString())[0].n;
    return {last_audit_at:audits[0]?.evaluated_at||null,decisions_24h:count,recent:audits.slice(0,20)};
  }
  if(name==='mtf_adr_certification_status'){
    const state=store.readState('adr_live'),registry=(await rows(store,'mtf_strategy_registry')).find(x=>x.version==='ADR-OB-v1.0');
    const signals=(await rows(store,'mtf_signals')).filter(x=>x.strategy_version==='ADR-OB-v1.0'&&x.source==='FORWARD'&&x.market==='merval');
    const opens=signals.filter(x=>x.status==='OPEN'),job=(await rows(store,'mtf_jobs')).find(x=>x.name==='adr_live');
    const violations=signals.filter(x=>x.direction!=='LONG'||!(Number(x.context?.planned_rr)>=1.8)||x.context?.context?.trend!=='ALCISTA'||x.context?.macro_context?.w1?.trend!=='ALCISTA'||x.context?.stop_policy!=='REFERENCE_ONLY_NO_AUTO_EXIT'||x.context?.exit_policy!=='TP1_FINAL'||['TP2','TP3'].includes(x.status));
    return {runtime:{...state,snapshot_count:state?.meta?.snapshot?.length||0},strategy:registry||{},performance_validated:false,
      signals:{total:signals.length,open:opens.length,violations:violations.length},checks:{registry_frozen:registry?.frozen===true,
        runtime_version_ok:state?.meta?.strategy_version==='ADR-OB-v1.0',runtime_engine_ok:state?.meta?.engine==='ADR_DW_15M_RECOVERY_V1',
        snapshot_complete:state?.meta?.snapshot?.length===14,cron_active:job?.active===true,no_signal_rule_violations:violations.length===0,
        no_duplicate_open_assets:new Set(opens.map(x=>x.symbol)).size===opens.length}};
  }
  if(name==='mtf_system_status'){
    const names=['crypto_structure','crypto_live','regulated_live','adr_live','market_guard','prealert_live'];
    const states=Object.fromEntries(names.map(x=>[x,store.readState(x)]).filter(x=>x[1]));
    const signals=await rows(store,'mtf_signals'),positions=signals.filter(x=>x.status==='OPEN'&&x.source==='FORWARD'&&
      ['MACD-OB-v1.0','MACD-OB-v2.0','CEDEAR-MACD-OB-v1.0','CEDEAR-MACD-OB-v2.0','ADR-OB-v1.0'].includes(x.strategy_version));
    const assets=new Set(positions.map(x=>x.market+':'+x.symbol)),jobs=await rows(store,'mtf_jobs');
    const config=(await rows(store,'mtf_alert_config'))[0]||{};
    const cedear=states.regulated_live?.meta?.snapshot||[],fresh=cedear.filter(x=>x.ready&&x.t>0&&Date.now()-x.t<3600000).length;
    return {generated_at:now,backend_provider:'cloudflare-sqlite',states,jobs:jobs.map(x=>({jobid:({crypto_structure:1,cedear_prepare:2,watcher:3,regulated_live:7,crypto_live:8,adr_live:11,retention:12})[x.name],...x})),
      database:{states:Object.keys(states).length,signals:signals.length,last_write:Object.values(states).map(x=>x.updated_at).sort().at(-1)||null,
        cedear_universe:cedear.length,cedear_live_fresh:fresh,cedear_live_stale:cedear.length-fresh},
      alerts:{enabled:!!config.enabled,telegram_linked:!!config.telegram_chat_id&&options.telegramConfigured===true,last_watcher_at:config.last_watcher_at,
        pending:(await rows(store,'mtf_alert_events')).filter(x=>x.status==='PENDING').length},
      positions:{open_total:positions.length,open_crypto:positions.filter(x=>x.market==='crypto').length,
        open_cedear:positions.filter(x=>x.market==='cedear').length,open_merval:positions.filter(x=>x.market==='merval').length,
        duplicate_open_assets:positions.length-assets.size,one_open_per_asset:positions.length===assets.size},
      errors:{...(await publicRpc(store,'mtf_http_error_status')),cron_failures_24h:jobs.reduce((n,x)=>n+(x.failures_24h||0),0),
        scanner_errors:jobs.filter(x=>x.last_status==='failed').length},
      build:{strategy_version:'MACD-OB-v2.0',strategy_frozen:true,provider:'cloudflare-sqlite'},
      signals:{forward_total:signals.filter(x=>x.source==='FORWARD').length,last_24h:{signals:signals.filter(x=>Date.now()-Date.parse(x.created_at)<86400000).length}}};
  }
  throw Error('Public RPC unavailable');
}
const publicRpcs=new Set(['mtf_monitor_state','mtf_stats_price_inputs','mtf_latest_cedear_snapshot','mtf_latest_merval_snapshot',
  'mtf_latest_decisions','mtf_stats_snapshot_fast','mtf_http_error_status','mtf_audit_status','mtf_adr_certification_status','mtf_system_status']);
export async function readRequest(store,request,options={}){
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/rest/v1/rpc/')){
    const name=path.slice('/rest/v1/rpc/'.length);
    if(request.method!=='POST'||!publicRpcs.has(name))return Response.json({error:'Public writes disabled'},{status:403});
    return Response.json(await publicRpc(store,name,await request.json(),options));
  }
  const table=path.slice('/rest/v1/'.length);
  if(!path.startsWith('/rest/v1/')||request.method!=='GET'||!['mtf_state','mtf_signals'].includes(table))
    return Response.json({error:'Route unavailable'},{status:404});
  let query=store.from(table).select(url.searchParams.get('select')||'*');
  for(const [column,expression] of url.searchParams){
    if(['select','order','limit','offset'].includes(column))continue;
    const split=expression.indexOf('.'),operator=expression.slice(0,split),raw=expression.slice(split+1);
    if(operator==='in'&&raw.startsWith('(')&&raw.endsWith(')'))query=query.in(column,raw.slice(1,-1).split(','));
    else if(['eq','neq','gt','gte','lt','lte'].includes(operator))query=query[operator](column,raw);
    else return Response.json({error:'Invalid filter'},{status:400});
  }
  const order=url.searchParams.get('order');if(order){const [column,direction]=order.split('.');query=query.order(column,{ascending:direction!=='desc'});}
  const limit=Number(url.searchParams.get('limit')||1000),offset=Number(url.searchParams.get('offset')||0);
  if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(offset)||offset<0)return Response.json({error:'Invalid page'},{status:400});
  const result=await query.range(offset,offset+limit-1);
  return result.error?Response.json({error:result.error.message},{status:500}):Response.json(result.data);
}
