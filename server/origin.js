/**
 * Origin checks for the AuraLog API.
 *
 * Default (Umbrel App Store): accept a request when the Origin hostname matches
 * the hostname AuraLog was opened on (the Host header), over http or https.
 * This covers umbrel.local, LAN IPs, Tailscale MagicDNS and custom domains.
 *
 * Strict (AURALOG_STRICT_ORIGIN=true): only accept http origins on the local
 * network (.local, localhost, private IPv4 ranges, Tailscale CGNAT). Meant for
 * standalone installs that want the narrower allowlist.
 *
 * Requests without an Origin header (same-origin GETs, curl, health checks)
 * are allowed in both modes.
 */

export const STRICT_ORIGIN = /^(1|true|yes)$/i.test(process.env.AURALOG_STRICT_ORIGIN || '');

// Parse an Origin header. Returns the URL, or null if it's malformed or isn't
// a plain http(s) origin (e.g. "null", paths, credentials).
function parseOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin !== origin) return null;
    return url;
  } catch {
    return null;
  }
}

// Extract the hostname from a Host header ("umbrel.local:3850" -> "umbrel.local").
function hostnameFromHost(host) {
  if (!host) return '';
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
}

export function isLocalOrigin(origin) {
  if (!origin) return true;
  if (!origin.startsWith('http://')) return false;

  const host = origin.slice(7).split(':')[0]; // strip "http://" then port

  if (host.endsWith('.local') || host === 'local') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;

  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale
  }
  return false;
}

export function isSameHostOrigin(origin, host) {
  if (!origin) return true;
  const url = parseOrigin(origin);
  if (!url) return false;
  const expected = hostnameFromHost(host);
  return expected !== '' && url.hostname.toLowerCase() === expected.toLowerCase();
}

export function isAllowedOrigin(origin, host, strict = STRICT_ORIGIN) {
  return strict ? isLocalOrigin(origin) : isSameHostOrigin(origin, host);
}
