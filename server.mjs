import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join, extname, dirname, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = join(HERE, 'public');
const DEFAULT_DATA_DIR = join(HERE, 'data');
const LANGUAGES = new Set(['zh', 'en', 'es', 'fr', 'ru', 'ar']);
const MAX_JSON_BYTES = 16 * 1024;
const RECEIPT_DAYS = 180;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function json(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function loadOrCreateSecrets(dataDir, env = process.env) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'secrets.json');
  let saved = {};
  if (existsSync(file)) {
    try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { saved = {}; }
  }
  const receiptSecret = env.RECEIPT_SECRET || saved.receiptSecret || randomBytes(48).toString('base64url');
  const adminToken = env.ADMIN_TOKEN || saved.adminToken || randomBytes(24).toString('base64url');
  if (!env.RECEIPT_SECRET || !env.ADMIN_TOKEN) {
    writeFileSync(file, JSON.stringify({ receiptSecret, adminToken }, null, 2), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch {}
  }
  return { receiptSecret, adminToken, secretsFile: file };
}

function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'feedback.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      nationality TEXT NOT NULL,
      comment TEXT NOT NULL,
      language TEXT NOT NULL,
      pet_name TEXT NOT NULL,
      client_hash TEXT NOT NULL,
      network_hash TEXT NOT NULL,
      consent INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
    CREATE INDEX IF NOT EXISTS idx_feedback_nationality ON feedback(nationality);
    CREATE INDEX IF NOT EXISTS idx_feedback_client_hash ON feedback(client_hash, created_at DESC);
  `);
  return db;
}

function makeReceipt(feedbackId, receiptSecret, now = Date.now()) {
  const payload = {
    v: 1,
    fid: feedbackId,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + RECEIPT_DAYS * 24 * 60 * 60,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', receiptSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyReceipt(receipt, receiptSecret, db, now = Date.now()) {
  if (typeof receipt !== 'string' || receipt.length > 2048) return false;
  const [encoded, supplied, extra] = receipt.split('.');
  if (!encoded || !supplied || extra) return false;
  const expected = createHmac('sha256', receiptSecret).update(encoded).digest('base64url');
  if (!safeEqual(supplied, expected)) return false;
  let payload;
  try { payload = JSON.parse(fromBase64url(encoded)); } catch { return false; }
  if (payload?.v !== 1 || typeof payload.fid !== 'string' || payload.exp < Math.floor(now / 1000)) return false;
  const row = db.prepare('SELECT id FROM feedback WHERE id = ?').get(payload.fid);
  return Boolean(row);
}

async function readJsonBody(req, maxBytes = MAX_JSON_BYTES) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function extractIndexCsp(publicDir) {
  try {
    const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
    return html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] || "default-src 'self'";
  } catch {
    return "default-src 'self'";
  }
}

function securityHeaders(csp) {
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

function mimeType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
  })[extname(path).toLowerCase()] || 'application/octet-stream';
}

function createRateLimiter({ max = 12, windowMs = 60 * 60 * 1000 } = {}) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (bucket.length >= max) return false;
    bucket.push(now);
    buckets.set(key, bucket);
    if (buckets.size > 10_000) {
      for (const [k, values] of buckets) if (!values.some((t) => now - t < windowMs)) buckets.delete(k);
    }
    return true;
  };
}

function parseAllowedOrigins(port, env) {
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...configured,
  ]);
}

export function createPixelPetServer(options = {}) {
  const env = options.env || process.env;
  const publicDir = resolve(options.publicDir || env.PUBLIC_DIR || DEFAULT_PUBLIC_DIR);
  const dataDir = resolve(options.dataDir || env.DATA_DIR || DEFAULT_DATA_DIR);
  const port = Number(options.port ?? env.PORT ?? 8787);
  const host = options.host || env.HOST || '0.0.0.0';
  const secrets = loadOrCreateSecrets(dataDir, env);
  const db = openDatabase(dataDir);
  const submitAllowed = createRateLimiter({ max: Number(env.RATE_LIMIT_PER_HOUR || 12), windowMs: 60 * 60 * 1000 });
  const allowedOrigins = parseAllowedOrigins(port, env);
  const allowFileOrigin = String(env.ALLOW_FILE_ORIGIN || 'true').toLowerCase() === 'true';
  const indexCsp = extractIndexCsp(publicDir);

  const countClientRecent = db.prepare(`SELECT COUNT(*) AS count FROM feedback WHERE client_hash = ? AND created_at >= ?`);
  const insertFeedback = db.prepare(`INSERT INTO feedback (id, rating, nationality, comment, language, pet_name, client_hash, network_hash, consent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);

  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    if (origin && (allowedOrigins.has(origin) || (origin === 'null' && allowFileOrigin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, securityHeaders("default-src 'none'"));
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, { ok: true, service: 'pixelpet-feedback', time: new Date().toISOString() }, securityHeaders("default-src 'none'"));
        return;
      }

      if (pathname === '/api/feedback' && req.method === 'POST') {
        const ip = getClientIp(req);
        if (!submitAllowed(ip)) {
          json(res, 429, { error: 'Too many submissions. Please try again later.' }, securityHeaders("default-src 'none'"));
          return;
        }
        const body = await readJsonBody(req);
        if (cleanText(body.website, 200)) {
          json(res, 400, { error: 'Invalid submission.' }, securityHeaders("default-src 'none'"));
          return;
        }
        const rating = Number(body.rating);
        const nationality = cleanText(body.nationality, 80);
        const comment = cleanText(body.comment, 2000);
        const language = LANGUAGES.has(body.language) ? body.language : 'en';
        const petName = cleanText(body.petName, 80) || 'Pixel Pet';
        const clientId = cleanText(body.clientId, 128);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('Rating must be between 1 and 5.'), { status: 400 });
        if (nationality.length < 2) throw Object.assign(new Error('Nationality is required.'), { status: 400 });
        if (comment.length < 5) throw Object.assign(new Error('Review must contain at least 5 characters.'), { status: 400 });
        if (!clientId || !/^[A-Za-z0-9._:-]{8,128}$/.test(clientId)) throw Object.assign(new Error('Invalid client identifier.'), { status: 400 });
        if (body.consent !== true) throw Object.assign(new Error('Consent is required.'), { status: 400 });

        const clientHash = createHmac('sha256', secrets.receiptSecret).update(`client:${clientId}`).digest('hex');
        const networkHash = createHmac('sha256', secrets.receiptSecret).update(`network:${ip}`).digest('hex');
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        if (Number(countClientRecent.get(clientHash, tenMinutesAgo)?.count || 0) >= 3) {
          json(res, 429, { error: 'Please wait before submitting another review.' }, securityHeaders("default-src 'none'"));
          return;
        }

        const id = randomUUID();
        const createdAt = new Date().toISOString();
        insertFeedback.run(id, rating, nationality, comment, language, petName, clientHash, networkHash, createdAt);
        const receipt = makeReceipt(id, secrets.receiptSecret);
        json(res, 201, { ok: true, feedbackId: id, receipt }, securityHeaders("default-src 'none'"));
        return;
      }

      if (pathname === '/api/feedback/verify' && req.method === 'POST') {
        const body = await readJsonBody(req, 4096);
        const valid = verifyReceipt(body.receipt, secrets.receiptSecret, db);
        json(res, 200, { valid }, securityHeaders("default-src 'none'"));
        return;
      }

      if (pathname.startsWith('/api/admin/')) {
        const auth = String(req.headers.authorization || '');
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!token || !safeEqual(token, secrets.adminToken)) {
          json(res, 401, { error: 'Unauthorized' }, { ...securityHeaders("default-src 'none'"), 'WWW-Authenticate': 'Bearer' });
          return;
        }

        if (pathname === '/api/admin/feedback' && req.method === 'GET') {
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
          const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
          const ratingFilter = Number(url.searchParams.get('rating') || 0);
          const search = cleanText(url.searchParams.get('search'), 120);
          const clauses = [];
          const values = [];
          if (ratingFilter >= 1 && ratingFilter <= 5) { clauses.push('rating = ?'); values.push(ratingFilter); }
          if (search) { clauses.push('(nationality LIKE ? OR comment LIKE ? OR pet_name LIKE ?)'); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
          const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
          const rows = db.prepare(`SELECT id, rating, nationality, comment, language, pet_name, created_at FROM feedback ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...values, limit, offset);
          const total = db.prepare(`SELECT COUNT(*) AS count FROM feedback ${where}`).get(...values)?.count || 0;
          const stats = db.prepare(`SELECT COUNT(*) AS total, ROUND(AVG(rating), 2) AS average FROM feedback`).get();
          const ratings = db.prepare(`SELECT rating, COUNT(*) AS count FROM feedback GROUP BY rating ORDER BY rating DESC`).all();
          const nationalities = db.prepare(`SELECT nationality, COUNT(*) AS count FROM feedback GROUP BY nationality ORDER BY count DESC, nationality ASC LIMIT 12`).all();
          json(res, 200, { rows, total, stats, ratings, nationalities, limit, offset }, securityHeaders("default-src 'none'"));
          return;
        }

        if (pathname === '/api/admin/export.csv' && req.method === 'GET') {
          const rows = db.prepare(`SELECT id, rating, nationality, comment, language, pet_name, created_at FROM feedback ORDER BY created_at DESC`).all();
          const csv = [
            ['id', 'rating', 'nationality', 'comment', 'language', 'pet_name', 'created_at'].map(escapeCsv).join(','),
            ...rows.map((row) => [row.id, row.rating, row.nationality, row.comment, row.language, row.pet_name, row.created_at].map(escapeCsv).join(',')),
          ].join('\r\n');
          const body = Buffer.from(`\uFEFF${csv}`, 'utf8');
          res.writeHead(200, {
            ...securityHeaders("default-src 'none'"),
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="pixelpet-feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
          });
          res.end(body);
          return;
        }

        json(res, 404, { error: 'Not found' }, securityHeaders("default-src 'none'"));
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'Method not allowed' }, securityHeaders("default-src 'none'"));
        return;
      }

      const aliases = new Map([
        ['/', '/index.html'],
        ['/admin', '/admin.html'],
        ['/privacy', '/privacy.html'],
      ]);
      const requested = aliases.get(pathname) || pathname;
      const relativePath = normalize(requested).replace(/^([/\\])+/, '');
      const filePath = resolve(publicDir, relativePath);
      const pathFromPublic = relative(publicDir, filePath);
      if (pathFromPublic === '..' || pathFromPublic.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromPublic)) {
        json(res, 400, { error: 'Invalid path' }, securityHeaders("default-src 'none'"));
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        json(res, 404, { error: 'Not found' }, securityHeaders("default-src 'none'"));
        return;
      }
      const body = readFileSync(filePath);
      let csp = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
      if (filePath.endsWith('index.html')) csp = indexCsp;
      if (filePath.endsWith('admin.html')) csp = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
      if (filePath.endsWith('privacy.html')) csp = "default-src 'none'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
      res.writeHead(200, {
        ...securityHeaders(csp),
        'Content-Type': mimeType(filePath),
        'Content-Length': body.length,
        'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') res.end(); else res.end(body);
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) console.error(error);
      json(res, status, { error: status >= 500 ? 'Internal server error' : error.message }, securityHeaders("default-src 'none'"));
    }
  });

  return {
    server,
    db,
    host,
    port,
    adminToken: secrets.adminToken,
    secretsFile: secrets.secretsFile,
    listen(callback) { return server.listen(port, host, callback); },
    close() { return new Promise((resolveClose) => server.close(() => { db.close(); resolveClose(); })); },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const app = createPixelPetServer();
  app.server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`Port ${app.port} is already in use.`);
      console.error('Close the previous PixelPet server or run STOP_PIXELPET.cmd, then try again.');
      process.exitCode = 1;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });
  app.listen(() => {
    const printableHost = app.host === '0.0.0.0' ? 'localhost' : app.host;
    console.log(`PixelPet v5.5.2 is running at http://${printableHost}:${app.port}`);
    console.log(`Feedback admin: http://${printableHost}:${app.port}/admin`);
    console.log(`Admin token: ${app.adminToken}`);
    console.log(`Secrets file: ${app.secretsFile}`);
  });
}
