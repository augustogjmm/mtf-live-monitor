// Public market data only. No arbitrary upstream URLs, account data or trading calls.
const HOSTS=['https://api.binance.com','https://data-api.binance.vision'];
const pair=value=>/^[A-Z0-9]{1,20}USDT$/.test(value);
module.exports=async function handler(req,res){
 res.setHeader('cache-control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');
 if(req.method&&req.method!=='GET')return res.status(405).json({error:'Read-only endpoint'});
 let target;
 try{
  const raw=String(req.query?.path||'');if(!raw.startsWith('/api/v3/'))throw Error('Invalid market path');
  target=new URL(raw,HOSTS[0]);if(target.origin!==HOSTS[0])throw Error('Invalid market origin');
  if(target.pathname==='/api/v3/klines'){
   if(!pair(target.searchParams.get('symbol')||'')||!['1m','15m','1h','4h','1d'].includes(target.searchParams.get('interval')))throw Error('Invalid symbol or interval');
   const limit=Number(target.searchParams.get('limit')||1000);if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid candle limit');
   for(const [key,value]of target.searchParams){if(!['symbol','interval','limit','startTime','endTime'].includes(key))throw Error('Invalid parameter');if(['startTime','endTime'].includes(key)&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>Date.now()+86400000))throw Error('Invalid candle timestamp');}
  }else if(target.pathname==='/api/v3/ticker/price'){
   const symbols=JSON.parse(target.searchParams.get('symbols')||'null');
   if(!Array.isArray(symbols)||!symbols.length||symbols.length>50||symbols.some(x=>typeof x!=='string'||!pair(x)))throw Error('Explicit symbols required (maximum 50)');
   if([...target.searchParams.keys()].some(x=>x!=='symbols'))throw Error('Invalid quote parameter');
  }else throw Error('Market route unavailable');
 }catch(error){return res.status(400).json({error:error.message});}
 let status;
 for(const host of HOSTS){
  try{
   const response=await fetch(host+target.pathname+target.search,{headers:{accept:'application/json','user-agent':'MTF-Monitor/6.3.3'},signal:AbortSignal.timeout(8000),redirect:'error'});
   status=response.status;if(!response.ok)continue;
   const data=await response.json();if(!Array.isArray(data))throw Error('Invalid market data');
   res.setHeader('Vercel-CDN-Cache-Control','max-age=30, must-revalidate');return res.status(200).json(data);
  }catch{status=502;}
 }
 return res.status(502).json({error:'Market provider unavailable',upstream_status:status});
};
