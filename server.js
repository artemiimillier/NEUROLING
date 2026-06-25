// server.js — NEUROLING local bridge
// Serves the static app AND proxies ElevenLabs TTS through kie.ai using KIE_AI_API_KEY.
// Zero dependencies (Node built-ins only, requires Node 18+ for global fetch).
//   Run:  node server.js   →   http://localhost:8000
//
// The kie.ai key stays server-side and is never exposed to the browser.
// TTS results are cached to .tts-cache/ so repeated words are instant and free.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 8000;
const CACHE_DIR = path.join(ROOT, '.tts-cache');

const KIE_BASE = 'https://api.kie.ai/api/v1';
const KIE_MODEL = 'elevenlabs/text-to-speech-multilingual-v2';
const DEFAULT_VOICE = 'EkK5I93UQWFDigLMpZcX'; // James — clear, engaging

// ---- load KIE key from .env (or process.env) --------------------------------
function loadEnv() {
  const out = {};
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) { /* no .env — fine */ }
  return out;
}
const ENV = loadEnv();
const KIE_KEY = process.env.KIE_AI_API_KEY || ENV.KIE_AI_API_KEY || '';

try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) { /* ignore */ }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- kie.ai TTS: create task → poll recordInfo → fetch mp3 → Buffer ----------
async function kieTTS(text, voice, speed) {
  if (typeof fetch !== 'function') throw new Error('Node 18+ required (global fetch missing)');
  if (!KIE_KEY) throw new Error('KIE_AI_API_KEY missing in .env');

  const headers = { Authorization: 'Bearer ' + KIE_KEY, 'Content-Type': 'application/json' };
  const input = { text: String(text).slice(0, 5000), voice: voice || DEFAULT_VOICE };
  if (typeof speed === 'number') input.speed = Math.max(0.7, Math.min(1.2, speed));

  const createRes = await fetch(KIE_BASE + '/jobs/createTask', {
    method: 'POST', headers, body: JSON.stringify({ model: KIE_MODEL, input }),
  });
  const createJson = await createRes.json().catch(() => null);
  if (!createJson || createJson.code !== 200 || !createJson.data || !createJson.data.taskId) {
    throw new Error('createTask failed: ' + (createJson && createJson.msg ? createJson.msg : createRes.status));
  }
  const taskId = createJson.data.taskId;

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(1200);
    const r = await fetch(KIE_BASE + '/jobs/recordInfo?taskId=' + encodeURIComponent(taskId), { headers });
    const j = await r.json().catch(() => null);
    const d = (j && j.data) || {};
    if (d.state === 'success') {
      let urls = [];
      try { urls = (JSON.parse(d.resultJson || '{}').resultUrls) || []; } catch (_) { /* ignore */ }
      if (!urls.length) throw new Error('kie: no result url');
      const audioRes = await fetch(urls[0]);
      if (!audioRes.ok) throw new Error('kie: audio fetch ' + audioRes.status);
      return Buffer.from(await audioRes.arrayBuffer());
    }
    if (d.state === 'fail') throw new Error('kie fail: ' + (d.failMsg || 'unknown'));
  }
  throw new Error('kie: timeout');
}

// ---- POST /api/tts  { text, voice?, speed? } → audio/mpeg --------------------
function handleTTS(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const text = payload.text;
      if (!text || !String(text).trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text required' }));
        return;
      }
      const voice = payload.voice || DEFAULT_VOICE;
      const speed = typeof payload.speed === 'number' ? payload.speed : undefined;

      const cacheKey = crypto.createHash('sha256')
        .update(KIE_MODEL + '|' + voice + '|' + (speed == null ? '' : speed) + '|' + text)
        .digest('hex');
      const file = path.join(CACHE_DIR, cacheKey + '.mp3');

      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'X-Cache': 'HIT' });
        res.end(buf);
        return;
      }

      const buf = await kieTTS(text, voice, speed);
      try { fs.writeFileSync(file, buf); } catch (_) { /* ignore cache write errors */ }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'X-Cache': 'MISS' });
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String((e && e.message) || e) }));
    }
  });
}

// ---- static file serving (with traversal + secret protection) ---------------
function serveStatic(req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const filePath = path.normalize(path.join(ROOT, p));

  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  const base = path.basename(filePath);
  if (base === '.env' || filePath.startsWith(CACHE_DIR)) { res.writeHead(404); res.end('not found'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- server -----------------------------------------------------------------
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tts: KIE_KEY ? 'kie' : 'browser', model: KIE_MODEL }));
    return;
  }
  if (urlPath === '/api/tts' && req.method === 'POST') { handleTTS(req, res); return; }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const mode = KIE_KEY ? 'kie.ai ElevenLabs (' + KIE_MODEL + ')' : 'browser fallback — NO KIE KEY FOUND';
  console.log('NEUROLING bridge ready → http://localhost:' + PORT);
  console.log('  TTS voice engine: ' + mode);
  if (!KIE_KEY) console.log('  ⚠  Put KIE_AI_API_KEY=... in .env to enable premium voice.');
});
