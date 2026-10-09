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
  const files = {'/':'index.html','/index.html':'index.html','/command-center.js':'command-center.js'};
  const file = files[url.pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('content-type', file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
  fs.createReadStream(path.join(root,file)).pipe(res);
}).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('MTF local server ready '+server.address().port));
