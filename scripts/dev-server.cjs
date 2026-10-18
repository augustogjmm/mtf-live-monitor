'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const handler = require(path.join(root, 'api/data.js'));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    try { await handler(req, res); } catch { res.status(500).json({error:'Local handler failure'}); }
    return;
  }
  const files = {'/':'index.html','/index.html':'index.html','/command-center.js':'command-center.js',
    '/docs/research/':'docs/research/index.html'};
  for(const name of ['expanded.html','broad-results-2026-10-18.json','broad-finalists-2026-10-18.json','broad-catalog-2026-10-18.json','broad-rankings-2026-10-18.csv','broad-stress-2026-10-18.png','index.html','holdout-2026-10-17.png','rankings-2026-10-17.csv','results-2026-10-17.json','protocol-2026-10-17.json'])files['/docs/research/'+name]='docs/research/'+name;
  const file = files[url.pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  const types={'.js':'application/javascript','.html':'text/html; charset=utf-8','.json':'application/json','.csv':'text/csv; charset=utf-8','.png':'image/png'};
  res.setHeader('content-type',types[path.extname(file)]);
  fs.createReadStream(path.join(root,file)).pipe(res);
}).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('MTF local server ready '+server.address().port));
