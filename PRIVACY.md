# AuraLog Privacy Model

This document explains precisely what data AuraLog collects, stores, transmits, and does not transmit.

---

## Summary

| Category | Status |
|---|---|
| Journal entries stored | ✅ On your Umbrel device at `~/umbrel/app-data/auralog/data/entries.json` |
| Journal entries in browser localStorage | ✅ As fallback if server unreachable (local dev only) |
| Journal entries sent to a cloud server | ❌ Never |
| API key stored | ✅ Server-side in `.env` only |
| API key visible to browser | ❌ Never |
| Analytics / telemetry | ❌ None |
| Accounts / registration | ❌ Not required |
| Cookies | ❌ None set |
| Third-party scripts | ❌ None loaded at runtime |
| Fonts | ✅ Loaded from Google Fonts (see below) |
| AI data processing | ✅ When you explicitly click an AI feature |

---

## Data Storage

### Where entries live

Journal entries are stored as JSON at:
```
~/umbrel/app-data/auralog/data/entries.json
```
on your Umbrel device's filesystem. This is a Docker volume mount (`./data:/data` in `docker-compose.yml`).

The storage flow:
```
Browser → POST /api/entries → nginx → proxy container → writes /data/entries.json
                                                            ↕
                               ~/umbrel/app-data/auralog/data/entries.json (host)
```

This means:
- Entries survive container restarts and rebuilds
- Entries are accessible from **any browser on your local network** — not just the one that wrote them
- Entries are **not** tied to a specific browser or device
- You can back up entries by copying the file directly

### Local dev fallback

When running locally without Docker (e.g., `npm run dev` on your laptop), the proxy may not be running. In that case, the app falls back to `localStorage` automatically. This fallback is silent — entries are saved to the browser and a warning is logged to the console.

### Settings

Theme, encryption preferences, and UI state remain in `localStorage`. These are not sensitive and don't require server persistence.

---

## Encryption

When you enable encryption in Settings, **this currently applies to the localStorage fallback path only**. Entries stored on the Umbrel server are stored in plaintext JSON, protected by:

1. **Network isolation**: The data directory is inside a Docker container, only accessible via the internal Docker network
2. **Umbrel network auth**: The Umbrel dashboard sits in front of the app; external access requires Umbrel's authentication
3. **Physical access**: The device is on your local network under your control

If you require encryption at rest for the server-side storage (e.g., the device is in a shared space), this is on the roadmap. For most personal Umbrel users, the above protections are sufficient.

Verify the storage path: `server/index.js` — constants `DATA_DIR` and `ENTRIES_FILE`.
Verify the volume mount: `docker-compose.yml` — `./data:/data` under the proxy service.

---

## AI Features and the Anthropic API

When you use an AI feature, AuraLog sends a request to Anthropic's API. Here is exactly what is sent.

### What is sent to Anthropic

- The text content of relevant journal entries
- A system prompt (readable in `src/App.jsx`)
- No personally identifying information beyond what you wrote

### What is NOT sent

- Your name, email, or any account information
- Your IP address (the request originates from the proxy container on your Umbrel node, not from your personal device's IP)

### How the API key is protected

The Anthropic API key is stored in `.env` on your Umbrel node. It is:

1. Loaded only by `server/index.js` at container startup
2. Never passed to the browser in any response
3. Never logged
4. Stripped from any headers the browser might attempt to send (see `proxy_set_header Authorization ""` in `docker/nginx.conf`)

The browser calls `/api/claude` (your local nginx). Nginx forwards to the proxy on an `internal: true` Docker network (port not exposed to host). The proxy appends the key and calls Anthropic. The browser never sees the key.

Verify: `server/index.js` (proxy), `docker/nginx.conf` (header stripping), `docker-compose.yml` (network isolation).

### Anthropic's handling of your data

When AI features are used, your journal text is sent to Anthropic. Their handling is governed by their [Privacy Policy](https://www.anthropic.com/privacy). AI features are entirely optional.

---

## Network Requests at Runtime

When running with default settings and no AI features triggered:

| Destination | Purpose | When |
|---|---|---|
| `fonts.googleapis.com` | Fetch font CSS | Page load |
| `fonts.gstatic.com` | Fetch font files | Page load, cached |
| `api.anthropic.com` | AI features | Only when you click an AI button |

**Fonts**: If this concerns you, self-host the font: download Bricolage Grotesque, place in `public/fonts/`, update the `@import` in `public/index.html`.

---

## Export and Backup

**Export from UI**: Settings → Export JSON. Downloads a copy to your device.

**Direct file backup** (Umbrel):
```bash
ssh umbrel@umbrel.local
cp ~/umbrel/app-data/auralog/data/entries.json ~/entries-backup.json
```

**Delete everything**:
```bash
rm ~/umbrel/app-data/auralog/data/entries.json
```
Or uninstall AuraLog entirely: `sudo rm -rf ~/umbrel/app-data/auralog`

---

## Open Source

Full source at `https://github.com/nillawafa/auralog`. Every claim in this document is verifiable by reading the source. Open an issue if you find a discrepancy.

---

*Updated to reflect server-side persistence replacing browser-only localStorage.*
