'use strict';
const fs=require('node:fs'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const engines={crypto:['snapshotOne','live','universe','rebuild'],adr:['selftest','run'],
  regulated:['processRegulatedLive','bootstrapCedearUniverse','processCedears'],watcher:['computeMarketGuard']};
const sourceNames={crypto:'mtf-crypto-engine',adr:'mtf-adr-engine',regulated:'mtf-daily-backfill',watcher:'mtf-alert-watcher'};
const output=path.resolve('artifacts/cloudflare');fs.mkdirSync(output,{recursive:true});
for(const [name,exports] of Object.entries(engines)){
  const input=fs.readFileSync('supabase/functions/'+sourceNames[name]+'/index.ts','utf8');
  let code=stripTypeScriptTypes(input,{mode:'transform'}).replace(/^import .*;\s*$/mg,'');
  if(name==='regulated')code=code.replace('.order(\"symbol\").limit(80)', '.order(\"symbol\").limit(16)');
  const wrapper=`export function createEngine(store,options={}) {
    let handler;
    const fetch=options.fetch||globalThis.fetch;
    const engineKey=options.engineKey||crypto.randomUUID();
    const createClient=()=>store;
    const Deno={env:{get:name=>name==='SUPABASE_URL'?'https://local.mtf.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'?engineKey:options.variables?.[name]},serve:fn=>{handler=fn}};
    ${code}
    return {handler,engineKey,${exports.join(',')}};
  }\n`;
  fs.writeFileSync(path.join(output,name+'.mjs'),wrapper);
}
for(const name of ['sqlite-store','public-api','cloudflare-worker'])
  fs.copyFileSync('backend/'+name+'.mjs',path.join(output,name+'.mjs'));
const schema=fs.readFileSync('backend/schema.sql','utf8');
fs.writeFileSync(path.join(output,'schema.mjs'),'export default '+JSON.stringify(schema)+';\n');
console.log('Cloudflare modules built from production engine sources; no SDK or runtime eval');
