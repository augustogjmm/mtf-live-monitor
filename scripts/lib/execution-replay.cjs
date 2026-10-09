'use strict';
// Research model: OHLC candles cannot reconstruct actual fills or minute-level BE.
function replay(signals, bars, options={}) {
  const config={feeBps:10,slippageBps:5,latencyMs:60000,maxEntryDelayMs:1800000,
    stopEnabled:true,...options};
  for(const key of ['feeBps','slippageBps','latencyMs','maxEntryDelayMs'])
    if(!Number.isFinite(config[key])||config[key]<0)throw Error('Invalid '+key);
  if(config.feeBps>=10000||config.slippageBps>=10000||typeof config.stopEnabled!=='boolean')
    throw Error('Invalid execution configuration');
  for(let i=0;i<bars.length;i++) {
    const b=bars[i];
    if(![b.t,b.closeTime,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.t>=b.closeTime||
      b.l<=0||b.h<Math.max(b.o,b.c)||b.l>Math.min(b.o,b.c)||
      (i&&b.t<bars[i-1].closeTime))throw Error('Invalid or overlapping candle');
  }
  const trades=[],skipped=[];
  let available=-Infinity;
  for(const signal of [...signals].sort((a,b)=>a.time-b.time)) {
    const long=signal.direction==='LONG',sign=long?1:-1;
    if(!['LONG','SHORT'].includes(signal.direction)||
      ![signal.time,signal.entry,signal.stop,signal.tp1].every(Number.isFinite)||
      signal.entry<=0||signal.stop<=0||signal.tp1<=0||
      sign*(signal.entry-signal.stop)<=0||sign*(signal.tp1-signal.entry)<=0)
      throw Error('Invalid signal');
    if(signal.time<available){skipped.push({time:signal.time,reason:'position_already_open'});continue}
    const index=bars.findIndex(b=>b.t>=signal.time+config.latencyMs);
    if(index<0||bars[index].t-signal.time>config.maxEntryDelayMs){
      skipped.push({time:signal.time,reason:'no_timely_entry_bar'});continue;
    }
    const slip=config.slippageBps/10000,entry=bars[index].o*(1+sign*slip),
      risk=sign*(entry-signal.stop);
    if(risk<=0||sign*(signal.tp1-entry)<=0){
      skipped.push({time:signal.time,reason:'entry_outside_plan'});continue;
    }
    let exit=null,exitTime=null,reason='OPEN',ambiguous=false;
    for(const b of bars.slice(index)) {
      const stop=config.stopEnabled&&(long?b.l<=signal.stop:b.h>=signal.stop),
        target=long?b.h>=signal.tp1:b.l<=signal.tp1;
      if(!stop&&!target)continue;
      // Resolve a gap at the opening price before the candle's later extremes.
      const gapStop=config.stopEnabled&&(long?b.o<=signal.stop:b.o>=signal.stop),
        gapTarget=long?b.o>=signal.tp1:b.o<=signal.tp1;
      if(gapStop){exit=b.o;reason='STOP_GAP'}
      else if(gapTarget){exit=signal.tp1;reason='TARGET_GAP'}
      else if(stop){exit=signal.stop;reason='STOP';ambiguous=target}
      else {exit=signal.tp1;reason='TARGET'}
      exit*=1-sign*slip;
      // The precise intrabar exit time is unavailable; reserve the entire bar.
      exitTime=b.closeTime;break;
    }
    const closed=exit!==null,mark=closed?exit:bars.at(-1).c,
      fees=entry*config.feeBps/10000+(closed?exit*config.feeBps/10000:0),
      pnl=sign*(mark-entry)-fees;
    trades.push({signalTime:signal.time,entryTime:bars[index].t,entry,initialRisk:risk,
      exit,exitTime,reason,ambiguous,fees,netR:closed?pnl/risk:null,
      unrealizedR:closed?null:pnl/risk});
    available=closed?exitTime:Infinity;
  }
  const closed=trades.filter(t=>t.netR!==null),wins=closed.filter(t=>t.netR>0),
    grossWins=wins.reduce((sum,t)=>sum+t.netR,0),
    grossLosses=-closed.filter(t=>t.netR<0).reduce((sum,t)=>sum+t.netR,0);
  return {config,trades,skipped,metrics:{entered:trades.length,closed:closed.length,
    open:trades.length-closed.length,ambiguous:trades.filter(t=>t.ambiguous).length,
    winRate:closed.length?wins.length/closed.length:null,
    expectancyNetR:closed.length?closed.reduce((sum,t)=>sum+t.netR,0)/closed.length:null,
    profitFactor:grossLosses?grossWins/grossLosses:null,
    evidence:closed.length?'RESEARCH_ONLY':'INSUFFICIENT_TRADES'}};
}
module.exports={replay};
