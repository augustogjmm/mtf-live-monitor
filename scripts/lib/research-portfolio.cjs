'use strict';
const DAY=86400000;
// Capital is allocated once to independent sleeves; this is not free daily rebalancing.
function mix(curves,weights,cash=0){
 if(!curves.length||curves.length!==weights.length||weights.some(x=>!Number.isFinite(x)||x<0)||!Number.isFinite(cash)||cash<0||Math.abs(weights.reduce((a,b)=>a+b,0)+cash-1)>1e-9)throw Error('Invalid portfolio allocation');
 const dates=curves[0].map(x=>x[0]);
 for(const curve of curves)if(curve.length!==dates.length||curve.some((x,i)=>x[0]!==dates[i]||!(x[1]>0&&Number.isFinite(x[1]))))throw Error('Unaligned portfolio histories');
 return dates.map((t,i)=>[t,cash+curves.reduce((sum,c,j)=>sum+c[i][1]*weights[j],0)]);
}
function metrics(curve){
 if(curve.length<2)throw Error('Insufficient equity history');let peak=1,dd=0,prior=1;const changes=[];
 let lastTime=-Infinity;for(const [t,e]of curve){if(!(e>0&&Number.isFinite(e)&&Number.isFinite(t)&&t>lastTime))throw Error('Invalid equity');lastTime=t;peak=Math.max(peak,e);dd=Math.max(dd,1-e/peak);changes.push(e/prior-1);prior=e;}
 const years=(curve.at(-1)[0]-curve[0][0]+DAY)/(365.25*DAY),cagr=curve.at(-1)[1]**(1/years)-1;
 return {return:curve.at(-1)[1]-1,cagr,maxDrawdown:dd,calmar:dd?cagr/dd:0};
}
function stitch(curves){let capital=1;return curves.flatMap(curve=>{const combined=curve.map(([t,e])=>[t,e*capital]);capital=combined.at(-1)[1];return combined;});}
function diverse(ranking,n){const used=new Set();return ranking.filter(x=>{if(used.has(x.spec.family))return false;used.add(x.spec.family);return true;}).slice(0,n);}
module.exports={mix,metrics,stitch,diverse};
