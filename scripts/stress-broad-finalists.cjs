'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {features,backtest}=require('./lib/broad-research.cjs');
const {binanceRows,yahooRows,bymaRows,attachUnderlying,fxProxy,DAY}=require('./lib/daily-research.cjs');
const [source,reportFile,output]=process.argv.slice(2);if(!output)throw Error('Usage: node scripts/stress-broad-finalists.cjs SOURCE REPORT OUTPUT');
const read=f=>JSON.parse(fs.readFileSync(path.join(source,f))),report=JSON.parse(fs.readFileSync(reportFile)),p=read('protocol.json'),raw=f=>read('raw/'+f),fx=fxProxy(yahooRows(raw('GGAL.BA-yahoo.json')).rows,yahooRows(raw('GGAL-yahoo.json')).rows);
const manifest=read('data-manifest.json');for(const f of manifest.files){if(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'raw',f.name))).digest('hex')!==f.sha256)throw Error('Changed raw file '+f.name);}
if(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'data-manifest.json'))).digest('hex')!==report.sourceManifestSha256)throw Error('Different source manifest');
const engineHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'lib/broad-research.cjs'))).digest('hex');if(report.identity?.['broad-research.cjs']!==engineHash)throw Error('Engine differs from search report');
const answer={reportSha256:crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex'),engineSha256:engineHash,kind:'POST_HOC_FINALIST_STRESS_NOT_NEW_VALIDATION',markets:{}};
for(const [market,r]of Object.entries(report.markets)){
 const local=market==='cedear',tf=market.split('-')[1];
 const series=local?Object.fromEntries(p.cedear.map(s=>[s,attachUnderlying(bymaRows(raw(s+'-byma.json')),features(yahooRows(raw(s.replace('.BA','')+'-yahoo.json')).rows))])):Object.fromEntries(p.crypto.map(s=>[s,features(binanceRows(raw(s+'-'+tf+'-binance.json')))]));
 const top=r.retrospectiveRanking.filter(x=>x.spec.family!=='buyHold'&&x.maxDrawdown<=.25).slice(0,5),unconstrained=r.retrospectiveRanking.find(x=>x.spec.family!=='buyHold');
 const specs=[...new Map([...top,unconstrained].map(x=>[x.spec.id,x.spec])).values()];
 for(const baseline of [unconstrained.spec,top[0]?.spec].filter(Boolean)){const half=r.retrospectiveRanking.find(x=>x.spec.family===baseline.family&&x.spec.allocation===.5&&Object.keys(baseline).every(k=>['id','allocation'].includes(k)||x.spec[k]===baseline[k]));if(half&&!specs.some(s=>s.id===half.spec.id))specs.push(half.spec);}
 answer.markets[market]=specs.map(spec=>{
  const result={spec,stress:{}};
  for(const [key,multiplier,delay]of [['base',1,0],['cost2',2,0],['cost3',3,0],['delay1',1,1],['delay2',1,2]]){
   let capital=1,peak=1,dd=0,trades=0;const foldReturns=[],daily=new Map();
   for(const f of r.folds){const run=backtest(series,spec,{from:Date.parse(f.from),to:Date.parse(f.to)-1,fee:(local?.006:.001)*multiplier,slip:(local?.002:.0005)*multiplier,fx:local?fx:[],delay});
    for(const [t,e]of run.curve){const nav=capital*e;daily.set(Math.floor(t/DAY),nav);peak=Math.max(peak,nav);dd=Math.max(dd,1-nav/peak);}capital*=1+run.return;trades+=run.trades;foldReturns.push(run.return);}
   const years=(Date.parse(r.folds.at(-1).to)-Date.parse(r.folds[0].from))/(365.25*DAY);
   if(key==='base'){const nav=[1,...daily.values()],ret=nav.slice(1).map((v,i)=>v/nav[i]),samples=[];let seed=812731;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};for(let sample=0;sample<1000;sample++){let equity=1,pk=1,drawdown=0;for(let n=0;n<ret.length;){const start=Math.floor(rand()*ret.length);for(let j=0;j<7&&n<ret.length;j++,n++){equity*=ret[(start+j)%ret.length];pk=Math.max(pk,equity);drawdown=Math.max(drawdown,1-equity/pk);}}samples.push({return:equity-1,drawdown});}const returns=samples.map(x=>x.return).sort((a,b)=>a-b),dds=samples.map(x=>x.drawdown).sort((a,b)=>a-b);result.blockResampling={samples:1000,blockSessions:7,seed:812731,p05Return:returns[49],medianReturn:returns[499],p95Drawdown:dds[949],lossFraction:returns.filter(x=>x<0).length/1000,note:'Resamples observed daily returns; conditional scenario distribution, not a confidence interval or future risk guarantee. No correction for choosing finalists from many trials.'};}
   result.stress[key]={return:capital-1,cagr:capital**(1/years)-1,maxDrawdown:dd,trades,foldReturns};
  }
  return result;
 });
 console.log(market,answer.markets[market].map(x=>({id:x.spec.id,...x.stress.base,stress3:x.stress.cost3.return,delay2:x.stress.delay2.return})));
}
fs.writeFileSync(output,JSON.stringify(answer,null,2),{flag:'wx'});
