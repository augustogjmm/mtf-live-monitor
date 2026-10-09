'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ORIGIN='https://mtf-monitor.vercel.app';
async function verify(fetcher=fetch) {
  const checks=[];
  async function read(route,json=true){
    const response=await fetcher(ORIGIN+route,{redirect:'error',signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200,route+' must return HTTP 200');
    checks.push({route,status:response.status});
    return json?response.json():response.text();
  }
  const health=await read('/api/data?op=health');
  assert.equal(health.ok,true);
  assert.equal(health.ui_version,'6.3.3');
  assert.equal(health.build_id,'MTF-MONITOR-FORWARD-SAFETY');
  const html=await read('/',false);
  assert.ok(html.includes('command-center.js?v=6.3.3-egress-reduction'),'Expected frontend build is missing');
  const javascript=await read('/command-center.js',false);
  assert.ok(javascript.includes('runtimeFresh'),'Expected dashboard implementation is missing');
  const markets=[];
  for(const market of ['crypto','cedear','merval']){
    const body=await read('/api/data?op=runtime&market='+market+'&view=monitor');
    assert.ok(Array.isArray(body.liveStates)&&body.liveStates.length,market+' has no runtime');
    assert.ok(Array.isArray(body.opens),market+' has no operation state');
    const age=Date.now()-Date.parse(body.liveGeneratedAt);
    assert.ok(Number.isFinite(age)&&age>=0&&age<(market==='crypto'?6:20)*60000,market+' runtime is stale');
    if(market==='crypto'){
      const structureAge=Date.now()-Date.parse(body.structureGeneratedAt);
      assert.ok(Number.isFinite(structureAge)&&structureAge>=0&&structureAge<20*60000,'Crypto structure is stale');
    }
    markets.push({market,rows:body.liveStates.length,openOperations:body.opens.length,
      staleAssets:body.liveStates.filter(x=>x.stale_data===true).length});
  }
  const stats=await read('/api/data?op=stats');
  assert.ok(Array.isArray(stats.signals),'Statistics response is invalid');
  const status=await read('/api/data?op=status');
  assert.ok(status.states&&status.database,'System status is invalid');
  return {checkedAt:new Date().toISOString(),origin:ORIGIN,readOnly:true,checks,markets,
    activeCohortSignals:stats.signals.length,currentHttpErrors:status.errors?.http_5xx_30m??null,
    strategyPerformanceValidated:false};
}
if(require.main===module) verify().then(report=>{
  if(process.argv[2]){
    const output=path.resolve(process.argv[2]);fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report,null,2));
}).catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={verify};
