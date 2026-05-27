/**
 * AuraLog API Proxy + Persistence
 *
 * API key flow:
 *   The Anthropic API key is NOT passed via environment variable.
 *   Users enter their key in-app after install. The key is persisted
 *   to /data/apikey.txt on the Umbrel host filesystem.
 *
 * Routes:
 *   GET  /api/entries           — read all journal entries from disk
 *   POST /api/entries           — save all journal entries to disk
 *   POST /api/claude            — proxy to Anthropic /v1/messages
 *   GET  /api/health            — liveness check
 *   GET  /api/status            — AI key configured? (boolean, never exposes key)
 *   GET  /api/settings/apikey   — is a key set? (boolean only)
 *   PUT  /api/settings/apikey   — set or update the Anthropic API key
 *   DELETE /api/settings/apikey — remove the stored key
 */

import express from 'express';
import { createServer } from 'http';
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3851;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Where data lives inside the container.
// docker-compose mounts: ${APP_DATA_DIR}/data:/data
const DATA_DIR     = process.env.DATA_DIR || '/data';
const ENTRIES_FILE = `${DATA_DIR}/entries.json`;
const APIKEY_FILE  = `${DATA_DIR}/apikey.txt`;

// Ensure /data exists on first run
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// Read API key from disk (returns empty string if not set)
function getApiKey() {
  try {
    if (existsSync(APIKEY_FILE)) {
      return readFileSync(APIKEY_FILE, 'utf8').trim();
    }
  } catch (err) {
    console.error('[proxy] error reading API key file:', err.message);
  }
  // Fall back to env var for backward compat / local dev
  return process.env.ANTHROPIC_API_KEY || '';
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
  if (!allowed) {
    return res.status(403).json({ error: 'Forbidden: cross-origin request rejected' });
  }
  next();
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});
app.use('/api/claude', limiter);

app.use(express.json({ limit: '64kb' }));

// ─── Journal persistence ──────────────────────────────────────────────────────

app.get('/api/entries', (req, res) => {
  try {
    if (!existsSync(ENTRIES_FILE)) {
      return res.json([]);
    }
    const data = readFileSync(ENTRIES_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('[proxy] read entries error:', err.message);
    res.status(500).json({ error: 'Failed to read entries' });
  }
});

app.post('/api/entries', (req, res) => {
  try {
    const entries = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'Body must be an array' });
    }
    const tmp = `${ENTRIES_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
    renameSync(tmp, ENTRIES_FILE);
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    console.error('[proxy] write entries error:', err.message);
    res.status(500).json({ error: 'Failed to save entries' });
  }
});

// ─── API key management ───────────────────────────────────────────────────────

app.get('/api/settings/apikey', (req, res) => {
  const key = getApiKey();
  res.json({
    configured: Boolean(key),
    hint: key ? `...${key.slice(-4)}` : null,
  });
});

app.put('/api/settings/apikey', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid key' });
  }
  const trimmed = key.trim();
  if (!trimmed.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'Key should start with sk-ant-' });
  }
  try {
    writeFileSync(APIKEY_FILE, trimmed, { encoding: 'utf8', mode: 0o600 });
    console.log('[proxy] API key updated');
    res.json({ ok: true, configured: true, hint: `...${trimmed.slice(-4)}` });
  } catch (err) {
    console.error('[proxy] write API key error:', err.message);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

app.delete('/api/settings/apikey', (req, res) => {
  try {
    if (existsSync(APIKEY_FILE)) {
      unlinkSync(APIKEY_FILE);
    }
    console.log('[proxy] API key removed');
    res.json({ ok: true, configured: false });
  } catch (err) {
    console.error('[proxy] delete API key error:', err.message);
    res.status(500).json({ error: 'Failed to remove API key' });
  }
});

// ─── Health / status ──────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ aiEnabled: Boolean(getApiKey()) });
});

// ─── Claude proxy ─────────────────────────────────────────────────────────────

app.post('/api/claude', async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI features not configured. Add your Anthropic API key in Settings.',
      code: 'NO_API_KEY',
    });
  }

  const { prompt, systemPrompt, context } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid prompt' });
  }
  if (prompt.length > 8000) {
    return res.status(400).json({ error: 'Prompt too long (max 8000 chars)' });
  }

  const messages = [];
  if (context && typeof context === 'string') {
    messages.push({ role: 'user', content: context });
    messages.push({ role: 'assistant', content: 'I understand the context. How can I help?' });
  }
  messages.push({ role: 'user', content: prompt });

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemPrompt || 'You are a thoughtful journaling assistant. Be empathetic, insightful, and concise.',
        messages,
      }),
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
  const keyConfigured = Boolean(getApiKey());
  console.log(`[auralog-proxy] listening on port ${PORT}`);
  console.log(`[auralog-proxy] AI features: ${keyConfigured ? 'ENABLED' : 'DISABLED (add key in Settings)'}`);
  console.log(`[auralog-proxy] journal storage: ${ENTRIES_FILE}`);
});
