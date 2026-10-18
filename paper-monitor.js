(function(){
'use strict';
var host=document.getElementById('vm');if(!host)return;
var panel=document.createElement('section');panel.id='paperKeltner';panel.style.cssText='margin:18px 0;padding:18px;border:1px solid #3c526c;border-radius:12px;background:#142033;color:#e8eef8;line-height:1.6;overflow-wrap:anywhere';
panel.innerHTML='<h2 style="margin:0 0 8px;font-size:18px">Keltner H4 · seguimiento simulado</h2><p>Reglas congeladas · sin órdenes ni alertas de operación · capital ficticio de USD 10.000.</p><p id="paperStatus" role="status">Consultando registro…</p><div id="paperMetrics" style="display:flex;gap:18px;flex-wrap:wrap"></div><p id="paperEvidence"></p><details><summary>Últimas observaciones y límites</summary><p>Entradas y salidas al primer precio observado, con costos estimados. Revisión horaria; señales sobre velas H4 cerradas. El stop se evalúa al observar precios, no se ejecuta automáticamente al tocarlo entre observaciones. Las demoras de GitHub pueden aumentar las pérdidas. La caída mostrada usa muestras horarias. Los precios son indicativos, no cotizaciones de compra/venta ejecutables.</p><p id="paperProtocol"></p><ul id="paperEvents"></ul></details><a href="/docs/research/expanded.html" style="color:#87baff">Ver reglas, backtests y pruebas de estrés</a>';
host.appendChild(panel);
function fmt(x){return Number.isFinite(x)?x.toLocaleString('es-AR',{maximumFractionDigits:2}):'—';}
function time(t){return new Date(t).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'});}
async function refresh(){try{
 var r=await fetch('/paper/keltner-h4.json',{cache:'no-store'});if(!r.ok)throw Error('Registro no disponible');var s=await r.json();
 if(s.mode!=='SIMULATION'||s.approvedForLive!==false||s.automaticOrders!==false||!Number.isFinite(s.updatedAt)||!Number.isFinite(s.equity))throw Error('Registro inválido');
 var stale=Date.now()-s.updatedAt>2*3600000,status=s.completedAt?'EXPERIMENTO COMPLETO':stale?'REGISTRO DEMORADO':'RECOLECTANDO EVIDENCIA';
 document.getElementById('paperStatus').textContent=status+' · última observación '+time(s.updatedAt)+' (Argentina)';
 var box=document.getElementById('paperMetrics');box.replaceChildren();
 [['Capital simulado','USD '+fmt(s.equity)],['Retorno neto estimado',fmt((s.equity/10000-1)*100)+'%'],['Comprar y mantener',fmt((s.benchmarkEquity/10000-1)*100)+'%'],['Caída máxima observada',fmt(s.maxObservedDrawdown*100)+'%'],['Operaciones cerradas',String(s.closedTrades)],['Posiciones simuladas',String(Object.values(s.sleeves||{}).filter(function(p){return p.position}).length)]].forEach(function(m){var p=document.createElement('p');p.style.margin='4px 0';p.textContent=m[0]+': '+m[1];box.appendChild(p)});
 document.getElementById('paperEvidence').textContent='SIN VALIDAR · '+fmt((s.updatedAt-s.startedAt)/86400000)+' días observados de una ventana de 90 días. Empezó '+time(s.startedAt)+'. No se cargaron operaciones históricas. La comparación usa la misma cohorte; no garantiza rentabilidad futura.';
 document.getElementById('paperProtocol').textContent=s.version+' · protocolo '+s.protocolHash+' · observaciones '+s.samples+' · velas sin decisión por interrupciones '+s.missedH4Decisions;
 var list=document.getElementById('paperEvents');list.replaceChildren();(s.events||[]).slice(-12).reverse().forEach(function(e){var li=document.createElement('li');li.textContent=time(e.observedAt)+' · '+e.symbol+' · '+(e.type==='ENTRY'?'ENTRADA SIMULADA':'SALIDA SIMULADA')+' · USD '+fmt(e.price)+(e.delayMs!==null?' · demora '+fmt(e.delayMs/60000)+' min':' · stop observado');list.appendChild(li)});
 if(!list.childNodes.length){var li=document.createElement('li');li.textContent='Todavía no hubo entradas nuevas desde la línea de base.';list.appendChild(li)}
 }catch(error){document.getElementById('paperStatus').textContent='NO SE PUDO VERIFICAR EL SEGUIMIENTO';document.getElementById('paperMetrics').replaceChildren();document.getElementById('paperEvidence').textContent='No se puede confirmar la vigencia del registro. '+error.message;document.getElementById('paperEvents').replaceChildren();}}
refresh();setInterval(refresh,60000);
})();
