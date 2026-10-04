(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var CC={context:null,crypto:null,cedear:null,merval:null,stats:null,status:null,cedearPanel:null,mervalPanel:null,filter:'ALL',market:'CRYPTO',radar:'CRYPTO',radarFilter:'ALL',selected:null,busy:false,chartSeq:0};

function num(v,d){v=Number(v);return Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d==null?4:d}):'—'}
function pct(v){v=Number(v);return Number.isFinite(v)?(v>=0?'+':'')+v.toFixed(2)+'%':'—'}
function rr(v){v=Number(v);return Number.isFinite(v)?(v>=0?'+':'')+v.toFixed(2)+'R':'—'}
function mean(a){var x=(a||[]).map(Number).filter(Number.isFinite);return x.length?x.reduce(function(s,v){return s+v},0)/x.length:NaN}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]})}
function json(u,ms){var c=new AbortController(),t=setTimeout(function(){c.abort()},ms||15000);return fetch(u,{cache:'no-store',signal:c.signal}).then(function(r){if(!r.ok)return r.text().then(function(x){throw Error(r.status+' '+x)});return r.json()}).finally(function(){clearTimeout(t)})}
function at(obj,path,def){try{var x=obj;for(var i=0;i<path.length;i++){if(x==null)return def;x=x[path[i]]}return x==null?def:x}catch(e){return def}}
function clsTrend(t){t=String(t||'RANGO').toUpperCase();return t==='ALCISTA'?'cc-up':t==='BAJISTA'?'cc-down':'cc-flat'}
function trendText(t){t=String(t||'RANGO').toUpperCase();return (t==='ALCISTA'?'↑ ':t==='BAJISTA'?'↓ ':'→ ')+t}
function trendHtml(t){return '<span class="'+clsTrend(t)+'">'+esc(trendText(t))+'</span>'}
function stateMeta(s,dir){s=String(s||'WAIT').toUpperCase();if(s==='IN_ZONE')s='ZONE';if(s==='OPEN')return{key:s,label:'OPERACIÓN',cls:dir==='SHORT'?'short':'open',score:100};if(s==='ZONE')return{key:s,label:'EN OB',cls:'zone',score:82};if(s==='NEAR')return{key:s,label:'CERCA',cls:'near',score:68};if(s==='BLOCKED')return{key:s,label:'EN ESPERA',cls:'blocked',score:34};if(s==='ERROR'||s==='NO_ANALYSIS')return{key:'ERROR',label:'SIN DATOS',cls:'error',score:0};if(s==='PENDING'||s==='RETRY')return{key:s,label:'EN ANÁLISIS',cls:'wait',score:12};return{key:'WAIT',label:'EN ESPERA',cls:'wait',score:20}}
function distance(price,point){price=Number(price);point=Number(point);return Number.isFinite(price)&&Number.isFinite(point)&&point!==0?Math.abs(price-point)/Math.abs(point)*100:NaN}
function directionClass(d){return d==='SHORT'?'cc-dir-short':d==='LONG'?'cc-dir-long':''}
function point(p){return Number(p&&p.point!=null?p.point:p)}
function macroTrend(m){if(!m)return'RANGO';if(m.trend)return m.trend;var vals=[at(m,['h1','trend'],''),at(m,['h4','trend'],''),at(m,['d1','trend'],'')],b=vals.filter(function(x){return x==='ALCISTA'}).length,s=vals.filter(function(x){return x==='BAJISTA'}).length;return b>=2?'ALCISTA':s>=2?'BAJISTA':'RANGO'}
function nearestFor(q){return at(q,['proximity','nearest'],null)}
function relevantLevels(q,dir){return dir==='SHORT'?at(q,['ladder','above'],[]):at(q,['ladder','below'],[])}
function targetLevels(q,dir){return dir==='SHORT'?at(q,['ladder','below'],[]):at(q,['ladder','above'],[])}
function openFor(market,sym){var src=market==='CRYPTO'?at(CC,['crypto','opens'],[]):market==='CEDEAR'?at(CC,['cedear','opens'],[]):at(CC,['merval','opens'],[]);return (src||[]).find(function(x){return String(x.symbol).toUpperCase()===String(sym).toUpperCase()})||null}
function liveMap(runtime){var m=new Map();(runtime&&runtime.liveStates||[]).forEach(function(x){if(x&&x.symbol)m.set(String(x.symbol).toUpperCase(),x)});return m}

function cryptoRows(){
 var r=CC.crypto||{},live=liveMap(r),out=[];
 (r.structureStates||[]).forEach(function(s){
  var sym=String(s.symbol||'').toUpperCase();if(!sym)return;var l=live.get(sym)||{},q=Object.assign({},s,l);
  q.ladder=s.ladder||at(l,['diagnostic','ladder'],{})||{};q.context=s.context||at(s,['macroContext','h1'],{})||{};q.macroContext=s.macroContext||{};q.stops=s.stops||{};
  q.proximity=l.proximity||s.proximity||null;q.price=Number.isFinite(Number(l.price))?Number(l.price):Number(s.price);
  var op=openFor('CRYPTO',sym),near=nearestFor(q),dir=String(op&&op.direction||near&&near.direction||''),st=op?'OPEN':String(l.state||at(q,['proximity','state'],'WAIT')).toUpperCase();
  if(st==='IN_ZONE')st='ZONE';if(st==='NO_ANALYSIS')st='ERROR';
  var meta=stateMeta(st,dir),lev=op?Number(op.entry):point(near),dist=distance(q.price,lev),targets=targetLevels(q,dir),tp1=op?Number(op.tp1):point(targets[0]);
  out.push({market:'CRYPTO',sym:sym,name:s.name||'',pair:s.pair||sym+'USDT',dir:dir||'—',state:meta.key,meta:meta,price:q.price,dist:dist,tf:'1H',trend:macroTrend(q.macroContext)||at(q,['context','trend'],'RANGO'),level:lev,tp1:tp1,q:q,open:op,score:meta.score+(Number.isFinite(dist)?Math.max(0,14-Math.min(14,dist)):0)});
 });
 return out;
}
function regulatedRows(runtime,market){
 var r=runtime||{},out=[];(r.liveStates||[]).forEach(function(q){
  var sym=String(q.symbol||'').toUpperCase();if(!sym)return;var op=openFor(market,sym),near=nearestFor(q),st=op?'OPEN':String(q.state||q.serverState||at(q,['proximity','state'],'WAIT')).toUpperCase();
  if(st==='IN_ZONE')st='ZONE';var meta=stateMeta(st,'LONG'),lev=op?Number(op.entry):point(near),dist=distance(q.price,lev),tp1=op?Number(op.tp1):point(at(q,['ladder','above',0],null));
  out.push({market:market,sym:sym,name:q.name||'',dir:'LONG',state:meta.key,meta:meta,price:Number(q.price),dist:dist,tf:'1D',trend:at(q,['macroContext','w1','trend'],at(q,['macroContext','trend'],at(q,['context','trend'],'RANGO'))),level:lev,tp1:tp1,q:q,open:op,score:meta.score+(Number.isFinite(dist)?Math.max(0,14-Math.min(14,dist)):0)});
 });
 return out;
}
function allRows(){return cryptoRows().concat(regulatedRows(CC.cedear,'CEDEAR'),regulatedRows(CC.merval,'MERVAL')).sort(function(a,b){return b.score-a.score-(0)+(Number.isFinite(a.dist)?a.dist:999)-(Number.isFinite(b.dist)?b.dist:999)})}

function bindRows(root){if(!root)return;root.querySelectorAll('tr[data-ccsym]').forEach(function(r){r.onclick=function(){selectAsset(r.getAttribute('data-ccmarket'),r.getAttribute('data-ccsym'))}})}

function trendArrow(t){t=String(t||'RANGO').toUpperCase();return t==='ALCISTA'?'<span class="cc-up">↑</span>':t==='BAJISTA'?'<span class="cc-down">↓</span>':'<span class="cc-flat">→</span>'}
function oppTrend(q,market){if(market==='CRYPTO')return trendArrow(at(q,['macroContext','h1','trend'],at(q,['context','trend'],'RANGO')))+trendArrow(at(q,['macroContext','h4','trend'],'RANGO'));return trendArrow(at(q,['context','trend'],'RANGO'))+trendArrow(at(q,['macroContext','w1','trend'],at(q,['macroContext','trend'],'RANGO')))}
function renderOpportunities(){
 var all=allRows(),zoneN=all.filter(function(x){return x.state==='ZONE'||x.state==='OPEN'}).length,nearN=all.filter(function(x){return x.state==='NEAR'}).length,waitN=all.filter(function(x){return ['WAIT','BLOCKED','PENDING','RETRY'].indexOf(x.state)>=0}).length;
 if($('ccCountAll'))$('ccCountAll').textContent='('+all.length+')';if($('ccCountZone'))$('ccCountZone').textContent='('+zoneN+')';if($('ccCountNear'))$('ccCountNear').textContent='('+nearN+')';if($('ccCountWait'))$('ccCountWait').textContent='('+waitN+')';
 var rows=all;if(CC.filter==='ZONE')rows=rows.filter(function(x){return x.state==='ZONE'||x.state==='OPEN'});else if(CC.filter==='NEAR')rows=rows.filter(function(x){return x.state==='NEAR'});else if(CC.filter==='WAIT')rows=rows.filter(function(x){return ['WAIT','BLOCKED','PENDING','RETRY'].indexOf(x.state)>=0});
 rows=rows.slice(0,5);var b=$('ccOppBody');if(!b)return;
 b.innerHTML=rows.length?rows.map(function(o,i){var q=o.q||{},near=nearestFor(q),atr=Number(near&&near.distanceAtr),move=Number.isFinite(Number(o.price))&&Number.isFinite(Number(o.level))?movePct(o.level,o.price,o.dir):NaN,rowCls='cc-row-'+String(o.state||'wait').toLowerCase()+(o.dir==='SHORT'?' cc-row-short':'');return '<tr class="'+rowCls+'" data-ccmarket="'+esc(o.market)+'" data-ccsym="'+esc(o.sym)+'"><td class="cc-rank"><span class="rank-ball">'+(i+1)+'</span></td><td><strong>'+esc(o.sym)+'</strong></td><td class="'+directionClass(o.dir)+'"><b>'+esc(o.dir)+'</b></td><td><span class="cc-status '+o.meta.cls+'">'+o.meta.label+'</span></td><td>'+(Number.isFinite(atr)?atr.toFixed(2)+' ATR':'—')+'</td><td>'+o.tf+'</td><td>'+oppTrend(q,o.market)+'</td><td>'+num(o.price,6)+'</td><td class="'+(move>=0?'cc-up':'cc-down')+'">'+pct(move)+'</td></tr>'}).join(''):'<tr><td colspan="9">SIN DATOS para este filtro.</td></tr>';bindRows(b)
}
function signalClosed(x){var s=String(x.status||''),v=String(x.strategy_version||'');if(x.closed_at)return true;if(s==='SL'||s==='AMBIGUOUS')return true;if(s==='TP3')return true;if(s==='TP1'&&v!=='OB-LADDER-v3.5')return true;return false}
function signalWin(x){var s=String(x.status||''),v=String(x.strategy_version||'');return v==='OB-LADDER-v3.5'?s==='TP3':s==='TP1'}
function resultR(x){
 var e=Number(x.entry),sl=Number(x.stop),risk=Math.abs(e-sl),s=String(x.status||''),level=NaN,dir=String(x.direction||'LONG');if(!(Number.isFinite(e)&&Number.isFinite(sl)&&risk>0))return NaN;
 if(s==='TP1')level=Number(x.tp1);else if(s==='TP2')level=Number(x.tp2);else if(s==='TP3')level=Number(x.tp3);else if(s==='SL')level=sl;else return NaN;
 return dir==='SHORT'?(e-level)/risk:(level-e)/risk
}
function arDay(v){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}catch(e){return''}}

function renderMarkets(){
 var rows=allRows().filter(function(x){return CC.market==='CRYPTO'?x.market==='CRYPTO':x.market!=='CRYPTO'}),total=rows.length,zone=rows.filter(function(x){return x.state==='ZONE'||x.state==='OPEN'}).length,near=rows.filter(function(x){return x.state==='NEAR'}).length,analysis=rows.filter(function(x){return x.state!=='ERROR'}).length,wait=Math.max(0,total-zone-near);
 if($('ccMkTotal'))$('ccMkTotal').textContent=total;if($('ccMkAnalysis'))$('ccMkAnalysis').textContent=analysis;if($('ccMkZone'))$('ccMkZone').textContent=zone;if($('ccMkNear'))$('ccMkNear').textContent=near;if($('ccMkWait'))$('ccMkWait').textContent=wait;
 var seg=$('ccSegBar'),parts=seg?seg.querySelectorAll('i'):[],den=Math.max(1,total),z=zone/den*100,n=near/den*100,risk=total?6:0;if(parts[0])parts[0].style.width=z+'%';if(parts[1])parts[1].style.width=n+'%';if(parts[2])parts[2].style.width=risk+'%';if(parts[3])parts[3].style.width=Math.max(0,100-z-n-risk)+'%';
 var sig=at(CC,['stats','signals'],[]).filter(function(x){return CC.market==='CRYPTO'?x.market==='crypto':x.market==='cedear'||x.market==='merval'}),today=arDay(Date.now()),tod=sig.filter(function(x){return arDay(x.signal_time)===today}),closed=sig.filter(signalClosed),wins=closed.filter(signalWin),stops=closed.filter(function(x){return x.status==='SL'}),rs=closed.map(resultR).filter(Number.isFinite),trs=tod.filter(signalClosed).map(resultR).filter(Number.isFinite),open=tod.filter(function(x){return !signalClosed(x)}).length;
 if($('ccTodayR'))$('ccTodayR').textContent=trs.length?rr(trs.reduce(function(a,b){return a+b},0)):'—';if($('ccTodayOps'))$('ccTodayOps').textContent=tod.length;if($('ccTodayResult'))$('ccTodayResult').textContent=tod.filter(signalWin).length+' / '+tod.filter(function(x){return x.status==='SL'}).length;if($('ccTodayOpen'))$('ccTodayOpen').textContent=open;
 if($('ccAllOps'))$('ccAllOps').textContent=sig.length;if($('ccHit'))$('ccHit').textContent=(wins.length+stops.length)?(wins.length/(wins.length+stops.length)*100).toFixed(1)+'%':'—';if($('ccAvgR'))$('ccAvgR').textContent=rs.length?rr(mean(rs)):'—';if($('ccCumR'))$('ccCumR').textContent=rs.length?rr(rs.reduce(function(a,b){return a+b},0)):'—';if($('ccMfe'))$('ccMfe').textContent=Number.isFinite(mean(sig.map(function(x){return x.best_r})))?rr(mean(sig.map(function(x){return x.best_r}))):'—';if($('ccMae'))$('ccMae').textContent=Number.isFinite(mean(sig.map(function(x){return x.worst_r})))?rr(mean(sig.map(function(x){return x.worst_r}))):'—'
}
function currentR(op,price){var e=Number(op.entry),sl=Number(op.stop),p=Number(price),risk=Math.abs(e-sl),d=String(op.direction||'LONG');return Number.isFinite(e)&&Number.isFinite(sl)&&Number.isFinite(p)&&risk>0?(d==='SHORT'?(e-p)/risk:(p-e)/risk):NaN}

function renderOperations(){
 var rows=allRows(),map=new Map();rows.forEach(function(x){map.set(x.market+':'+x.sym,x)});var ops=[].concat(at(CC,['crypto','opens'],[]),at(CC,['cedear','opens'],[]),at(CC,['merval','opens'],[])),b=$('ccOpsBody');if($('ccOpsTitle'))$('ccOpsTitle').textContent='OPERACIONES ACTIVAS ('+ops.length+')';if(!b)return;
 b.innerHTML=ops.length?ops.map(function(o){var m=o.market==='crypto'?'CRYPTO':o.market==='merval'?'MERVAL':'CEDEAR',row=map.get(m+':'+String(o.symbol).toUpperCase())||{},p=Number(row.price),move=Number.isFinite(p)&&Number(o.entry)?(o.direction==='SHORT'?(Number(o.entry)-p)/Number(o.entry):(p-Number(o.entry))/Number(o.entry))*100:NaN,r=currentR(o,p);return '<tr data-ccmarket="'+m+'" data-ccsym="'+esc(o.symbol)+'"><td><strong>'+esc(o.symbol)+'</strong></td><td class="'+directionClass(o.direction)+'"><b>'+esc(o.direction)+'</b></td><td>'+num(o.entry,6)+'</td><td>'+num(p,6)+'</td><td class="'+(move>=0?'cc-up':'cc-down')+'"><b>'+pct(move)+'</b></td><td class="'+(r>=0?'cc-up':'cc-down')+'"><b>'+rr(r)+'</b></td><td>'+num(o.tp1,6)+'</td><td>'+num(o.tp2,6)+'</td><td>'+num(o.tp3,6)+'</td><td>'+num(o.stop,6)+'</td><td><span class="cc-status open">ABIERTA</span></td><td><button class="op-menu" type="button">•••</button></td></tr>'}).join(''):'<tr><td colspan="12">No hay operaciones abiertas en la base en este momento.</td></tr>';bindRows(b);
 var tl=$('ccOpTimeline');if(!tl)return;if(!ops.length){tl.innerHTML='';return}var o=ops[0],m=o.market==='crypto'?'CRYPTO':o.market==='merval'?'MERVAL':'CEDEAR',row=map.get(m+':'+String(o.symbol).toUpperCase())||{},p=Number(row.price),e=Number(o.entry),tp1=Number(o.tp1),tp2=Number(o.tp2),tp3=Number(o.tp3),dir=String(o.direction||'LONG'),den=dir==='SHORT'?e-tp3:tp3-e;
 function pos(v){if(!Number.isFinite(v)||!Number.isFinite(den)||den===0)return 0;var x=dir==='SHORT'?(e-v)/den:(v-e)/den;return Math.max(0,Math.min(1,x))*100}
 var cur=pos(p),p1=pos(tp1),p2=pos(tp2),p3=pos(tp3);tl.innerHTML='<div class="timeline-track"><i class="timeline-fill" style="width:'+cur+'%"></i><span class="timeline-point" style="left:0%"></span><span class="timeline-label" style="left:0%;transform:none">Entrada <b>'+num(e,6)+'</b></span><span class="timeline-point current" style="left:'+cur+'%"></span><span class="timeline-label" style="left:'+cur+'%">Precio actual<b>'+num(p,6)+'</b></span><span class="timeline-point tp" style="left:'+p1+'%"></span><span class="timeline-label" style="left:'+p1+'%">TP1<b>'+num(tp1,6)+'</b></span><span class="timeline-point tp" style="left:'+p2+'%"></span><span class="timeline-label" style="left:'+p2+'%">TP2<b>'+num(tp2,6)+'</b></span><span class="timeline-point tp" style="left:'+p3+'%"></span><span class="timeline-label" style="left:'+p3+'%;transform:translateX(-100%)">TP3<b>'+num(tp3,6)+'</b></span></div>'
}

function renderRadar(){
 var base=allRows().filter(function(x){return CC.radar==='CRYPTO'?x.market==='CRYPTO':x.market!=='CRYPTO'}),zoneN=base.filter(function(x){return x.state==='ZONE'||x.state==='OPEN'}).length,nearN=base.filter(function(x){return x.state==='NEAR'}).length,waitN=base.filter(function(x){return ['WAIT','BLOCKED','PENDING','RETRY'].indexOf(x.state)>=0}).length;if($('ccRadarAll'))$('ccRadarAll').textContent='('+base.length+')';if($('ccRadarZone'))$('ccRadarZone').textContent='('+zoneN+')';if($('ccRadarNear'))$('ccRadarNear').textContent='('+nearN+')';if($('ccRadarWait'))$('ccRadarWait').textContent='('+waitN+')';
 var rows=base;if(CC.radarFilter==='ZONE')rows=rows.filter(function(x){return x.state==='ZONE'||x.state==='OPEN'});else if(CC.radarFilter==='NEAR')rows=rows.filter(function(x){return x.state==='NEAR'});else if(CC.radarFilter==='WAIT')rows=rows.filter(function(x){return ['WAIT','BLOCKED','PENDING','RETRY'].indexOf(x.state)>=0});rows=rows.slice(0,8);var b=$('ccRadarBody');if(!b)return;if($('ccTrendHead1'))$('ccTrendHead1').textContent=CC.radar==='CRYPTO'?'1H':'1D';if($('ccTrendHead2'))$('ccTrendHead2').textContent=CC.radar==='CRYPTO'?'4H':'1W';if($('ccTrendHead3'))$('ccTrendHead3').textContent=CC.radar==='CRYPTO'?'1D':'MACRO';
 b.innerHTML=rows.length?rows.map(function(o){var q=o.q||{},dir=o.dir==='SHORT'?'SHORT':'LONG',lv=relevantLevels(q,dir),t1=CC.radar==='CRYPTO'?at(q,['macroContext','h1','trend'],at(q,['context','trend'],'RANGO')):at(q,['context','trend'],'RANGO'),t2=CC.radar==='CRYPTO'?at(q,['macroContext','h4','trend'],'RANGO'):at(q,['macroContext','w1','trend'],at(q,['macroContext','trend'],'RANGO')),t3=CC.radar==='CRYPTO'?at(q,['macroContext','d1','trend'],'RANGO'):at(q,['macroContext','trend'],t2),action=(o.state==='ZONE'||o.state==='OPEN')?dir:o.state==='NEAR'?'MIRAR':'—',rowCls='cc-row-'+String(o.state||'wait').toLowerCase()+(dir==='SHORT'?' cc-row-short':'');return '<tr class="'+rowCls+'" data-ccmarket="'+o.market+'" data-ccsym="'+esc(o.sym)+'"><td><strong>'+esc(o.sym)+'</strong></td><td>'+num(o.price,6)+'</td><td>'+trendArrow(t1)+'</td><td>'+trendArrow(t2)+'</td><td>'+trendArrow(t3)+'</td><td>'+num(point(lv[0]),6)+'</td><td>'+num(point(lv[1]),6)+'</td><td>'+num(point(lv[2]),6)+'</td><td><span class="cc-status '+o.meta.cls+'">'+o.meta.label+'</span></td><td class="'+directionClass(dir)+'">'+action+' <span class="bell" aria-hidden="true"></span></td></tr>'}).join(''):'<tr><td colspan="10">SIN DATOS</td></tr>';bindRows(b)
}
function drawMacroSpark(values){
 var canvas=$('ccMacroSpark');if(!canvas)return;var vals=(values||[]).map(Number).filter(Number.isFinite),r=canvas.getBoundingClientRect(),w=Math.max(180,Math.floor(r.width)),h=Math.max(48,Math.floor(r.height)),dpr=Math.max(1.5,Math.min(2.5,window.devicePixelRatio||1));
 canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);var g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
 if(vals.length<2){g.fillStyle='#6e8799';g.font='8px Inter';g.fillText('SIN HISTÓRICO',8,18);return}
 var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals),rg=hi-lo||1,pad=5;
 g.strokeStyle='rgba(24,67,91,.55)';g.lineWidth=.7;for(var i=1;i<3;i++){var y=i*h/3;g.beginPath();g.moveTo(0,y+.5);g.lineTo(w,y+.5);g.stroke()}
 var grad=g.createLinearGradient(0,0,w,0);grad.addColorStop(0,'#15d993');grad.addColorStop(.55,'#28eaa1');grad.addColorStop(1,'#11b978');g.strokeStyle=grad;g.lineWidth=1.35;g.lineJoin='round';g.lineCap='round';g.shadowColor='rgba(31,232,159,.28)';g.shadowBlur=3;g.beginPath();
 vals.forEach(function(v,i){var x=pad+i*(w-pad*2)/(vals.length-1),y=pad+(hi-v)/rg*(h-pad*2);if(i===0)g.moveTo(x,y);else g.lineTo(x,y)});g.stroke();g.shadowBlur=0
}
function setContext(){
 var d=CC.context;if(!d)return;if($('ccGlobalTs'))$('ccGlobalTs').textContent='DATOS REALES · '+new Date(d.generatedAt).toLocaleTimeString('es-AR');
 var s={};(d.sessions||[]).forEach(function(x){s[x.key]=x});
 [['ASIA','ccSessionAsia'],['EUROPE','ccSessionEurope'],['NEW_YORK','ccSessionNy']].forEach(function(a){var x=s[a[0]],p=Number(x&&x.performancePct),el=$(a[1]);if(el){var state=x&&x.state==='OPEN'?'Abierta':'Cerrada';el.innerHTML='<em>'+state+'</em><strong class="'+(Number.isFinite(p)?(p>=0?'cc-up':'cc-down'):'')+'">'+pct(p)+'</strong>'}});
 function mac(k,v,cid){var x=at(d,['macro',k],{}),ve=$(v),ch=$(cid);if(ve)ve.textContent=Number.isFinite(Number(x.value))?num(x.value,k==='btcDominance'?1:3)+(x.unit||''):'—';if(ch){ch.textContent=pct(x.changePct);ch.className=Number.isFinite(Number(x.changePct))?(Number(x.changePct)>=0?'cc-up':'cc-down'):''}}
 mac('btcDominance','ccBtcD','ccBtcDCh');mac('dxy','ccDxy','ccDxyCh');mac('us10y','ccUs10y','ccUs10yCh');mac('vix','ccVix','ccVixCh');
 drawMacroSpark(at(d,['macro','dxy','sparkline'],[]));
 var rb=$('ccRisk'),r=d.risk||{},rc=String(r.state||'NEUTRAL').toLowerCase();if(rb){rb.className='risk-banner '+(rc==='favorable'?'favorable':rc==='adverse'?'adverse':'neutral');var copy=rc==='favorable'?'ENTORNO FAVORABLE<br>PARA RIESGO':rc==='adverse'?'ENTORNO ADVERSO<br>PARA RIESGO':'ENTORNO NEUTRAL<br>PARA RIESGO';rb.innerHTML='<span>'+copy+'</span>'}
}

function age(v){var t=v?new Date(v).getTime():NaN;return Number.isFinite(t)?Date.now()-t:Infinity}
function levelFromAge(v,warn,err){var a=age(v);return a>err?'error':a>warn?'warning':'ok'}
function healthCompact(){
 var d=CC.status||{},st=d.states||{},guard=at(st,['market_guard','meta','combined'],{}),regulatedExpected=guard.actionable===true,cryptoLive=at(st,['crypto_live','last_run_at'],null),cryptoStruct=at(st,['crypto_structure','last_run_at'],null),reg=at(st,['regulated_live','last_run_at'],null),db=at(d,['database','last_write'],null),watch=at(d,['alerts','last_watcher_at'],null);
 var crypto=levelFromAge(cryptoLive,180000,360000);if(age(cryptoStruct)>20*60000)crypto='error';else if(age(cryptoStruct)>10*60000&&crypto==='ok')crypto='warning';
 var cedear=regulatedExpected?levelFromAge(reg,8*60000,20*60000):(reg?'ok':'stale'),data=guard.code==='STALE'||guard.code==='ERROR'?'stale':'ok',database=levelFromAge(db,10*60000,30*60000),telegram=!at(d,['alerts','telegram_linked'],false)?'error':levelFromAge(watch,4*60000,12*60000);
 var jobs=d.jobs||[],scheduler=jobs.some(function(j){return j.active===false||String(j.last_status).toLowerCase()==='failed'})?'error':jobs.some(function(j){return Number(j.failures_24h)>0})?'warning':'ok';
 return{scanner:scheduler,data:data,db:database,telegram:telegram,watcher:telegram,crypto:crypto,cedear:cedear}
}

function renderHealth(){
 var h=healthCompact(),names=[['Scanner',h.scanner],['Datos',h.data],['Supabase/DB',h.db],['Telegram',h.telegram],['Watcher',h.watcher],['Crypto Engine',h.crypto],['CEDEAR Engine',h.cedear]],el=$('ccHealthRow');if(el)el.innerHTML=names.map(function(x){return '<div class="cc-health-chip '+x[1]+'"><span>'+x[0]+'</span><b>'+x[1].toUpperCase()+'</b></div>'}).join('');if($('ccHealthTs'))$('ccHealthTs').textContent='snapshot '+(at(CC,['status','generated_at'],null)?new Date(CC.status.generated_at).toLocaleTimeString('es-AR'):'—');
 [['hdrData',h.data,'Datos','✓'],['hdrMotor',h.crypto==='error'?'error':h.cedear==='error'?'error':h.crypto==='warning'||h.cedear==='warning'?'warning':'ok','Motor','✣'],['hdrTelegram',h.telegram,'Telegram','➤'],['hdrDb',h.db,'Base','▰']].forEach(function(x){var e=$(x[0]);if(e){e.className=x[1];e.innerHTML='<i>'+x[3]+'</i>'+x[2]+' '+x[1].toUpperCase()}})
}
function movePct(entry,level,dir){entry=Number(entry);level=Number(level);return Number.isFinite(entry)&&entry!==0&&Number.isFinite(level)?(dir==='SHORT'?(entry-level)/entry:(level-entry)/entry)*100:NaN}
function levelSection(title,arr,entry,dir,touched){
 var a=(arr||[]).slice(0,3);var body=a.length?a.map(function(p,i){var rank=Number(p&&p.rank||i+1),v=point(p),tag=title.indexOf('ORDER')===0?'OB'+rank:'TP'+(i+1),right=touched===rank?'✓ Tocado':Number.isFinite(Number(entry))?pct(movePct(entry,v,dir)):'';return '<div class="cc-level-row"><span>'+tag+'</span><b>'+num(v,6)+'</b><em>'+right+'</em></div>'}).join(''):'<div class="cc-level-row"><span>—</span><b>SIN DATOS</b><em></em></div>';return '<div class="cc-detail-section"><h4>'+title+'</h4>'+body+'</div>'
}

function renderSelected(row){
 if(!row)return;var q=row.q||{},op=row.open||openFor(row.market,row.sym),near=nearestFor(q),dir=String(op&&op.direction||row.dir||near&&near.direction||'LONG'),entries=relevantLevels(q,dir),targets=op?[op.tp1,op.tp2,op.tp3].filter(function(v){return Number.isFinite(Number(v))}).map(function(v,i){return{rank:i+1,point:Number(v)}}):targetLevels(q,dir),entry=op?Number(op.entry):point(near),stop=op&&Number.isFinite(Number(op.stop))?Number(op.stop):Number(at(q,['stops',dir],NaN)),ctx=q.context||{},isC=row.market==='CRYPTO',t1=isC?at(q,['macroContext','h1','trend'],at(q,['context','trend'],'RANGO')):at(q,['context','trend'],'RANGO'),t2=isC?at(q,['macroContext','h4','trend'],'RANGO'):at(q,['macroContext','w1','trend'],at(q,['macroContext','trend'],'RANGO')),t3=isC?at(q,['macroContext','d1','trend'],'RANGO'):at(q,['macroContext','trend'],t2),touched=Number(at(op||{},['context','entry_rank'],0)),move=Number.isFinite(Number(row.price))&&Number.isFinite(Number(entry))?movePct(entry,row.price,dir):NaN;
 if($('ccAssetName'))$('ccAssetName').textContent=row.sym+(isC?' / USDT':' / USD');if($('ccAssetPrice'))$('ccAssetPrice').textContent=num(row.price,7);if($('ccAssetMove')){$('ccAssetMove').textContent=pct(move);$('ccAssetMove').className=move>=0?'cc-up':'cc-down'}if($('ccChartTf'))$('ccChartTf').textContent=isC?'1H⌄':'1D⌄';[['ccT1Label',isC?'1H':'1D'],['ccT2Label',isC?'4H':'1W'],['ccT3Label',isC?'1D':'MACRO']].forEach(function(x){if($(x[0]))$(x[0]).textContent=x[1]});if($('ccT1'))$('ccT1').innerHTML=trendHtml(t1);if($('ccT2'))$('ccT2').innerHTML=trendHtml(t2);if($('ccT3'))$('ccT3').innerHTML=trendHtml(t3);
 function rows3(arr,title,touch){return '<div class="detail-section '+(title.indexOf('ORDER')===0?'obs':'targets')+'"><h4>'+title+'</h4>'+((arr||[]).slice(0,3).map(function(p,i){var rank=Number(p&&p.rank||i+1),v=point(p),lab=title.indexOf('ORDER')===0?'OB'+rank:'TP'+(i+1),right=touch===rank?'✓ Tocado':Number.isFinite(entry)?pct(movePct(entry,v,dir)):'';return '<div class="detail-gridline"><span>'+lab+'</span><b>'+num(v,6)+'</b><em>'+right+'</em></div>'}).join('')||'<div class="detail-gridline"><span>—</span><b>SIN DATOS</b><em></em></div>')+'</div>'}
 function labelTrend(t){return String(t||'RANGO').replace('ALCISTA','Alcista').replace('BAJISTA','Bajista').replace('RANGO','Rango')}
 var d=$('ccDetailBody');if(d)d.innerHTML='<div class="detail-top"><h3>'+esc(row.sym)+(isC?' / USDT':' / USD')+'</h3><div class="detail-price">Precio actual <b>'+num(row.price,7)+'</b><strong class="'+(move>=0?'cc-up':'cc-down')+'">'+pct(move)+'</strong></div><div class="detail-side"><div class="detail-direction">'+esc(dir)+'</div></div></div><div class="detail-tabs"><button class="on">Resumen</button><button>Niveles OB</button><button>Indicadores</button></div><div class="detail-columns"><div class="detail-main"><div class="detail-section trend"><h4>TENDENCIA</h4><div class="detail-gridline"><span>'+(isC?'1H':'1D')+'</span><b>'+trendArrow(t1)+' '+esc(labelTrend(t1))+'</b><em></em></div><div class="detail-gridline"><span>'+(isC?'4H':'1W')+'</span><b>'+trendArrow(t2)+' '+esc(labelTrend(t2))+'</b><em></em></div><div class="detail-gridline"><span>'+(isC?'1D':'Macro')+'</span><b>'+trendArrow(t3)+' '+esc(labelTrend(t3))+'</b><em></em></div></div>'+rows3(entries,'ORDER BLOCKS (Entrada)',touched)+rows3(targets,'OBJETIVOS',0)+'<div class="detail-section stop"><h4>STOP LOSS</h4><div class="detail-gridline"><span>SL</span><b>'+num(stop,6)+'</b><em>'+(Number.isFinite(stop)&&Number.isFinite(entry)?pct(movePct(entry,stop,dir)):'—')+'</em></div></div></div><div class="detail-indicators"><div class="indicators-title">INDICADORES<small>(Informativos)</small></div><div class="gauge-card"><span>RSI</span><b>'+num(ctx.rsi14,1)+'</b><small>Neutral</small><i class="gauge-ring"></i></div><div class="gauge-card positive"><span>MACD</span><b>'+(Number(ctx.macd)>=Number(ctx.signal)?'Positivo':'Negativo')+'</b><i class="gauge-ring"></i></div><div class="gauge-card volume"><span>Volumen</span><b>'+(Number.isFinite(Number(ctx.volumeRatio))?Number(ctx.volumeRatio).toFixed(2)+'x':'—')+'</b><small>Normal</small><i class="gauge-ring"></i></div></div></div><div class="detail-note">Los indicadores son informativos<br>y no bloquean la entrada.</div>';
 return{row:row,q:q,op:op,dir:dir,entries:entries,targets:targets,stop:stop}
}
function ema(vals,p){var out=[],e=null,k=2/(p+1);for(var i=0;i<vals.length;i++){var x=Number(vals[i]);e=e==null?x:x*k+e*(1-k);out.push(e)}return out}
function drawChart(canvas,bars,pack){
 if(!canvas||!bars||!bars.length)return;
 bars=bars.slice(-36);
 var dpr=Math.max(1.5,Math.min(2.5,window.devicePixelRatio||1)),r=canvas.getBoundingClientRect(),w=Math.max(320,Math.floor(r.width)),h=Math.max(210,Math.floor(r.height));
 canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);var c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
 var bg=c.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#03101a');bg.addColorStop(.55,'#020a12');bg.addColorStop(1,'#01070c');c.fillStyle=bg;c.fillRect(0,0,w,h);

 var entry=pack.op&&Number.isFinite(Number(pack.op.entry))?Number(pack.op.entry):point((pack.entries||[])[0]),
     tp1=pack.op&&Number.isFinite(Number(pack.op.tp1))?Number(pack.op.tp1):point((pack.targets||[])[0]),
     stop=Number(pack.stop),
     rangeLevels=[entry,tp1,stop].filter(Number.isFinite),
     barLo=Math.min.apply(null,bars.map(function(b){return b.l})),barHi=Math.max.apply(null,bars.map(function(b){return b.h})),
     lo=Math.min.apply(null,[barLo].concat(rangeLevels)),hi=Math.max.apply(null,[barHi].concat(rangeLevels)),rg=hi-lo||1;
 lo-=rg*.05;hi+=rg*.05;rg=hi-lo;

 var pad={l:8,r:68,t:9,b:21},priceH=(h-pad.t-pad.b)*.78,volTop=pad.t+priceH+7,volH=h-volTop-pad.b,
     plotW=w-pad.l-pad.r,X=function(i){return pad.l+(i+.5)*plotW/bars.length},Y=function(v){return pad.t+(hi-v)/rg*priceH};

 c.save();c.lineWidth=.7;c.strokeStyle='rgba(27,69,94,.52)';
 for(var gy=0;gy<=5;gy++){var yy=Math.round((pad.t+gy*priceH/5)*2)/2;c.beginPath();c.moveTo(pad.l,yy);c.lineTo(w-pad.r,yy);c.stroke()}
 for(var gx=0;gx<=5;gx++){var xx=Math.round((pad.l+gx*plotW/5)*2)/2;c.beginPath();c.moveTo(xx,pad.t);c.lineTo(xx,volTop+volH);c.stroke()}c.restore();

 c.font='500 8px Inter,system-ui,sans-serif';c.fillStyle='#73899a';c.textBaseline='middle';
 for(var g=0;g<=5;g++){var yy2=pad.t+g*priceH/5,val=hi-g*rg/5;c.fillText(num(val,1),w-pad.r+7,yy2)}

 var bw=Math.max(3,Math.min(7.2,plotW/bars.length*.66)),maxv=Math.max.apply(null,bars.map(function(b){return b.v||0}).concat([1]));
 bars.forEach(function(b,i){
   var x=X(i),up=b.c>=b.o,wick=up?'rgba(35,239,161,.94)':'rgba(255,87,101,.94)';
   c.strokeStyle=wick;c.lineWidth=1;c.beginPath();c.moveTo(Math.round(x)+.5,Y(b.h));c.lineTo(Math.round(x)+.5,Y(b.l));c.stroke();
   var y1=Y(Math.max(b.o,b.c)),y2=Y(Math.min(b.o,b.c)),bh=Math.max(2,Math.abs(y2-y1)),grad=c.createLinearGradient(0,y1,0,y1+bh);
   if(up){grad.addColorStop(0,'#32f4ad');grad.addColorStop(1,'#0bc57d')}else{grad.addColorStop(0,'#ff6975');grad.addColorStop(1,'#d83f4d')}
   c.fillStyle=grad;c.fillRect(Math.round(x-bw/2)+.5,Math.round(y1)+.5,Math.max(1,bw),bh);
   c.strokeStyle=up?'rgba(116,255,205,.34)':'rgba(255,158,166,.30)';c.strokeRect(Math.round(x-bw/2)+.5,Math.round(y1)+.5,Math.max(1,bw),bh);
   var vh=(b.v||0)/maxv*volH,vg=c.createLinearGradient(0,volTop+volH-vh,0,volTop+volH);vg.addColorStop(0,up?'rgba(24,221,148,.56)':'rgba(238,77,93,.54)');vg.addColorStop(1,up?'rgba(24,221,148,.15)':'rgba(238,77,93,.14)');c.fillStyle=vg;c.fillRect(Math.round(x-bw/2)+.5,volTop+volH-vh,Math.max(1,bw),vh)
 });

 function dashed(v,col,dash,width){
   if(!Number.isFinite(v))return;var y=Y(v);c.save();c.strokeStyle=col;c.lineWidth=width||1.15;c.setLineDash(dash||[5,4]);c.beginPath();c.moveTo(pad.l,y+.5);c.lineTo(w-pad.r,y+.5);c.stroke();c.restore()
 }
 function badge(v,label,value,col,stacked){
   if(!Number.isFinite(v))return;var y=Y(v),x=w-pad.r+2;c.save();c.shadowColor=col;c.shadowBlur=3;c.fillStyle=col;c.textBaseline='middle';
   if(stacked){var ww=60,hh=24;c.fillRect(x,y-hh/2,ww,hh);c.shadowBlur=0;c.fillStyle='#03120d';c.font='700 7.5px Inter';c.fillText(label,x+4,y-5);c.font='800 8px Inter';c.fillText(value,x+4,y+5)}
   else{c.font='800 8px Inter';var ww2=Math.min(pad.r-4,c.measureText(label+' '+value).width+8),hh2=15;c.fillRect(x,y-hh2/2,ww2,hh2);c.shadowBlur=0;c.fillStyle='#041018';c.fillText((label?label+' ':'')+value,x+4,y+.5)}c.restore()
 }

 dashed(tp1,'#2bf0a2',[5,4],1.2);badge(tp1,'',num(tp1,3),'#31ec9f',false);
 dashed(entry,'#8af2dd',[5,4],1.15);badge(entry,'Entrada',num(entry,3),'#8ae9d7',true);
 dashed(stop,'#ff5a66',[5,4],1.25);badge(stop,'SL',num(stop,3),'#ff5966',false);

 c.font='500 8px Inter,system-ui,sans-serif';c.fillStyle='#6f8596';c.textBaseline='top';
 for(var t=0;t<5;t++){var idx=Math.round(t*(bars.length-1)/4),bt=bars[idx]&&bars[idx].t;if(bt){var dt=new Date(bt),lab=('0'+dt.getDate()).slice(-2);c.fillText(lab,X(idx)-5,h-pad.b+5)}}
}

function normalizeBinance(a){return(a||[]).map(function(x){return{t:Number(x[6]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5])}}).filter(function(x){return[x.o,x.h,x.l,x.c].every(Number.isFinite)})}
function normalizeHistory(a){return(a||[]).map(function(x){return{t:Number(x.t!=null?x.t:x.closeTime),o:Number(x.o!=null?x.o:x.open),h:Number(x.h!=null?x.h:x.high),l:Number(x.l!=null?x.l:x.low),c:Number(x.c!=null?x.c:x.close),v:Number(x.v!=null?x.v:x.volume||0)}}).filter(function(x){return[x.o,x.h,x.l,x.c].every(Number.isFinite)})}
function selectAsset(market,sym){
 var row=allRows().find(function(x){return x.market===market&&x.sym===sym})||allRows().find(function(x){return x.sym===sym});if(!row)return;CC.selected={market:row.market,sym:row.sym};var pack=renderSelected(row),seq=++CC.chartSeq,canvas=$('ccPrice');if(!pack||!canvas)return;
 var p;if(row.market==='CRYPTO'){p=json('https://api.binance.com/api/v3/klines?symbol='+encodeURIComponent(row.pair||row.sym+'USDT')+'&interval=1h&limit=60',18000).then(normalizeBinance)}else{var op=row.market==='MERVAL'?'merval-history':'history';p=json('/api/data?op='+op+'&symbol='+encodeURIComponent(row.sym),22000).then(function(x){return normalizeHistory(at(x,['data','1d'],[]))})}
 p.then(function(bars){if(seq!==CC.chartSeq)return;if(!bars.length)throw Error('sin velas');drawChart(canvas,bars,pack)}).catch(function(e){if(seq!==CC.chartSeq)return;var c=canvas.getContext('2d'),r=canvas.getBoundingClientRect();canvas.width=Math.max(400,r.width);canvas.height=Math.max(230,r.height);c.fillStyle='#02070d';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#7690a5';c.font='12px monospace';c.fillText('SIN DATOS DE GRÁFICO',15,28)})
}
function renderAll(){setContext();renderOpportunities();renderMarkets();renderOperations();renderRadar();renderHealth();if(CC.selected){var r=allRows().find(function(x){return x.market===CC.selected.market&&x.sym===CC.selected.sym});if(r)renderSelected(r)}else{var first=allRows()[0];if(first)selectAsset(first.market,first.sym)}}
function load(force){
 if(CC.busy&&!force)return Promise.resolve();CC.busy=true;var stamp=Date.now();
 var tasks=[
  json('/api/data?op=global-context&_='+stamp,15000).then(function(x){CC.context=x}).catch(function(){CC.context=null}),
  json('/api/data?op=runtime&market=crypto&_='+stamp,16000).then(function(x){CC.crypto=x}),
  json('/api/data?op=runtime&market=cedear&_='+stamp,16000).then(function(x){CC.cedear=x}),
  json('/api/data?op=runtime&market=merval&_='+stamp,16000).then(function(x){CC.merval=x}),
  json('/api/data?op=stats&_='+stamp,16000).then(function(x){CC.stats=x}),
  json('/api/data?op=status&_='+stamp,16000).then(function(x){CC.status=x}),
  json('/api/data?op=cedears-panel&_='+stamp,20000).then(function(x){CC.cedearPanel=x}).catch(function(){}),
  json('/api/data?op=merval-panel&_='+stamp,20000).then(function(x){CC.mervalPanel=x}).catch(function(){})
 ];
 return Promise.allSettled(tasks).then(function(){renderAll()}).finally(function(){CC.busy=false})
}
function clock(){var n=new Date();if($('hdrTime'))$('hdrTime').textContent=new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(n);if($('hdrDate'))$('hdrDate').textContent=new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric'}).format(n)}
function bind(){
 var legacy={};['tc','tz','ts','th'].forEach(function(id){legacy[id]=$(id)&&$(id).onclick});var oldReload=$('reload')&&$('reload').onclick;
 function showCommand(){['vc','vz','vs','vh'].forEach(function(id){var e=$(id);if(e)e.classList.add('hide')});if($('vm'))$('vm').classList.remove('hide');if($('tm'))$('tm').classList.add('on');if($('ts'))$('ts').classList.remove('on');if($('tc'))$('tc').classList.toggle('on',CC.market==='CRYPTO');if($('tz'))$('tz').classList.toggle('on',CC.market!=='CRYPTO');load(false)}
 if($('tm'))$('tm').onclick=showCommand;
 if($('tc'))$('tc').onclick=function(){CC.market='CRYPTO';CC.radar='CRYPTO';showCommand();document.querySelectorAll('[data-ccmarket]').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-ccmarket')==='CRYPTO')});renderMarkets();renderRadar()};
 if($('tz'))$('tz').onclick=function(){CC.market='CEDEAR';CC.radar='CEDEAR';showCommand();document.querySelectorAll('[data-ccmarket]').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-ccmarket')==='CEDEAR')});renderMarkets();renderRadar()};
 if($('ts'))$('ts').onclick=function(){if($('vm'))$('vm').classList.add('hide');if($('tm'))$('tm').classList.remove('on');if(typeof legacy.ts==='function')legacy.ts()};
 document.querySelectorAll('.cc-jump').forEach(function(b){b.onclick=function(){showCommand();var id=b.getAttribute('data-jump');setTimeout(function(){var e=$(id);if(e)e.scrollIntoView({behavior:'smooth',block:'center'})},0)}});
 document.querySelectorAll('[data-ccfilter]').forEach(function(b){b.onclick=function(){CC.filter=b.getAttribute('data-ccfilter');document.querySelectorAll('[data-ccfilter]').forEach(function(x){x.classList.toggle('on',x===b)});renderOpportunities()}});
 document.querySelectorAll('[data-ccmarket]').forEach(function(b){b.onclick=function(){CC.market=b.getAttribute('data-ccmarket');CC.radar=CC.market==='CRYPTO'?'CRYPTO':'CEDEAR';if($('tc'))$('tc').classList.toggle('on',CC.market==='CRYPTO');if($('tz'))$('tz').classList.toggle('on',CC.market!=='CRYPTO');document.querySelectorAll('[data-ccmarket]').forEach(function(x){x.classList.toggle('on',x===b)});renderMarkets();renderRadar()}});
 document.querySelectorAll('[data-ccradarfilter]').forEach(function(b){b.onclick=function(){CC.radarFilter=b.getAttribute('data-ccradarfilter');document.querySelectorAll('[data-ccradarfilter]').forEach(function(x){x.classList.toggle('on',x===b)});renderRadar()}});
 var dx=document.querySelector('.detail-x');if(dx)dx.onclick=function(){CC.selected=null;if($('ccDetailBody'))$('ccDetailBody').innerHTML='<div class="cc-info-note">Seleccioná un activo del radar u oportunidades.</div>'};
 if($('reload'))$('reload').onclick=function(){if($('vm')&&!$('vm').classList.contains('hide'))load(true);else if(typeof oldReload==='function')oldReload()};showCommand()
}
clock();setInterval(clock,1000);bind();setInterval(function(){if($('vm')&&!$('vm').classList.contains('hide'))load(false)},60000);window.addEventListener('resize',function(){if(CC.selected){var r=allRows().find(function(x){return x.market===CC.selected.market&&x.sym===CC.selected.sym});if(r)selectAsset(r.market,r.sym)}})
})();