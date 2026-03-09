# AuraLog

**AI-powered private journal. Runs on your Umbrel node. Your data never leaves your hardware.**

Built for people who want the analytical power of AI applied to their personal writing without feeding a cloud service their most private thoughts.

---

## How it works

```
Your browser
    ↓  journal entries stored in localStorage (AES-256-GCM encrypted)
    ↓  AI requests go to /api/claude (same host)
        ↓
      nginx (your Umbrel node)
          ↓  /api/* proxied to internal container
          ↓
        Express proxy (auralog-proxy container)
            ↓  appends ANTHROPIC_API_KEY (server-side only)
            ↓
          api.anthropic.com
```

The API key never touches the browser. Journal entries never leave your node except when you explicitly trigger an AI feature.

---

## Features

### Journaling
- **6 categories**: Personal, Work, Reading, Creative, Learning, Health
- **Mood (1–5) + Energy (1–5)** per entry
- Tag system with filtering
- Full-text search + semantic AI search

### AI (requires Anthropic API key — optional)
- **Entry Reflection** — pattern, non-obvious insight, 24h action step, reflection question
- **Ask AI** — conversational queries across your entire journal history
- **Smart Prompts** — writing prompts tailored to your mood, category, and recent entries
- **Weekly Digest** — narrative summary, highlights, patterns, growth observation, weekly intention
- **Pattern Analysis** — full-history: emotional trajectory, strengths, blindspots, recommendations

### Analytics (no API key required)
- Mood trend over time (area chart)
- Journey distribution (donut chart)
- Avg mood by day of week
- Recurring word themes
- Day streak tracking

### Privacy & Security
- **AES-256-GCM encryption** with PBKDF2 key derivation (310k iterations) — Web Crypto API, no deps
- API key stored server-side in `.env`, never sent to browser
- Proxy container on isolated internal Docker network
- CSP header blocks browser-to-Anthropic direct calls
- Zero telemetry, zero accounts, zero cookies

---

## Installation

### Requirements
- Umbrel OS (or any Linux box with Docker + Docker Compose)
- 512MB RAM
- Anthropic API key (optional — only for AI features)

### Quick install

```bash
ssh umbrel@umbrel.local

# Clone
git clone https://github.com/nillawafa/auralog.git ~/umbrel/app-data/auralog
cd ~/umbrel/app-data/auralog

# Configure
cp .env.example .env
nano .env  # paste your ANTHROPIC_API_KEY (or leave blank to skip AI features)

# Build and run
docker-compose up -d --build

# Open
# http://umbrel.local:3850
```

Or use the installer script:

```bash
wget -qO- https://raw.githubusercontent.com/nillawafa/auralog/main/install.sh | bash
```

### Verify it's running

```bash
docker ps | grep auralog                      # two containers: auralog + auralog-proxy
curl http://umbrel.local:3850                 # should return HTML
curl http://umbrel.local:3850/api/health      # {"status":"ok"}
curl http://umbrel.local:3850/api/status      # {"aiEnabled":true/false}
```

---

## Security model

| Attack | Mitigation |
|---|---|
| Browser reads API key | Key only in proxy container env, never in HTTP responses |
| Browser calls Anthropic directly | CSP `connect-src 'self'` blocks it |
| External access to proxy | `internal: true` Docker network; proxy port not exposed to host |
| Request body injection | Proxy sanitizes: pins model, caps token count, strips auth headers |
| Rate abuse | `express-rate-limit`: 30 req/min per IP |
| Oversized payloads | `express.json({ limit: '64kb' })` |
| XSS reading localStorage | CSP + `X-Frame-Options` + `X-Content-Type-Options` |
| Weak encryption | AES-256-GCM + PBKDF2-SHA-256 (310k iter) |

Full details: [PRIVACY.md](./PRIVACY.md)

---

## Configuration

**`.env`** (the only file you need to edit):

```bash
ANTHROPIC_API_KEY=sk-ant-...   # get from console.anthropic.com/keys
APP_AURALOG_PORT=3850           # change if port is taken
```

AI features are **fully optional**. Leave `ANTHROPIC_API_KEY` blank and everything except AI features works normally.

---

## Architecture

```
auralog/
├── src/
│   ├── App.jsx          # React SPA — all UI components
│   └── index.js         # Entry point
├── server/
│   ├── index.js         # Express proxy — holds API key, rate limits, sanitizes
│   ├── package.json
│   └── Dockerfile
├── public/
│   └── index.html
├── docker/
│   └── nginx.conf       # Reverse proxy + CSP + security headers
├── .github/
│   └── workflows/
│       └── docker-publish.yml  # Multi-arch build → GHCR on tag push
├── Dockerfile           # React build → nginx (web container)
├── docker-compose.yml   # Two services: web + proxy, internal network
├── .env.example
├── umbrel-app.yml       # Umbrel App Store manifest
├── exports.sh
├── PRIVACY.md           # Machine-verifiable privacy claims
└── install.sh
```

**Stack:** React 18 · Vite · Recharts · Lucide React · Express 4 · Helmet · nginx 1.25 · Node 20 · Bricolage Grotesque

---

## Umbrel App Store submission

1. Fork [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps)
2. Create `auralog/` directory with:
   - `umbrel-app.yml` (included)
   - `docker-compose.yml` (included — update image refs to point to GHCR)
   - `exports.sh` (included)
   - `icon.svg` (200×200)
   - `gallery/1.png`, `2.png`, `3.png` (screenshots, 800×600)
3. Open a PR against `master`

The CI workflow publishes multi-arch images to `ghcr.io/nillawafa/auralog` on every version tag. Pin that image in your Umbrel submission's `docker-compose.yml` instead of using `build:`.

---

## Development

```bash
git clone https://github.com/nillawafa/auralog.git
cd auralog

# Frontend (hot reload)
npm install
npm run dev            # http://localhost:3850

# Proxy (separate terminal)
cd server
npm install
ANTHROPIC_API_KEY=your_key npm run dev   # http://localhost:3851
```

---

## Roadmap

- [ ] Self-hosted font option (eliminate Google Fonts request)
- [ ] Ollama integration (local LLM alternative to Claude API)
- [ ] Multiple encrypted vaults
- [ ] Day One / Notion / Bear import
- [ ] Calendar heatmap view
- [ ] Browser notification reminders

---

## License

MIT
