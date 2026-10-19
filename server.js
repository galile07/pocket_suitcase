/*
  Pocket Suitcase — Local Dev Server (zero dependencies)
  ------------------------------------------------------
  Start:  node server.js          (or: npm start)
  Guide:  http://localhost:3000/
  API:    GET  /api/data  → read data.json
          POST /api/data  → replace data.json (backup kept as data.backup.json)

  Your editor site can live in this same folder (e.g. editor.html)
  and will be served automatically. It should:
    1. GET  /api/data          → load current data
    2. Edit it in the UI
    3. POST /api/data (JSON)   → save changes back
  The guide site reloads the data on every page refresh.
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const BACKUP_FILE = path.join(ROOT, 'data.backup.json');
const DEFAULT_PAGE = 'pocket_suitcase_timekeeper_s_guide.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large (max 10 MB)'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/data') {
    if (req.method === 'GET') {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(raw);
      } catch (err) {
        sendJSON(res, 404, { ok: false, error: 'data.json not found — run the extraction or create it first.' });
      }
      return true;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const body = await readBody(req);
        let newData;
        try {
          newData = JSON.parse(body);
        } catch {
          sendJSON(res, 400, { ok: false, error: 'Body is not valid JSON.' });
          return true;
        }
        if (typeof newData !== 'object' || newData === null || Array.isArray(newData)) {
          sendJSON(res, 400, { ok: false, error: 'Body must be a JSON object (the full data structure).' });
          return true;
        }
        if (!Array.isArray(newData.characters)) {
          sendJSON(res, 400, { ok: false, error: 'Data must include a "characters" array.' });
          return true;
        }

        // Keep one rolling backup before overwriting
        if (fs.existsSync(DATA_FILE)) {
          fs.copyFileSync(DATA_FILE, BACKUP_FILE);
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2), 'utf8');
        console.log(`[API] data.json updated (${newData.characters.length} characters). Backup: data.backup.json`);
        sendJSON(res, 200, { ok: true, message: 'Data saved successfully.' });
      } catch (err) {
        sendJSON(res, 500, { ok: false, error: err.message });
      }
      return true;
    }

    sendJSON(res, 405, { ok: false, error: `Method ${req.method} not allowed on /api/data.` });
    return true;
  }

  if (pathname.startsWith('/api/')) {
    sendJSON(res, 404, { ok: false, error: 'Unknown API endpoint. Try GET or POST /api/data' });
    return true;
  }

  return false;
}

function serveStatic(req, res, pathname) {
  // Default page at "/"
  let rel = pathname.replace(/^\/+/, '');
  if (rel === '') rel = DEFAULT_PAGE;

  const filePath = path.resolve(ROOT, rel);
  const rootResolved = path.resolve(ROOT);
  // Path traversal protection
  if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 — Not Found</h1><p>Try <a href="/' + DEFAULT_PAGE + '">' + DEFAULT_PAGE + '</a></p>');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': stat.size,
        'Cache-Control': 'no-store'
      });
      res.end(content);
    });
  });
}

const server = http.createServer(async (req, res) => {
  setCORS(res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  console.log(`[HTTP] ${req.method} ${pathname}`);

  const isApi = await handleApi(req, res, pathname);
  if (!isApi) {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  POCKET SUITCASE — local server running');
  console.log('  ─────────────────────────────────────');
  console.log(`  Guide site : http://localhost:${PORT}/`);
  console.log(`  Data API   : http://localhost:${PORT}/api/data`);
  console.log('  Editor site: drop editor.html in this folder → http://localhost:' + PORT + '/editor.html');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
