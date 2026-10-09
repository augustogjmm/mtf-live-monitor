'use strict';
const assert=require('node:assert/strict');
const {verify}=require('../scripts/validate-deployment.cjs');
function fixture(change=()=>{}){
  return async url=>{
    const route=new URL(url),now=new Date().toISOString();
    let value=route.pathname==='/'?'command-center.js?v=6.3.3-egress-reduction':
      route.pathname==='/command-center.js'?'function runtimeFresh(){}':
      route.searchParams.get('op')==='health'?{ok:true,ui_version:'6.3.3',build_id:'MTF-MONITOR-FORWARD-SAFETY'}:
      route.searchParams.get('op')==='runtime'?{liveStates:[{symbol:'TEST'}],opens:[],liveGeneratedAt:now,structureGeneratedAt:now}:
      route.searchParams.get('op')==='stats'?{signals:[]}:{states:{},database:{}};
    const response={status:200,value};change(route,response);
    return {status:response.status,json:async()=>response.value,text:async()=>response.value};
  };
}
(async()=>{
  const report=await verify(fixture());
  assert.equal(report.checks.length,8);
  assert.equal(report.markets.length,3);
  assert.equal(report.strategyPerformanceValidated,false);
  await assert.rejects(verify(fixture((url,r)=>{r.status=500})),/HTTP 200/);
  await assert.rejects(verify(fixture((url,r)=>{if(url.searchParams.get('op')==='health')r.value.ui_version='old'})),/6.3.3/);
  await assert.rejects(verify(fixture((url,r)=>{if(url.searchParams.get('op')==='runtime')r.value.liveGeneratedAt='2000-01-01'})),/stale/);
  await assert.rejects(verify(fixture((url,r)=>{if(url.searchParams.get('op')==='runtime')r.value.liveStates=[]})),/no runtime/);
  console.log('PASS: deployed build, real endpoint responses, populated markets and source freshness');
})().catch(e=>{console.error(e);process.exitCode=1});
