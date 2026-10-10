const keys={mtf_state:['market'],mtf_analyzer_state:['market','symbol','timeframe'],
  mtf_cedear_work:['run_date','symbol'],mtf_strategy_registry:['version'],
  mtf_alert_delivery_ledger:['fingerprint']};
const allowed=new Set([...Object.keys(keys),'mtf_signals','mtf_decision_audit',
  'mtf_alert_events','mtf_alert_config','mtf_runtime_errors','mtf_jobs']);
const clone=value=>JSON.parse(JSON.stringify(value));
function field(name){if(!/^[a-z_][a-z0-9_]*$/i.test(name))throw Error('Invalid field');return `json_extract(value,'$.${name}')`;}
function project(row,columns){
  if(columns==='*')return row;
  return Object.fromEntries(columns.split(',').map(x=>x.trim()).filter(x=>Object.hasOwn(row,x)).map(x=>[x,row[x]]));
}
export class SQLiteStore {
  constructor(sql,transaction=fn=>fn()){this.sql=sql;this.transaction=transaction;}
  rows(sql,...bindings){return [...this.sql.exec(sql,...bindings)];}
  from(bucket){if(!allowed.has(bucket))throw Error('Unknown table');return new Query(this,bucket);}
  readState(market){
    const row=this.rows('SELECT value FROM mtf_records WHERE bucket=? AND record_key=?','mtf_state',JSON.stringify([market]))[0];
    if(!row)return null;
    const state=JSON.parse(row.value);
    if(state.meta?.__split_snapshot){
      delete state.meta.__split_snapshot;
      state.meta.snapshot=this.rows('SELECT value FROM mtf_records WHERE bucket=? ORDER BY record_key','snapshot:'+market)
        .map(x=>JSON.parse(x.value));
      if(market==='regulated_live')state.meta.snapshot=state.meta.snapshot.map(x=>{
        const t=Number(x.t),age=t>0?Math.max(0,Date.now()-t):Infinity,fresh=x.ready===true&&age<=3600000;
        return {...x,quote_fresh_60m:fresh,quote_age_minutes:Number.isFinite(age)?Math.round(age/60000):null,
          stale_data:!fresh,...(!fresh?{ready:false,actionable:false,state:x.state==='OPEN'?'OPEN':'STALE_DATA'}:{})};
      });
    }
    return state;
  }
  write(bucket,row,existingKey,insertOnly=false){
    const copy=clone(row);
    if(bucket==='mtf_state'&&Array.isArray(copy.meta?.snapshot)){
      const snapshotBucket='snapshot:'+copy.market,seen=new Set();
      for(const [index,item] of copy.meta.snapshot.entries()){
        const snapshot=clone(item);
        // Clock-derived presentation fields change on reads, not on every storage write.
        if(copy.market==='regulated_live')for(const key of ['quote_age_minutes','quote_fresh_60m','stale_data'])delete snapshot[key];
        const key=String(index).padStart(6,'0')+':'+String(snapshot.market||'')+':'+String(snapshot.symbol);
        seen.add(key);this.put(snapshotBucket,key,snapshot);
      }
      for(const old of this.rows('SELECT record_key FROM mtf_records WHERE bucket=?',snapshotBucket))
        if(!seen.has(old.record_key))this.rows('DELETE FROM mtf_records WHERE bucket=? AND record_key=?',snapshotBucket,old.record_key);
      delete copy.meta.snapshot;copy.meta.__split_snapshot=true;
    }
    const key=existingKey||JSON.stringify((keys[bucket]||['id']).map(x=>copy[x]));
    this.put(bucket,key,copy,insertOnly);return row;
  }
  put(bucket,key,value,insertOnly=false){
    const encoded=JSON.stringify(value);
    const previous=this.rows('SELECT value FROM mtf_records WHERE bucket=? AND record_key=?',bucket,key)[0];
    if(previous){
      if(insertOnly)throw Error('UNIQUE record identity');
      if(previous.value!==encoded)this.rows('UPDATE mtf_records SET value=? WHERE bucket=? AND record_key=?',encoded,bucket,key);
    }else this.rows('INSERT INTO mtf_records(bucket,record_key,value) VALUES(?,?,?)',bucket,key,encoded);
  }
  rpc(name,args={}){
    try{
      let data;
      if(name==='mtf_regulated_worker_state')data=this.readState('regulated_live');
      else if(name==='mtf_save_regulated_worker_state'){
        const previous=this.readState('regulated_live'),lookup=new Map((previous?.meta?.snapshot||[]).map(x=>[x.market+':'+x.symbol,x]));
        const row=clone(args.p_state),replaced=new Set(args.p_replaced);
        row.meta.snapshot=row.meta.snapshot.map(x=>replaced.has(x.market+':'+x.symbol)?x:{...lookup.get(x.market+':'+x.symbol),...x});
        this.transaction(()=>this.write('mtf_state',row));data={saved:true};
      }else if(name==='mtf_prealert_inputs'){
        const live=this.readState('crypto_live'),regulated=this.readState('regulated_live'),structure=this.readState('crypto_structure'),previous=this.readState('prealert_live');
        const near=(live?.meta?.snapshot||[]).filter(x=>x.state==='NEAR'),symbols=new Set(near.map(x=>x.symbol));
        data=[live&&{...live,meta:{snapshot:near}},regulated&&{...regulated,meta:{snapshot:(regulated.meta?.snapshot||[]).filter(x=>x.state==='IN_ZONE')}},
          structure&&{...structure,meta:{snapshot:(structure.meta?.snapshot||[]).filter(x=>symbols.has(x.symbol))}},previous].filter(Boolean);
      }else throw Error('Unknown worker RPC');
      return Promise.resolve({data,error:null});
    }catch(error){return Promise.resolve({data:null,error:{message:error.message,code:'SQLITE_ERROR'}});}
  }
  import(backup){
    if(!backup||typeof backup!=='object')throw Error('Invalid backup');
    this.transaction(()=>{
      if(this.rows('SELECT count(*) AS total FROM mtf_records')[0].total)throw Error('Import requires an empty database');
      let maxId=0;
      for(const [bucket,rows] of Object.entries(backup)){
        if(!allowed.has(bucket)||!Array.isArray(rows))throw Error('Unsupported backup table');
        for(const row of rows){this.write(bucket,row);maxId=Math.max(maxId,Number(row.id)||0);}
      }
      if(maxId)this.rows('INSERT INTO mtf_ids(id) VALUES(?)',maxId);
    });
  }
  cleanup(){
    this.rows("DELETE FROM mtf_records WHERE bucket='mtf_cedear_work' AND json_extract(value,'$.run_date')<? AND json_extract(value,'$.run_date')<>(SELECT coalesce(max(json_extract(value,'$.run_date')),'') FROM mtf_records WHERE bucket='mtf_cedear_work' AND json_extract(value,'$.eligible_liquid')=1 AND json_extract(value,'$.metrics.adtv20')>0)",new Date(Date.now()-7*86400000).toISOString().slice(0,10));
    this.rows("DELETE FROM mtf_records WHERE bucket='mtf_decision_audit' AND json_extract(value,'$.evaluated_at')<?",new Date(Date.now()-86400000).toISOString());
    this.rows("DELETE FROM mtf_records WHERE bucket='mtf_runtime_errors' AND json_extract(value,'$.created_at')<?",new Date(Date.now()-3*86400000).toISOString());
  }
}
class Query {
  constructor(store,bucket){this.store=store;this.bucket=bucket;this.filters=[];this.orders=[];this.columns='*';this.operation='select';this.offset=0;}
  select(columns='*',options={}){this.columns=columns;this.options=options;this.returning=true;return this;}
  insert(value){this.operation='insert';this.values=Array.isArray(value)?value:[value];return this;}
  upsert(value,options={}){this.operation='upsert';this.values=Array.isArray(value)?value:[value];this.conflict=options.onConflict?.split(',')||keys[this.bucket]||['id'];this.ignore=options.ignoreDuplicates;return this;}
  update(patch){this.operation='update';this.patch=patch;return this;}
  delete(){this.operation='delete';return this;}
  filter(column,operator,value){this.filters.push({column,operator,value});return this;}
  eq(c,v){return this.filter(c,'=',v)} neq(c,v){return this.filter(c,'<>',v)}
  gt(c,v){return this.filter(c,'>',v)} gte(c,v){return this.filter(c,'>=',v)}
  lt(c,v){return this.filter(c,'<',v)} lte(c,v){return this.filter(c,'<=',v)}
  in(c,v){return this.filter(c,'IN',v)} is(c,v){return this.filter(c,'IS',v)}
  not(c,operator,v){if(operator!=='is'||v!==null)throw Error('Unsupported filter');return this.filter(c,'IS NOT',null);}
  order(column,options={}){this.orders.push({column,ascending:options.ascending!==false});return this;}
  limit(value){this.maximum=value;return this;} range(from,to){this.offset=from;this.maximum=to-from+1;return this;}
  single(){this.one='required';return this;} maybeSingle(){this.one='optional';return this;}
  then(resolve,reject){this.promise??=Promise.resolve().then(()=>this.execute());return this.promise.then(resolve,reject);}
  matches(){
    const args=[this.bucket];let where='bucket=?';
    for(const {column,operator,value} of this.filters){
      const expression=field(column);
      if(operator==='IN'){
        if(!value.length){where+=' AND 0';continue;}
        where+=` AND ${expression} IN (${value.map(()=>'?').join(',')})`;args.push(...value);
      }else if(operator==='IS'||operator==='IS NOT'){
        if(value!==null)throw Error('Only null IS filters supported');where+=` AND ${expression} ${operator} NULL`;
      }else{where+=` AND ${expression} ${operator} ?`;args.push(value===true?1:value===false?0:value);}
    }
    let sql='SELECT record_key,value FROM mtf_records WHERE '+where;
    if(this.orders.length)sql+=' ORDER BY '+this.orders.map(x=>field(x.column)+(x.ascending?' ASC':' DESC')).join(',');
    if(this.maximum!==undefined){sql+=' LIMIT ? OFFSET ?';args.push(this.maximum,this.offset);}
    return this.store.rows(sql,...args).map(x=>({key:x.record_key,row:this.bucket==='mtf_state'?this.store.readState(JSON.parse(x.value).market):JSON.parse(x.value)}));
  }
  execute(){
    try{
      const execute=()=>{
        let rows=[];
        if(this.operation==='select')rows=this.matches().map(x=>x.row);
        else if(this.operation==='update'||this.operation==='delete')for(const current of this.matches()){
          if(this.operation==='delete')this.store.rows('DELETE FROM mtf_records WHERE bucket=? AND record_key=?',this.bucket,current.key);
          else{const row={...current.row,...clone(this.patch)};this.store.write(this.bucket,row,current.key);rows.push(row);}
        }else for(const input of this.values){
          let previous;
          if(this.operation==='upsert'){
            const query=new Query(this.store,this.bucket);
            for(const column of this.conflict)if(input[column]!==undefined)query.eq(column,input[column]);
            if(this.conflict.every(x=>input[x]!==undefined))previous=query.matches()[0];
          }
          if(previous&&this.ignore)continue;
          const row={...(previous?.row||{}),...clone(input)};
          if(!previous&&['mtf_signals','mtf_alert_events','mtf_runtime_errors','mtf_decision_audit'].includes(this.bucket))row.created_at??=new Date().toISOString();
          if(!previous&&this.bucket==='mtf_alert_events'){row.status??='PENDING';row.attempts??=0;}
          if(!keys[this.bucket]&&row.id==null){row.id=this.store.rows('INSERT INTO mtf_ids DEFAULT VALUES RETURNING id')[0].id;}
          this.store.write(this.bucket,row,previous?.key,this.operation==='insert');rows.push(row);
        }
        const count=rows.length;
        rows=rows.map(x=>project(x,this.columns));
        if(this.one&&(rows.length>1||(this.one==='required'&&rows.length!==1)))throw Error('Expected a single row');
        return {data:this.options?.head?null:this.one?(rows[0]||null):rows,error:null,...(this.options?.count?{count}:{})};
      };
      return this.operation==='select'?execute():this.store.transaction(execute);
    }catch(error){return {data:null,error:{message:error.message,code:/UNIQUE/.test(error.message)?'23505':'SQLITE_ERROR'}};}
  }
}
