'use strict';
// Research only: never writes signals or changes the production registry.
const fs=require('node:fs'),path=require('node:path');
const {loadEngine}=require('./lib/strategy-runtime.cjs');
const {replay}=require('./lib/execution-replay.cjs');
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw Error('Usage: node scripts/compare-ob-strategies.cjs <history-cache> <report.json>');
const results=[];
for(const symbol of ['BTCUSDT','ETHUSDT']){
 const read=interval=>JSON.parse(fs.readFileSync(path.join(directory,symbol+'-'+interval+'.json'))).rows;
 const h1=read('1h'),h4=read('4h'),d1=read('1d'),bars=read('15m'),split=bars[Math.floor(bars.length*.7)].t;
 for(const variant of ['current','one_zone_each_side','h4_pullback_recovery']){
  const clock={now:bars[0].t},rules=loadEngine('mtf-crypto-engine',clock).rules,st=rules.emptyState(),signals=[];
  let i=0;
  for(const bar of bars){
   clock.now=bar.t;
   while(i<h1.length&&h1[i].closeTime<bar.t)rules.step(st,h1[i++]);
   const closed=h1.slice(Math.max(0,i-1000),i),c1=rules.context(closed),c4=rules.context(h4.filter(b=>b.closeTime<bar.t).slice(-1000));
   if(!c1.ready||!c4.ready||d1.filter(b=>b.closeTime<bar.t).length<210)continue;
   const ladder=rules.ladderFromState(st,bar.o);
   if(variant==='current'&&!ladder.complete)continue;
   const below=ladder.below.filter(x=>rules.qualifiedOb(x.ob,closed,'LONG')),above=ladder.above.filter(x=>rules.qualifiedOb(x.ob,closed,'SHORT'));
   if(!below.length||!above.length)continue;
   const snap={context:c1,macroContext:{h4:c4},ladder:{below:below.map(rules.publicLevel),above:above.map(rules.publicLevel)}};
   for(const {direction,level} of [...below.map(level=>({direction:'LONG',level})),...above.map(level=>({direction:'SHORT',level}))].sort((a,b)=>a.level.rank-b.level.rank)){
    const long=direction==='LONG';
    const eligible=variant==='h4_pullback_recovery'?c4.trend===(long?'ALCISTA':'BAJISTA')&&c1.structure!==(long?'BAJISTA':'ALCISTA')&&(long?c1.histogram>c1.histogramPrev:c1.histogram<c1.histogramPrev):rules.directionEligibility(direction,snap).eligible;
    if(!eligible||level.ob.confirmTime+3600000>bar.t||!rules.rejectsZone(bar,level,direction)||(long?bar.c>level.ob.top+.25*c1.atr14:bar.c<level.ob.bottom-.25*c1.atr14))continue;
    const plan=rules.tradePlan(direction,level,snap,bar.c);
    if(plan){signals.push({time:bar.closeTime,entry:bar.c,direction,stop:plan.stop,tp1:plan.tp1});break;}
   }
  }
  for(const phase of ['train','holdout']){
   const selected=signals.filter(s=>phase==='train'?s.time<split:s.time>=split),period=bars.filter(b=>phase==='train'?b.closeTime<split:b.t>=split);
   results.push({symbol,variant,phase,from:period[0].t,to:period.at(-1).closeTime,confirmations:selected.length,...replay(selected,period).metrics});
  }
 }
}
const eligibleTraining=['one_zone_each_side','h4_pullback_recovery'].filter(variant=>{const rows=results.filter(r=>r.variant===variant&&r.phase==='train');const n=rows.reduce((a,r)=>a+r.closed,0);return n>=30&&rows.reduce((a,r)=>a+(r.expectancyNetR||0)*r.closed,0)>0;});
const report={generatedAt:new Date().toISOString(),kind:'ORDER_BLOCK_RESEARCH',approvedForLive:false,eligibleTraining,selectionUsesHoldout:false,feeBpsPerFill:10,slippageBpsPerFill:5,results,limitations:['Two selected crypto assets; 30 days, not a complete market universe.','70/30 chronological split; shared exposure and portfolio allocation not simulated.','No minute-level break-even reconstruction; ambiguous stop/target candles resolve adversely.','No variant can be activated from this research report.']};
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
