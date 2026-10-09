'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const slugs=['mtf-crypto-engine','mtf-adr-engine','mtf-daily-backfill','mtf-alert-watcher'];
async function main(){
  const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.MTF_SUPABASE_PROJECT_REF;
  if(!token||!/^[a-z]{20}$/.test(ref||''))
    throw Error('Set secure SUPABASE_ACCESS_TOKEN and MTF_SUPABASE_PROJECT_REF');
  const deploy=process.argv.includes('--deploy');
  if(process.argv.slice(2).some(arg=>arg!=='--deploy'))throw Error('Unknown argument');
  const base='https://api.supabase.com/v1/projects/'+ref+'/functions';
  const directory=path.resolve('artifacts/edge-'+Date.now());fs.mkdirSync(directory,{recursive:true});
  async function request(url,options={}){
    const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers},
      signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('Supabase Management HTTP '+response.status);
    return response;
  }
  async function upload(slug,metadata,bundleOnly){
    const form=new FormData();
    form.set('metadata',JSON.stringify({entrypoint_path:'index.ts',verify_jwt:metadata.verify_jwt,name:metadata.name}));
    form.append('file',new Blob([fs.readFileSync('supabase/functions/'+slug+'/index.ts')],
      {type:'application/typescript'}),'index.ts');
    return (await request(base+'/deploy?slug='+slug+(bundleOnly?'&bundleOnly=true':''),
      {method:'POST',body:form})).json();
  }
  const checks=[];
  // Compile all functions before any deployment; preserve existing JWT settings.
  for(const slug of slugs){
    const before=await(await request(base+'/'+slug)).json();
    if(before.verify_jwt!==true)throw Error('Unexpected JWT configuration: '+slug);
    const backup=Buffer.from(await(await request(base+'/'+slug+'/body')).arrayBuffer());
    fs.writeFileSync(path.join(directory,slug+'.bundle'),backup);
    fs.writeFileSync(path.join(directory,slug+'.metadata.json'),JSON.stringify(before,null,2));
    await upload(slug,before,true);
    const unchanged=await(await request(base+'/'+slug)).json();
    if(unchanged.version!==before.version)throw Error('Version changed during compile: '+slug);
    checks.push({slug,versionBefore:before.version,verifyJwt:before.verify_jwt,
      backupSha256:createHash('sha256').update(backup).digest('hex'),
      sourceSha256:createHash('sha256').update(fs.readFileSync('supabase/functions/'+slug+'/index.ts')).digest('hex'),
      metadata:before});
    console.log(slug+': compilation passed; deployed version '+before.version);
  }
  if(deploy)for(const check of checks){
    const latest=await(await request(base+'/'+check.slug)).json();
    if(latest.version!==check.versionBefore)throw Error('Concurrent deployment detected: '+check.slug);
    const result=await upload(check.slug,check.metadata,false);
    const actual=await(await request(base+'/'+check.slug)).json();
    if(actual.version!==result.version||actual.status!=='ACTIVE'||actual.verify_jwt!==check.verifyJwt)
      throw Error('Deployment verification failed: '+check.slug);
    check.versionAfter=actual.version;
    console.log(check.slug+': deployed ACTIVE version '+actual.version);
  }
  const report={checkedAt:new Date().toISOString(),projectRef:ref,deployed:deploy,
    results:checks.map(({metadata,...check})=>check)};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log('Report: '+path.join(directory,'report.json'));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
