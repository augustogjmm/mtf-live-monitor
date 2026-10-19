'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {features,catalog,backtest}=require('./lib/broad-research.cjs');
const {binanceRows,DAY}=require('./lib/daily-research.cjs');
const {mix,metrics,stitch,diverse}=require('./lib/research-portfolio.cjs');
const [source,out]=process.argv.slice(2);if(!out)throw Error('Usage: node scripts/search-strategy-portfolios.cjs SOURCE OUTPUT');
const read=f=>JSON.parse(fs.readFileSync(path.join(source,f))),manifest=read('data-manifest.json'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(manifest.failures.length)throw Error('Invalid source manifest');for(const f of manifest.files)if(hash(fs.readFileSync(path.join(source,'raw',f.name)))!==f.sha256)throw Error('Modified raw data');
const policies=[];for(const score of ['cagr','calmar','stress'])for(const count of [1,3,5])for(const allocation of [.5,1])policies.push({score,count,allocation,id:[score,count,allocation].join('-')});
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify({kind:'EXPLORATORY_PORTFOLIO_IMPROVEMENT',policies,sourceManifestSha256:hash(fs.readFileSync(path.join(source,'data-manifest.json'))),trainYears:3,folds:['2023','2024','2025','2026-partial'],rules:'Filter active training models: base drawdown <=25%, >=20 closed trades, positive base and tripled-cost CAGR. Select distinct families. Within-window capital is not rebalanced. Primary policy selection maximizes training Calmar (annualized profit/drawdown) subject to training drawdown <=25%; the prior CAGR-selected procedure is the control. No eligible policy means cash.',limitations:['Previously inspected history: not an independent holdout.','No leverage, spot long-only, six surviving liquid crypto assets.','Portfolio sub-strategies can hold opposing cash/risk exposures; fees are charged per simulated sleeve, no free order netting.','The original CEDEAR comparison is not extended by this crypto-only experiment.']},null,2),{flag:'wx'});
const result={approvedForLive:false,identity:Object.fromEntries([__filename,'scripts/lib/research-portfolio.cjs','scripts/lib/broad-research.cjs','scripts/lib/daily-research.cjs'].map(f=>[path.basename(f),hash(fs.readFileSync(f))])),markets:{}};
const specs=catalog().filter(s=>s.family!=='buyHold'&&s.allocation===1),symbols=read('protocol.json').crypto;
for(const tf of ['1d','4h']){
 const series=Object.fromEntries(symbols.map(s=>[s,features(binanceRows(read('raw/'+s+'-'+tf+'-binance.json')))])),windows=['2023-01-01','2024-01-01','2025-01-01','2026-01-01','2026-10-17'],folds=[],policyCurves=Object.fromEntries(policies.map(p=>[p.id,[]])),selectedCurves={base:[],cost3:[],delay1:[]};
 const run=(spec,a,b,cost=1,delay=0)=>backtest(series,spec,{from:a,to:b,fee:.001*cost,slip:.0005*cost,delay});
 for(let i=0;i<windows.length-1;i++){
  const from=Date.parse(windows[i]),to=Date.parse(windows[i+1])-1,trainFrom=from-3*365.25*DAY;
  const ranking=[];for(const spec of specs){const b=run(spec,trainFrom,from-1);if(b.drawdown>.25||b.trades<20||b.cagr<=0)continue;const stress=run(spec,trainFrom,from-1,3);if(stress.cagr<=0)continue;ranking.push({spec,cagr:b.cagr,calmar:b.calmar,stress:stress.cagr});}
  const cache=new Map(),curve=(spec,a,b,cost=1,delay=0)=>{const key=[spec.id,a,b,cost,delay].join(':');if(!cache.has(key))cache.set(key,run(spec,a,b,cost,delay).curve);return cache.get(key);};
  const choices=policies.map(policy=>{const selected=diverse([...ranking].sort((a,b)=>b[policy.score]-a[policy.score]),policy.count);if(!selected.length)return {policy,models:[],train:null};const curves=selected.map(x=>curve(x.spec,trainFrom,from-1)),weights=selected.map(()=>policy.allocation/selected.length),train=metrics(mix(curves,weights,1-policy.allocation));return {policy,models:selected.map(x=>x.spec),weights,train};});
  const chosen=choices.filter(x=>x.train&&x.train.maxDrawdown<=.25&&x.train.cagr>0).sort((a,b)=>b.train.calmar-a.train.calmar||b.train.cagr-a.train.cagr)[0]||null;
  const evaluate=(choice,cost=1,delay=0)=>choice?.models.length?mix(choice.models.map(s=>curve(s,from,to,cost,delay)),choice.weights,1-choice.policy.allocation):curve({family:'buyHold',stop:0,allocation:0,id:'cash'},from,to);
  for(const c of choices)policyCurves[c.policy.id].push(evaluate(c));
  const summary={from:windows[i],to:windows[i+1],eligibleModels:ranking.length,chosen,trainRanking:choices.map(c=>({policy:c.policy,models:c.models,train:c.train}))};
  for(const [name,cost,delay]of [['base',1,0],['cost3',3,0],['delay1',1,1]]){const c=evaluate(chosen,cost,delay);selectedCurves[name].push(c);summary[name]=metrics(c);}
  folds.push(summary);console.log(tf,windows[i],chosen?.policy.id||'CASH',summary.base.return);
 }
 result.markets[tf]={folds,selectedWalkForward:Object.fromEntries(Object.entries(selectedCurves).map(([k,v])=>[k,metrics(stitch(v))])),retrospectivePolicyRanking:policies.map(p=>({policy:p,metrics:metrics(stitch(policyCurves[p.id]))})).sort((a,b)=>b.metrics.return-a.metrics.return),note:'Policy ranking reuses test windows; it does not choose the reported training-selected walk-forward policy.'};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2),{flag:tf==='1d'?'wx':'w'});
}
