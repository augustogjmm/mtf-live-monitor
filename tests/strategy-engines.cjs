'use strict';
const assert = require('node:assert/strict');
const {loadEngine} = require('../scripts/lib/strategy-runtime.cjs');
(async()=>{
  const adr = loadEngine('mtf-adr-engine');
  const certificate = adr.rules.selftest();
  assert.equal(certificate.total, 8);
  assert.equal(certificate.passed, certificate.total);
  const credential=require('node:crypto').randomUUID();
  const authorizedAdr=loadEngine('mtf-adr-engine',{variables:{SUPABASE_SERVICE_ROLE_KEY:credential}});
  const certifiedResponse=await authorizedAdr.handler(new Request('http://local.test',{
    method:'POST',headers:{authorization:'Bearer '+credential},body:'{"mode":"selftest"}'
  }));
  assert.equal(certifiedResponse.status,200);
  assert.equal((await certifiedResponse.json()).ok,true);
  for (const engine of ['mtf-adr-engine','mtf-crypto-engine','mtf-daily-backfill']) {
    const runtime = loadEngine(engine);
    for (const authorization of [null, 'Bearer undefined', 'Bearer invalid']) {
      const headers = authorization?{authorization}:{};
      const r = await runtime.handler(new Request('http://local.test', {method:'POST',headers,body:'{}'}));
      assert.equal(r.status, 401, engine + ' must fail closed without credentials');
    }
  }
  const crypto = loadEngine('mtf-crypto-engine').rules;
  const snapshot = {context:{macd:2,signal:1,histogram:1,histogramPrev:.5,trend:'ALCISTA',
    structure:'ALCISTA',atr14:4},macroContext:{h4:{trend:'ALCISTA'}}};
  assert.equal(crypto.directionEligibility('LONG',snapshot).eligible, true);
  assert.equal(crypto.directionEligibility('SHORT',snapshot).eligible, false);
  assert.equal(crypto.directionEligibility('LONG',
    {...snapshot,macroContext:{h4:{trend:'BAJISTA'}}}).eligible, false);
  assert.equal(crypto.directionEligibility('LONG',
    {...snapshot,context:{...snapshot.context,macd:null,signal:null}}).contextOk, false);
  const level={rank:1,point:95,side:'below',detectorSide:'bull',
    ob:{origin:1,confirm:6,originTime:1,confirmTime:6,bottom:90,top:100,avg:95}};
  const bar={t:10000,o:94,h:99,l:92,c:97,v:100};
  assert.equal(crypto.rejectsZone(bar,level,'LONG'), true);
  assert.equal(crypto.rejectsZone({...bar,o:97,c:94},level,'LONG'), false);
  const planSnapshot={...snapshot,ladder:{above:[{
    rank:1,point:112,zone_top:113,zone_bottom:111,side:'above'
  }]}};
  const plan=crypto.tradePlan('LONG',level,planSnapshot,bar.c);
  assert.equal(plan.stop,89);
  assert.equal(plan.tp1,112);
  assert.equal(plan.rr,1.875);
  assert.equal(crypto.tradePlan('LONG',level,{...planSnapshot,ladder:{above:[{point:104}]}},bar.c),null);
  assert.equal(crypto.tradePlan('LONG',level,{...planSnapshot,context:{atr14:null}},bar.c),null);
  const daily=loadEngine('mtf-daily-backfill').rules;
  assert.equal(daily.regulatedLiveDiagnostic([],100).ready,false);
  const cedearBar={...bar,t:2*86400000};
  assert.equal(daily.confirmedCedearRecovery(cedearBar,level,snapshot),true);
  assert.equal(daily.confirmedCedearRecovery({...cedearBar,h:90},level,snapshot),false);
  assert.equal(daily.confirmedCedearRecovery({...cedearBar,t:1000},level,snapshot),false);
  const cedearSnapshot={...planSnapshot,context:{...snapshot.context,histogramPrev:.5},
    macroContext:{w1:{trend:'ALCISTA'}},trigger:cedearBar};
  assert.equal(daily.regulatedRiskProfile(cedearSnapshot).relation,'A_FAVOR');
  assert.equal(daily.regulatedRiskProfile({...cedearSnapshot,macroContext:{w1:{trend:'BAJISTA'}}}).relation,'SIN_CONFIRMACION');
  console.log('PASS: full production engines, 8 ADR invariants, authorization, context, rejection and trade risk');
})().catch(error=>{console.error(error);process.exitCode=1});
