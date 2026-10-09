'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const handler=require('../api/data.js');
function age(value){
  const time=Date.parse(value);
  assert.ok(Number.isFinite(time),'Missing or invalid source timestamp');
  return Date.now()-time;
}
async function request(query){
  let status=200,body;
  await handler({query},{setHeader(){},status(code){status=code;return this},json(value){body=value}});
  assert.equal(status,200,query.op+' '+(query.market||'')+' HTTP '+status);
  return body;
}
(async()=>{
  const results=[];
  for(const market of ['crypto','cedear','merval']){
    const body=await request({op:'runtime',market});
    assert.ok(Array.isArray(body.liveStates)&&body.liveStates.length>0,market+' must have runtime rows');
    const liveAge=age(body.liveGeneratedAt);
    assert.ok(liveAge>=0&&liveAge<(market==='crypto'?6:20)*60000,market+' runtime is stale');
    if(market==='crypto'){
      const structureAge=age(body.structureGeneratedAt);
      assert.ok(structureAge>=0&&structureAge<20*60000,'Crypto structure is stale');
    }
    results.push({market,rows:body.liveStates.length,openOperations:body.opens.length,
      declaredStaleAssets:body.liveStates.filter(x=>x.stale_data===true).length,
      liveGeneratedAt:body.liveGeneratedAt});
  }
  const stats=await request({op:'stats'});
  assert.ok(Array.isArray(stats.signals),'Stats must expose a signal array');
  const status=await request({op:'status'});
  assert.ok(status.states&&status.database,'Status must expose state and database evidence');
  const report={checkedAt:new Date().toISOString(),readOnly:true,results,
    activeCohortSignals:stats.signals.length,collectionStartedAt:stats.collectionStartedAt,
    strategyPerformanceValidated:false,
    observations:{
      currentHttpErrors:status.errors?.http_5xx_30m??null,
      cedearProviderFailures:status.database?.cedear_work_errors??null,
      schedulerJobs:status.jobs?.length??0
    }};
  if(process.argv[2]){
    const output=path.resolve(process.argv[2]);fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1});
