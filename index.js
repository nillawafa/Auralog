/**
 * AuraLog API Proxy
 *
 * Sits between the browser and Anthropic's API.
 * The ANTHROPIC_API_KEY never reaches the client.
 *
 * Routes:
 *   POST /api/claude        — proxy to Anthropic /v1/messages
 *   GET  /api/health        — liveness check
 *   GET  /api/status        — key configured? (boolean only, never exposes key)
 */

import express from 'express';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3851;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ─── Security middleware ──────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
}));

// Only accept requests from the same host (nginx → proxy, no external access)
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';

  // Allow same-origin and requests with no origin (server-to-server)
  // In production behind nginx, origin will be empty or same host
  const allowedOrigins = [
    `http://localhost:3850`,
    `http://127.0.0.1:3850`,
    // Umbrel internal network patterns
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

// Rate limiting — generous for personal use, blocks abuse
const limiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 30,                    // 30 requests/min per IP (well above personal use)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});
app.use('/api/claude', limiter);

app.use(express.json({ limit: '64kb' }));  // Cap request body size

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({
    aiEnabled: Boolean(ANTHROPIC_API_KEY),
    // Deliberately never return the key itself, even partially
  });
});

app.post('/api/claude', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'AI features not configured. Set ANTHROPIC_API_KEY in your .env file.',
      code: 'NO_API_KEY',
    });
  }

  const { system, messages, max_tokens = 1000 } = req.body;

  // Input validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (max_tokens > 2000) {
    return res.status(400).json({ error: 'max_tokens capped at 2000' });
  }

  // Sanitize: strip any attempt to inject a different model or override system
  const payload = {
    model: CLAUDE_MODEL,   // Always use our pinned model, ignore client suggestion
    max_tokens,
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 8000),  // Hard cap per message
    })),
  };

  if (system) {
    payload.system = String(system).slice(0, 4000);
  }

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
      // Forward the error type but not internal Anthropic details
      const status = upstream.status === 401 ? 401
                   : upstream.status === 429 ? 429
                   : 502;
      return res.status(status).json({
        error: data?.error?.message || 'Upstream API error',
        code: data?.error?.type || 'UPSTREAM_ERROR',
      });
    }

    // Only forward the content — strip billing/usage metadata from response
    res.json({
      content: data.content,
    });

  } catch (err) {
    console.error('[proxy] fetch error:', err.message);
    res.status(502).json({ error: 'Could not reach Anthropic API', code: 'NETWORK_ERROR' });
  }
});

// Catch-all 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Start ────────────────────────────────────────────────────────────────────

createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`[auralog-proxy] listening on port ${PORT}`);
  console.log(`[auralog-proxy] AI features: ${ANTHROPIC_API_KEY ? 'ENABLED' : 'DISABLED (set ANTHROPIC_API_KEY)'}`);
});
