/**
 * AuraLog API Proxy + Persistence
 *
 * Routes:
 *   GET  /api/entries        — read all journal entries from disk
 *   POST /api/entries        — save all journal entries to disk
 *   POST /api/claude         — proxy to Anthropic /v1/messages (key stays server-side)
 *   GET  /api/health         — liveness check
 *   GET  /api/status         — AI key configured? (boolean only, key never exposed)
 */

import express from 'express';
import { createServer } from 'http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3851;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Where journal data lives inside the container.
// docker-compose mounts:  ./data:/data
// This means entries.json persists at ~/umbrel/app-data/auralog/data/entries.json
const DATA_DIR     = process.env.DATA_DIR || '/data';
const ENTRIES_FILE = `${DATA_DIR}/entries.json`;

// Ensure /data exists on first run
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ─── Security middleware ──────────────────────────────────────────────────────

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'http://localhost:3850',
    'http://127.0.0.1:3850',
    /^http:\/\/192\.168\./,
    /^http:\/\/10\./,
    /^http:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,
    /^http:\/\/umbrel\.local/,
  ];
  const allowed = !origin || allowedOrigins.some(p =>
    typeof p === 'string' ? origin === p : p.test(origin)
  );
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  next();
});

const claudeLimiter = rateLimit({
  windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});
const storageLimiter = rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many storage requests.' },
});

app.use(express.json({ limit: '4mb' }));

// ─── Health / Status ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ aiEnabled: Boolean(ANTHROPIC_API_KEY) });
});

// ─── Journal Persistence ──────────────────────────────────────────────────────

// GET /api/entries — returns full entries array, [] on first run
app.get('/api/entries', storageLimiter, (req, res) => {
  try {
    if (!existsSync(ENTRIES_FILE)) return res.json([]);
    const raw = readFileSync(ENTRIES_FILE, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) {
      console.warn('[storage] entries.json corrupt — returning []');
      return res.json([]);
    }
    res.json(entries);
  } catch (err) {
    console.error('[storage] read error:', err.message);
    res.status(500).json({ error: 'Could not read entries', code: 'READ_ERROR' });
  }
});

// POST /api/entries — replaces entries on disk (atomic write-then-rename)
app.post('/api/entries', storageLimiter, (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'Body must be a JSON array', code: 'INVALID_BODY' });
  }
  try {
    const tmp = ENTRIES_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
    renameSync(tmp, ENTRIES_FILE);  // atomic on Linux (same filesystem)
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    console.error('[storage] write error:', err.message);
    res.status(500).json({ error: 'Could not save entries', code: 'WRITE_ERROR' });
  }
});

// ─── Claude Proxy ─────────────────────────────────────────────────────────────

app.post('/api/claude', claudeLimiter, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'AI features not configured. Set ANTHROPIC_API_KEY in your .env file.',
      code: 'NO_API_KEY',
    });
  }

  const { system, messages, max_tokens = 1000 } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (max_tokens > 2000) {
    return res.status(400).json({ error: 'max_tokens capped at 2000' });
  }

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens,
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 8000),
    })),
  };
  if (system) payload.system = String(system).slice(0, 4000);

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      const status = upstream.status === 401 ? 401
                   : upstream.status === 429 ? 429
                   : 502;
      return res.status(status).json({
        error: data?.error?.message || 'Upstream API error',
        code: data?.error?.type || 'UPSTREAM_ERROR',
      });
    }
    res.json({ content: data.content });
  } catch (err) {
    console.error('[proxy] fetch error:', err.message);
    res.status(502).json({ error: 'Could not reach Anthropic API', code: 'NETWORK_ERROR' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────

createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`[auralog-proxy] listening on port ${PORT}`);
  console.log(`[auralog-proxy] AI: ${ANTHROPIC_API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`[auralog-proxy] storage: ${ENTRIES_FILE}`);
});
