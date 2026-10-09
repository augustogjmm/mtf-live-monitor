'use strict';
const assert=require('node:assert/strict');
const {loadEngine}=require('../scripts/lib/strategy-runtime.cjs');
const variables={SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'ENV_FIXTURE',
  SUPABASE_ANON_KEY:'PUBLIC_FIXTURE'};
const jwt=role=>'e30.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature_fixture';
const request=token=>new Request('https://local.test',{headers:{authorization:'Bearer '+token}});
(async()=>{
  for(const name of ['mtf-crypto-engine','mtf-adr-engine','mtf-daily-backfill','mtf-alert-watcher']){
    let calls=0;
    const accepted=loadEngine(name,{variables,fetch:async(url,init)=>{
      calls++;
      assert.equal(url,'https://project.example/rest/v1/rpc/mtf_engine_auth_status');
      assert.equal(init.headers.apikey,'PUBLIC_FIXTURE');
      assert.equal(init.headers.authorization,'Bearer '+jwt('service_role'));
      return new Response('true',{status:200});
    }}).rules.authorizedEngineRequest;
    assert.equal(await accepted(request('ENV_FIXTURE')),true);
    assert.equal(calls,0,'Existing cron credential must not require a remote request');
    assert.equal(await accepted(request(jwt('anon'))),false);
    assert.equal(await accepted(request('malformed')),false);
    assert.equal(calls,0,'Public and malformed credentials must be rejected before the RPC');
    assert.equal(await accepted(request(jwt('service_role'))),true);
    assert.equal(calls,1,'A different service JWT requires independent database verification');
    for(const proof of [async()=>new Response('false'),async()=>new Response('{}',{status:401}),
      async()=>{throw Error('Database unavailable')}]){
      const verify=loadEngine(name,{variables,fetch:proof}).rules.authorizedEngineRequest;
      assert.equal(await verify(request(jwt('service_role'))),false,
        'Claiming service_role cannot bypass signature verification or database failure');
    }
    const missing=loadEngine(name,{variables:{SUPABASE_URL:variables.SUPABASE_URL}}).rules.authorizedEngineRequest;
    assert.equal(await missing(request('undefined')),false);
  }
  console.log('PASS: engine authentication, existing cron keys, verified service JWT, public denial and fail-closed proof');
})().catch(e=>{console.error(e);process.exitCode=1});
