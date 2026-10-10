'use strict';
// Credentials belong in secure environment settings, never in CLI arguments or reports.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const worker='mtf-monitor-backend',directory=path.resolve('artifacts/cloudflare');
async function main(){
 execFileSync(process.execPath,['scripts/build-cloudflare.cjs'],{stdio:'inherit'});
 if(!process.argv.includes('--deploy')){console.log('Built only. Deployment requires --deploy and secure Cloudflare configuration.');return}
 const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
 if(!token||!/^[a-f0-9]{32}$/i.test(account||''))throw Error('Configure CLOUDFLARE_API_TOKEN securely and CLOUDFLARE_ACCOUNT_ID before deployment');
 const root='https://api.cloudflare.com/client/v4/accounts/'+account;
 async function api(route,method='GET',body){
  const multipart=body instanceof FormData;
  const response=await fetch(root+route,{method,headers:{authorization:'Bearer '+token,...(body&&!multipart?{'content-type':'application/json'}:{})},
   body:body?(multipart?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(60000)});
  const value=await response.json();if(!response.ok||!value.success){
   const error=Error('Cloudflare '+method+' '+route+' failed (HTTP '+response.status+'); inspect account permissions and free-plan availability');error.status=response.status;throw error;
  }return value.result;
 }
 // A workers.dev subdomain must exist on the user's own account.
 const subdomain=await api('/workers/subdomain');
 if(!subdomain.subdomain)throw Error('Enable Workers and configure a workers.dev subdomain in the Cloudflare dashboard');
 let existing=false;try{await api('/workers/scripts/'+worker+'/settings');existing=true}catch(error){if(error.status!==404)throw error}
 const metadata={main_module:'cloudflare-worker.mjs',compatibility_date:'2026-10-01',keep_bindings:['secret_text'],
  bindings:[{type:'durable_object_namespace',name:'MONITOR',class_name:'MtfMonitor'}],
  ...(!existing?{migrations:{new_tag:'v1',steps:[{new_sqlite_classes:['MtfMonitor']}]}}:{})};
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 for(const name of fs.readdirSync(directory).filter(x=>x.endsWith('.mjs')))
  form.set(name,new Blob([fs.readFileSync(path.join(directory,name))],{type:'application/javascript+module'}),name);
 await api('/workers/scripts/'+worker,'PUT',form);
 const adminToken=crypto.randomBytes(32).toString('hex');
 await api('/workers/scripts/'+worker+'/secrets','PUT',{name:'ADMIN_TOKEN',text:adminToken,type:'secret_text'});
 // Telegram is optional. Omit it unless an actual bot token is securely configured.
 if(process.env.TELEGRAM_BOT_TOKEN)await api('/workers/scripts/'+worker+'/secrets','PUT',{name:'TELEGRAM_BOT_TOKEN',text:process.env.TELEGRAM_BOT_TOKEN,type:'secret_text'});
 await api('/workers/scripts/'+worker+'/subdomain','POST',{enabled:true,previews_enabled:false});
 const origin='https://'+worker+'.'+subdomain.subdomain+'.workers.dev';
 const admin=async(route,body)=>{
  const response=await fetch(origin+'/admin/'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+adminToken,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const value=await response.json();if(!response.ok)throw Error('Backend admin '+route+' failed (HTTP '+response.status+'): '+String(value.error||'unknown error'));return value;
 };
 const importIndex=process.argv.indexOf('--import');
 if(importIndex>=0){
  const file=process.argv[importIndex+1];if(!file||file.startsWith('--'))throw Error('--import requires a private backup file');
  const input=fs.readFileSync(file),decoded=file.endsWith('.gz')?zlib.gunzipSync(input):input;
  const parsed=JSON.parse(decoded.toString()),backup=Array.isArray(parsed)?parsed[0]?.backup:parsed.backup||parsed;
  await admin('import',backup);
  const status=await admin('status'),counts=new Map(status.records.map(x=>[x.bucket,x.rows]));
  for(const [bucket,rows] of Object.entries(backup))if(counts.get(bucket)!==rows.length)throw Error('Imported count mismatch: '+bucket);
  console.log('Private backup imported and every table count verified; engines remain stopped.');
 }
 const health=await fetch(origin+'/health',{signal:AbortSignal.timeout(15000)});if(!health.ok||(await health.json()).provider!=='cloudflare-sqlite')throw Error('Backend health verification failed');
 if(process.argv.includes('--stop'))await admin('stop',{});
 const status=await admin('status');
 if(process.argv.includes('--stop')&&process.argv.includes('--activate'))throw Error('Choose either --stop or --activate');
 if(process.argv.includes('--activate')){
  if(!status.records.some(x=>x.bucket==='mtf_analyzer_state'&&x.rows>0))throw Error('Import detector state before activation');
  await admin('start',{});console.log('Engines activated with baseline cycles; verify fresh heartbeats before trusting new signals.');
 }
 const report={provider:'cloudflare-sqlite',origin,generated_at:new Date().toISOString(),engine_activation_requested:process.argv.includes('--activate')};
 fs.writeFileSync(path.join(directory,'deployment.json'),JSON.stringify(report,null,2)+'\n');
 console.log('Backend URL: '+origin+'; set MTF_BACKEND_URL in Vercel and redeploy. No paid plan was requested.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
