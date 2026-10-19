'use strict';
const assert=require('node:assert/strict');
const {mix,metrics,stitch,diverse}=require('../scripts/lib/research-portfolio.cjs');
assert.deepEqual(mix([[[0,1],[1,2]],[[0,1],[1,.5]]],[.25,.25],.5),[[0,1],[1,1.125]],'fixed initial allocations must retain idle cash without free rebalancing');
assert.throws(()=>mix([[[0,1],[1,2]],[[0,1],[2,1]]],[.5,.5]),/Unaligned/);
assert.throws(()=>mix([[[0,1],[1,2]]],[1.2]),/allocation/);
assert.deepEqual(stitch([[[0,1],[1,2]],[[2,1],[3,.5]]]),[[0,1],[1,2],[2,2],[3,1]],'window capital must compound, not reset');
assert.equal(metrics([[0,1],[1,2],[2,1]]).maxDrawdown,.5);
assert.equal(metrics([[0,1],[1,2],[2,1]]).return,0);
assert.deepEqual(diverse([{spec:{family:'a',id:1}},{spec:{family:'a',id:2}},{spec:{family:'b',id:3}}],2).map(x=>x.spec.id),[1,3]);
console.log('PASS: fixed portfolio allocation/cash, alignment, leverage rejection, compound windows, continuous drawdown and distinct-family selection');
assert.throws(()=>metrics([[0,1],[0,1.1]]),/Invalid equity/);
assert.throws(()=>metrics([[0,1],[1,Infinity]]),/Invalid equity/);
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const published=require('../docs/research/portfolio-results-2026-10-19.json');
for(const [file,sha]of Object.entries(published.identity)){const p=path.join(__dirname,'..',file==='search-strategy-portfolios.cjs'?'scripts':'scripts/lib',file);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),sha);}
assert.equal(published.approvedForLive,false);
