# Data Storage

This document explains where AuraLog stores your journal entries and how it behaves in different environments.

---

## On Umbrel (production)

Entries are stored as a JSON file on your Umbrel device:

```
~/umbrel/app-data/auralog/data/entries.json
```

This file is mounted into the proxy Docker container at `/data/entries.json`. The app reads and writes this file through the API:

```
Browser
  └─ GET/POST /api/entries
       └─ nginx (port 3850)
            └─ proxy container (internal network)
                 └─ /data/entries.json  ←  your Umbrel host filesystem
```

**What this means for you:**
- Entries persist across container restarts, rebuilds, and app updates
- You can access your journal from **any browser on your local network** — phone, laptop, tablet
- Entries are not lost if you clear your browser cache
- You can back up entries with a single `cp` command

---

## Local development (npm run dev)

When running without Docker, the proxy server may not be available. The app detects this and falls back to `localStorage` automatically. A warning is printed to the browser console when this happens.

To use the full stack locally:

**Terminal 1:**
```bash
cd server
npm install
ANTHROPIC_API_KEY=sk-ant-... node index.js
# Proxy runs on http://localhost:3851
# Entries written to ./data/entries.json (relative to server/)
```

**Terminal 2:**
```bash
npm run dev
# Frontend runs on http://localhost:3850
# /api/* proxied to localhost:3851 by Vite's dev server proxy
```

To enable this proxy in local dev, add to `vite.config.js`:

```js
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3850,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3851',
    },
  },
  // ...
});
```

Without this Vite proxy config, `/api/entries` calls will fail in local dev and the app falls back to localStorage.

---

## Backup and restore

### Backup
```bash
# SSH into Umbrel
ssh umbrel@umbrel.local

# Copy entries to your home directory
cp ~/umbrel/app-data/auralog/data/entries.json ~/auralog-backup-$(date +%Y%m%d).json
```

Or use the **Export** button in Settings → downloads JSON to your device.

### Restore
```bash
# Copy a backup back
cp ~/auralog-backup-20260101.json ~/umbrel/app-data/auralog/data/entries.json

# Restart to pick up the change (optional — app reads on each GET /api/entries)
sudo docker restart auralog-proxy
```

Or use the **Import** button in Settings → merges entries without duplicates.

---

## What is NOT stored on the server

- **Settings** (theme, encryption preferences): stored in browser `localStorage`
- **API key**: stored in `.env`, never written to `entries.json`
- **Anything from localStorage**: the server has no visibility into browser storage

---

## File format

`entries.json` is a plain JSON array:

```json
[
  {
    "id": 1741234567890,
    "date": "2026-03-08T17:04:39.010Z",
    "updatedAt": "2026-03-08T18:12:00.000Z",
    "title": "Good morning",
    "content": "...",
    "mood": 4,
    "energy": 3,
    "journey": "personal",
    "tags": ["reflection"]
  }
]
```

You can read, edit, or transform this file with any JSON tool.
