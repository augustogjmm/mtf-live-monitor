import schema from './schema.mjs';
import {SQLiteStore} from './sqlite-store.mjs';
import {readRequest} from './public-api.mjs';
import {createMarketFetch} from './market-fetch.mjs';
import {createEngine as cryptoEngine} from './crypto.mjs';
import {createEngine as adrEngine} from './adr.mjs';
import {createEngine as regulatedEngine} from './regulated.mjs';
import {createEngine as watcherEngine} from './watcher.mjs';
const factories={crypto:cryptoEngine,adr:adrEngine,regulated:regulatedEngine,watcher:watcherEngine};
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});

export class MtfMonitor {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec(schema);
      this.store=new SQLiteStore(ctx.storage.sql,fn=>ctx.storage.transactionSync(fn));
    });
  }
  setting(){
    const row=this.store.rows("SELECT value FROM mtf_records WHERE bucket='runtime' AND record_key='settings'")[0];
    return row?JSON.parse(row.value):{enabled:false,baseline:true,regulatedBaseline:true,adrBaseline:true,cryptoCursor:0};
  }
  saveSetting(value){this.store.put('runtime','settings',value);}
  authorized(request){return typeof this.env.ADMIN_TOKEN==='string'&&this.env.ADMIN_TOKEN.length>=32&&
    request.headers.get('authorization')==='Bearer '+this.env.ADMIN_TOKEN;}
  async fetch(request){
    const path=new URL(request.url).pathname;
    try{
      if(path.startsWith('/admin/')){
        if(!this.authorized(request))return json({error:'unauthorized'},401);
        if(request.method==='GET'&&path==='/admin/status')return json({provider:'cloudflare-sqlite',settings:this.setting(),
          jobs:(await this.store.from('mtf_jobs').select('*')).data,
          records:this.store.rows('SELECT bucket,count(*) AS rows FROM mtf_records GROUP BY bucket')});
        if(request.method==='GET'&&path==='/admin/provider-status'){
          const probes=await Promise.all(['https://api.binance.com/api/v3/time','https://data-api.binance.vision/api/v3/time','https://www.cloudflare.com/cdn-cgi/trace'].map(async url=>{try{const response=await fetch(url,{headers:{'user-agent':'MTF-Monitor/6.3.3 (+https://mtf-monitor.vercel.app)','accept':'application/json'},signal:AbortSignal.timeout(10000)});return {url,status:response.status,body:(await response.text()).slice(0,400)};}catch(error){return {url,error:error.message};}}));return json({jurisdiction:this.ctx.id.jurisdiction,probes});
        }
        if(request.method==='GET'&&path==='/admin/export'){
          const backup={};for(const table of ['mtf_state','mtf_signals','mtf_cedear_work','mtf_alert_config','mtf_alert_events','mtf_analyzer_state','mtf_strategy_registry','mtf_alert_delivery_ledger','mtf_decision_audit','mtf_runtime_errors','mtf_jobs']){const result=await this.store.from(table).select('*');if(result.error)throw Error(result.error.message);backup[table]=result.data;}return json({backup});
        }
        if(request.method!=='POST')return json({error:'method unavailable'},405);
        if(path==='/admin/import'){
          if(this.setting().enabled)return json({error:'Stop engines before import'},409);
          this.store.import(await request.json());
          this.saveSetting({enabled:false,baseline:true,regulatedBaseline:true,adrBaseline:true,cryptoCursor:0,imported_at:new Date().toISOString()});
          return json({imported:true,engines_enabled:false});
        }
        if(path==='/admin/start'){
          const count=this.store.rows("SELECT count(*) AS n FROM mtf_records WHERE bucket='mtf_analyzer_state'")[0].n;
          if(!count)return json({error:'Import detector states before activation'},409);
          this.saveSetting({...this.setting(),enabled:true,baseline:true,regulatedBaseline:true,adrBaseline:true});
          await this.ctx.storage.setAlarm(Date.now()+1000);return json({enabled:true,first_cycles:'baseline'});
        }
        if(path==='/admin/stop'){
          this.saveSetting({...this.setting(),enabled:false});await this.ctx.storage.deleteAlarm();return json({enabled:false});
        }
        return json({error:'admin route unavailable'},404);
      }
      return await readRequest(this.store,request,{telegramConfigured:!!this.env.TELEGRAM_BOT_TOKEN});
    }catch(error){return json({error:String(error.message).slice(0,300)},500);}
  }
  engine(name){
    const boundedFetch=createMarketFetch(this.store);
    return factories[name](this.store,{fetch:boundedFetch,variables:{
      TELEGRAM_BOT_TOKEN:this.env.TELEGRAM_BOT_TOKEN||'',TELEGRAM_CHAT_ID:this.env.TELEGRAM_CHAT_ID||''}});
  }
  job(name){return this.store.rows("SELECT value FROM mtf_records WHERE bucket='mtf_jobs' AND json_extract(value,'$.name')=?",name)[0];}
  async runJob(name,slot,callback){
    const previous=this.job(name),prior=previous?JSON.parse(previous.value):{};
    const started=new Date().toISOString();
    let failure;
    try{await callback();}catch(error){failure=error;}
    const ended=new Date().toISOString(),sameDay=prior.day===ended.slice(0,10);
    const row={...prior,name,active:true,day:ended.slice(0,10),last_slot:slot,last_start:started,last_end:ended,
      schedule:'Cloudflare alarm · '+name,last_status:failure?'failed':'succeeded',
      runs_24h:(sameDay?prior.runs_24h||0:0)+1,failures_24h:(sameDay?prior.failures_24h||0:0)+(failure?1:0),
      last_message:failure?String(failure.message).slice(0,300):'Completed'};
    const saved=await this.store.from('mtf_jobs').upsert(row,{onConflict:'name'});
    if(saved.error)throw Error(saved.error.message);
    if(failure){
      await this.store.from('mtf_runtime_errors').insert({component:name,action:'alarm',status_code:500,
        error:String(failure.message).slice(0,300),created_at:ended});
    }
  }
  async cryptoStructure(){
    const previous=this.store.readState('crypto_structure'),setting=this.setting();
    const base=previous?.meta?.universe||previous?.meta?.scan_universe||[];
    const opens=(await this.store.from('mtf_signals').select('symbol').eq('market','crypto').eq('source','FORWARD').in('strategy_version',['MACD-OB-v1.0','MACD-OB-v2.0']).eq('status','OPEN')).data||[];
    const symbols=[...new Set([...base,...opens.map(x=>x.symbol)])];
    if(!symbols.length)throw Error('Imported crypto universe missing');
    const start=(setting.cryptoCursor||0)%symbols.length,batch=Array.from({length:Math.min(5,symbols.length)},(_,i)=>symbols[(start+i)%symbols.length]);
    const engine=this.engine('crypto'),snapshot=new Map((previous?.meta?.snapshot||[]).filter(x=>symbols.includes(x.symbol)).map(x=>[x.symbol,x]));
    for(const symbol of batch){
      try{snapshot.set(symbol,await engine.snapshotOne(symbol));}
      catch(error){snapshot.set(symbol,{symbol,ready:false,error:true,reason:String(error.message),generatedAt:new Date().toISOString()});}
    }
    const now=new Date().toISOString(),saved=await this.store.from('mtf_state').upsert({market:'crypto_structure',
      last_run_at:now,last_processed_at:now,updated_at:now,
      meta:{...previous?.meta,generated_at:now,snapshot:[...snapshot.values()],scan_universe:symbols,chunk_size:batch.length}},{onConflict:'market'});
    if(saved.error)throw Error(saved.error.message);
    this.saveSetting({...this.setting(),cryptoCursor:(start+batch.length)%symbols.length});
    if(batch.every(symbol=>snapshot.get(symbol)?.error||!snapshot.get(symbol)?.generatedAt||snapshot.get(symbol)?.reason==='detector_not_initialized'||snapshot.get(symbol)?.reason?.includes('budget')))throw Error('No fresh crypto structure in this batch');
  }
  async alarm(){
    if(!this.setting().enabled)return;
    // Each alarm runs one job, giving it its own outbound and CPU budget.
    // Follow-up alarms drain due jobs instead of running all engines in one invocation.
    const slot=Math.floor(Date.now()/60000),date=new Date(),weekday=date.getUTCDay(),hour=date.getUTCHours(),
      regulatedWindow=weekday>0&&weekday<6&&hour>=13&&hour<=20,adrWindow=weekday>0&&weekday<6&&hour>=12&&hour<=22;
    const tasks=[
      ['crypto_structure',1,()=>this.cryptoStructure()],
      ['crypto_live',2,async()=>{
        const result=await this.engine('crypto').live(!this.setting().baseline);
        if(result.ready===false||result.funnel?.ready===0)throw Error(result.reason||'Crypto structure not ready');
        if(result.funnel?.data_errors>0)throw Error('Crypto confirmation data unavailable for '+result.funnel.data_errors+' assets; cursors preserved');
        this.saveSetting({...this.setting(),baseline:false});
      }],
      ['watcher',1,async()=>{
        const engine=this.engine('watcher'),response=await engine.handler(new Request('https://local.mtf.invalid/',{
          method:'POST',headers:{authorization:'Bearer '+engine.engineKey,'content-type':'application/json'},body:'{}'}));
        if(!response.ok){const body=await response.json();throw Error(body.error||'Watcher failed');}
      }],
      ...((regulatedWindow||this.setting().regulatedBaseline)?[['regulated_live',1,async()=>{const result=await this.engine('regulated').processRegulatedLive(!this.setting().regulatedBaseline);if(result.next_cursor===0||(this.store.readState('regulated_live')?.meta?.full_cycle_completed))this.saveSetting({...this.setting(),regulatedBaseline:false});if(result.errors?.length>=result.scanned_this_run&&result.scanned_this_run>0)throw Error('Regulated batch has no successful assets');}]]:[]),
      ...((adrWindow||this.setting().adrBaseline)?[['adr_live',5,async()=>{await this.engine('adr').run(this.setting().adrBaseline?'baseline':'live');this.saveSetting({...this.setting(),adrBaseline:false});}]]:[]),
      ...(regulatedWindow?[['cedear_prepare',1,async()=>{
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
        if(this.setting().preparedDate===today)return;
        const result=await this.engine('regulated').processCedears(0,Date.now(),true);
        if(result.complete||result.done||result.in_progress===false)this.saveSetting({...this.setting(),preparedDate:today});
      }]]:[]),
      ['retention',360,()=>this.store.cleanup()]
    ];
    try{
      const due=tasks.filter(([name,interval])=>{const row=this.job(name),job=row?JSON.parse(row.value):null;
        return !job||Math.floor((job.last_slot??-1)/interval)<Math.floor(slot/interval);}).sort((a,b)=>{
        const age=name=>{const row=this.job(name);return row?Date.parse(JSON.parse(row.value).last_end)||0:0;};
        return age(a[0])-age(b[0]);})[0];
      if(due){await this.runJob(due[0],slot,due[2]);if(!this.setting().enabled)return;await this.ctx.storage.setAlarm(Date.now()+1000);}
      else await this.ctx.storage.setAlarm((slot+1)*60000+1000);
    }catch(error){
      console.error('Monitor alarm failed: '+String(error.message).slice(0,200));
      if(this.setting().enabled)await this.ctx.storage.setAlarm(Date.now()+60000);
    }
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/health')return json({ok:true,provider:'cloudflare-sqlite',paid_plan_required:false});
    const namespace=env.MONITOR.jurisdiction('eu');
    const stub=namespace.get(namespace.idFromName('mtf-production-v1'));
    if(url.pathname.startsWith('/admin/'))return stub.fetch(request);
    const cache=globalThis.caches?.default;
    let key;
    if(cache){
      const body=request.method==='POST'?await request.clone().text():'';
      if(body.length>2000)return json({error:'Invalid read payload'},413);
      const cacheUrl=new URL(url);cacheUrl.searchParams.set('__read',body);
      key=new Request(cacheUrl,{method:'GET'});
      const hit=await cache.match(key);if(hit)return hit;
    }
    const response=await stub.fetch(request);
    if(cache&&response.status===200){
      const stored=new Response(response.body,response);stored.headers.set('cache-control','public, max-age=20');
      ctx.waitUntil(cache.put(key,stored.clone()));return stored;
    }
    return response;
  }
};
