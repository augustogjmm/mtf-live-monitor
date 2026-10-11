// Closed H4/D1 context remains unchanged until its UTC candle boundary.
// Live H1/M15 data is never served from this context cache.
export function createMarketFetch(store,{fetch:upstream=globalThis.fetch,origin='https://mtf-monitor.vercel.app'}={}){
 let calls=0;const deadline=Date.now()+45000;
 return async(url,options)=>{
  const parsed=new URL(url),binance=parsed.hostname.endsWith('.binance.com')||parsed.hostname==='data-api.binance.vision';
  let target=url,key,period,expires;
  if(binance){
   if(parsed.pathname==='/api/v3/ticker/price'){
    const state=store.readState('crypto_structure'),symbols=[...new Set((state?.meta?.snapshot||[]).map(x=>String(x.symbol)+'USDT'))];
    if(!symbols.length||symbols.length>50)throw Error('Bounded crypto universe missing');
    parsed.searchParams.set('symbols',JSON.stringify(symbols));
   }
   const interval=parsed.searchParams.get('interval');period=interval==='4h'?14400000:interval==='1d'?86400000:0;
   if(parsed.pathname==='/api/v3/klines'&&period&&!parsed.searchParams.has('startTime')&&!parsed.searchParams.has('endTime')){
    key=parsed.pathname+parsed.search;expires=(Math.floor(Date.now()/period)+1)*period;
    const row=store.rows("SELECT value FROM mtf_records WHERE bucket='market_data_cache' AND record_key=?",key)[0],cached=row?JSON.parse(row.value):null;
    if(cached&&cached.expires>Date.now())return Response.json(cached.data);
   }
   target=origin+'/api/crypto-data?path='+encodeURIComponent(parsed.pathname+parsed.search);
  }
  if(++calls>42)throw Error('Free-plan outbound budget exhausted; retry next scheduled cycle');
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('Scheduled cycle time budget exhausted');
  const timeout=AbortSignal.timeout(remaining),signal=options?.signal?AbortSignal.any([options.signal,timeout]):timeout;
  const headers=new Headers(options?.headers);headers.set('user-agent','MTF-Monitor/6.3.3 (+https://mtf-monitor.vercel.app)');headers.set('accept','application/json');
  const response=await upstream(target,{...options,headers,signal});
  if(key&&response.ok){
   const data=await response.json();if(!Array.isArray(data)||!data.length)throw Error('Invalid candle context');
   if(expires>Date.now())store.put('market_data_cache',key,{expires,data});return Response.json(data);
  }
  return response;
 };
}
