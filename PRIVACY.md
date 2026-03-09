# AuraLog Privacy Model

This document explains precisely what data AuraLog collects, stores, transmits, and does not transmit. It is intended to be specific enough that a technically literate person can verify every claim by reading the source code.

---

## Summary

| Category | Status |
|---|---|
| Journal entries stored | ✅ Locally in your browser (localStorage) |
| Journal entries sent to a server | ❌ Never |
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

All journal entries, settings, and preferences are stored exclusively in your browser's **`localStorage`**. This storage:

- Is scoped to the origin (`http://umbrel.local:3850`) — no other site can read it
- Never leaves your device through AuraLog
- Is under your full control — you can export it as JSON at any time, or wipe it through your browser settings

**No database, no cloud sync, no account.**

---

## Encryption at Rest

When you enable encryption in Settings, AuraLog uses **AES-256-GCM** to encrypt your entries before writing them to localStorage.

Technical details:
- Key derivation: **PBKDF2-SHA-256** with **310,000 iterations** (OWASP 2024 recommendation)
- Each encrypt operation generates a fresh random **16-byte salt** and **12-byte IV**
- Storage format: `base64( salt[16] || iv[12] || ciphertext )`
- Uses the browser's native **Web Crypto API** (`crypto.subtle`) — no third-party crypto library
- Your password is never stored anywhere; it exists only in memory while the app is open

Without your password, the stored data is computationally infeasible to decrypt.

Verify in source: `src/App.jsx` — functions `aesEncrypt`, `aesDecrypt`, `deriveKey`.

---

## AI Features and the Anthropic API

When you use an AI feature (entry reflection, weekly digest, smart prompts, semantic search, pattern analysis), AuraLog sends a request to **Anthropic's API**. Here is exactly what is sent and what is not.

### What is sent to Anthropic

- The **text content** of relevant journal entries (the specific entries used for context are shown in the UI)
- A system prompt (readable in `src/App.jsx`)
- No personally identifying information beyond what you wrote in your journal

### What is NOT sent

- Your name, email, or any account information (you have none)
- Your IP address as seen by Anthropic is your Umbrel node's IP, not your personal device's IP, since the request originates from the proxy container
- The request is made **server-to-server** (your Umbrel node → Anthropic), not browser-to-Anthropic

### How the API key is protected

The Anthropic API key is stored in a `.env` file on your Umbrel node. It is:

1. Loaded only by the proxy server (`server/index.js`) at startup
2. Never passed to the browser in any response
3. Never logged
4. Stripped from any headers the browser might attempt to send (see `proxy_set_header Authorization ""` in `docker/nginx.conf`)

The browser communicates with `/api/claude` (your local nginx). Nginx forwards the request to the proxy container on an **internal Docker network** that is not exposed to the host. The proxy appends the API key and forwards to Anthropic. The browser never sees the key.

Verify in source: `server/index.js` (proxy logic), `docker/nginx.conf` (header stripping), `docker-compose.yml` (network isolation).

### Anthropic's handling of your data

When AI features are used, your journal text is sent to Anthropic. Their data handling is governed by their [Privacy Policy](https://www.anthropic.com/privacy) and [Usage Policies](https://www.anthropic.com/legal/usage-policy). Key points as of this writing:
- Anthropic may use API inputs to improve models unless you opt out (see their API console)
- You can request deletion of data associated with your API key through Anthropic's support

**AI features are entirely optional.** All journaling, analytics, and encryption work with no API key set and no Anthropic communication.

---

## Network Requests at Runtime

When the app is running with default settings and no AI features triggered:

| Destination | Purpose | When |
|---|---|---|
| `fonts.googleapis.com` | Fetch Bricolage Grotesque font CSS | Page load |
| `fonts.gstatic.com` | Fetch font files | Page load, cached |
| `api.anthropic.com` | AI features | Only when you click an AI button |

No other external network requests are made.

**Fonts**: Google Fonts transmits your IP to Google when loading. If this concerns you, you can self-host the font by downloading it and placing it in `public/fonts/`, then updating the CSS import in `public/index.html`. We may add a self-hosted font option in a future release.

---

## What We Cannot See

Because AuraLog has no server, no accounts, and no telemetry:

- We cannot see your journal entries
- We cannot see how often you use the app
- We cannot see your mood data
- We cannot see which features you use
- We cannot identify you in any way

There is no "we" in the operational sense. The app runs entirely on your hardware.

---

## Export and Deletion

**Export**: Settings → Export JSON. Downloads a plaintext JSON file of all your entries to your device.

**Delete everything**: In your browser, go to DevTools → Application → Local Storage → `http://umbrel.local:3850` → delete all keys. Or uninstall AuraLog and `rm -rf ~/umbrel/app-data/auralog`.

There is no server-side data to delete because there is no server-side data.

---

## Open Source

The full source code is available at `https://github.com/YOUR_USERNAME/auralog`. Every claim in this document can be verified by reading the code. If you find a discrepancy, please open an issue.

---

*Last updated: 2025. This document is versioned alongside the codebase.*
