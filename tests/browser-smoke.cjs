'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const now=Date.now(),fresh=new Date(now).toISOString();
const level={rank:1,point:100,zone_bottom:95,zone_top:105};
function row(symbol,market){
  return {symbol,market,t:now-900000,price:100,updated_at:fresh,state:'IN_ZONE',ready:true,
    context:{trend:'ALCISTA',atr14:4,macd:2,signal:1},
    macroContext:{h1:{trend:'ALCISTA'},h4:{trend:'ALCISTA'},w1:{trend:'ALCISTA'}},
    ladder:{below:[level],above:[{...level,point:120}]},
    proximity:{state:'IN_ZONE',nearest:{...level,direction:'LONG'}}};
}
let fail=false;
function payload(url){
  const op=url.searchParams.get('op'),market=url.searchParams.get('market');
  if(op==='runtime'){
    const liveStates=market==='crypto'?[row('BTC','crypto'),...Array.from({length:24},(_,i)=>row('TEST'+i,'crypto'))]:
      market==='cedear'?[row('AAPL','cedear')]:[row('GGAL','merval')];
    return {opens:[],liveStates,structureStates:market==='crypto'?liveStates:[],
      liveGeneratedAt:fresh,structureGeneratedAt:fresh};
  }
  if(op==='stats')return {signals:[],summary:{total:0},generatedAt:fresh};
  if(op==='status')return {states:{market_guard:{meta:{combined:{code:'LIVE',actionable:true}}},
    crypto_live:{last_run_at:fresh},crypto_structure:{last_run_at:fresh},regulated_live:{last_run_at:fresh}},
    jobs:[{active:true,last_status:'succeeded'}],database:{last_write:fresh},
    alerts:{telegram_linked:true,last_watcher_at:fresh},api_generated_at:fresh};
  if(op==='history'||op==='merval-history')return {data:{'1d':[]}};
  return {};
}
(async()=>{
  const child=spawn(process.execPath,['scripts/dev-server.cjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let browser;
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Development server startup timeout')),10000);
      child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code)));
      child.stdout.on('data',data=>{const m=String(data).match(/MTF local server ready (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]))}});
    });
    const origin='http://127.0.0.1:'+port;
    browser=await chromium.launch({headless:true,
      ...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{}),
      args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Argentina/Buenos_Aires'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const apiRequests=[];
    await page.clock.install();
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin&&url.pathname==='/api/data'){
        apiRequests.push(url);
        await route.fulfill(fail?{status:503,json:{error:'Test upstream outage'}}:{json:payload(url)});
      }else if(url.origin===origin)await route.continue();
      else if(url.hostname==='api.binance.com'){
        await route.fulfill({status:451,json:{error:'Test regional restriction'}});
      }else if(url.hostname.includes('binance')){
        await route.fulfill({json:Array.from({length:60},(_,i)=>[now-(60-i)*3600000,99,102,98,100,10,now-(59-i)*3600000])});
      }else await route.abort();
    });
    const alternateChart=page.waitForResponse(r=>r.url().includes('data-api.binance.vision')&&r.status()===200);
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('#ccOppBody tr[data-ccsym]').first().waitFor();
    await alternateChart;
    assert.ok(apiRequests.filter(x=>x.searchParams.get('op')==='runtime')
      .every(x=>x.searchParams.get('view')==='monitor'),'Monitor must use compact reads');
    assert.ok(apiRequests.every(x=>!x.searchParams.has('_')),'Polling must use shared cache keys');
    await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
    const beforeHidden=apiRequests.length;
    await page.clock.runFor(61000);
    await page.waitForTimeout(100);
    assert.equal(apiRequests.length,beforeHidden,'Hidden tabs must not poll any backend');
    const resumed=page.waitForRequest(r=>r.url().includes('op=runtime'));
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await resumed;
    assert.match(await page.locator('#ccRadarBody').innerText(),/ESPERAR CONF\./);
    assert.equal(await page.locator('#ccRadarBody tr[data-ccsym]').count(),20);
    await page.click('#ccRadarNext');
    assert.equal(await page.locator('#ccRadarBody tr[data-ccsym]').count(),5);
    await page.click('#ccRadarPrev');
    await page.click('#tz');
    assert.match(await page.locator('#ccRadarBody').innerText(),/AAPL/);
    assert.match(await page.locator('#ccRadarBody').innerText(),/GGAL/);
    await page.selectOption('#ccRadarUniverse','MERVAL');
    assert.match(await page.locator('#ccRadarBody').innerText(),/GGAL/);
    assert.doesNotMatch(await page.locator('#ccRadarBody').innerText(),/AAPL/);
    await page.fill('#ccRadarSearch','no-such-asset');
    assert.match(await page.locator('#ccRadarBody').innerText(),/SIN DATOS/);
    await page.fill('#ccRadarSearch','GGAL');
    await page.locator('#ccRadarBody tr[data-ccsym="GGAL"]').click();
    assert.match(await page.locator('#ccAssetName').innerText(),/GGAL/);
    await page.click('#ts');
    assert.equal(await page.locator('#vs').isVisible(),true);
    assert.doesNotMatch(await page.locator('#sstate').innerText(),/Error renderizando/);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=390,'Stats page must fit the mobile viewport');
    await page.click('#tm');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=390,'Mobile page must fit the viewport');
    fail=true;
    await page.click('#reload');
    await page.waitForFunction(()=>document.getElementById('ccOpsBody').textContent.includes('No se pudo verificar'));
    assert.match(await page.locator('#ccGlobalTs').innerText(),/DATOS NO DISPONIBLES/);
    assert.match(await page.locator('#ccDetailBody').innerText(),/DATOS NO DISPONIBLES/);
    assert.equal(await page.locator('#ccAssetPrice').innerText(),'—');
    assert.deepEqual(errors,[]);
    console.log('PASS: browser startup, crypto, CEDEAR, ADR, stats, manual confirmation, mobile and API outage');
  }finally{
    if(browser)await browser.close();
    child.kill('SIGTERM');
  }
})().catch(error=>{console.error(error);process.exitCode=1});
