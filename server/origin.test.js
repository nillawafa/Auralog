import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin } from './origin.js';

const sameHost = (origin, host) => isAllowedOrigin(origin, host, false);
const strict = (origin, host) => isAllowedOrigin(origin, host, true);

test('same-host: accepts matching origins over http and https', () => {
  assert.equal(sameHost('http://umbrel.local:3850', 'umbrel.local:3850'), true);
  assert.equal(sameHost('http://192.168.1.83:3850', '192.168.1.83'), true);
  assert.equal(sameHost('https://umbrel.tail1234.ts.net', 'umbrel.tail1234.ts.net'), true);
  assert.equal(sameHost('http://umbrel:3850', 'umbrel'), true);
  assert.equal(sameHost('https://journal.example.com', 'Journal.Example.com'), true);
  assert.equal(sameHost('http://[::1]:3850', '[::1]:3850'), true);
});

test('same-host: allows requests without an Origin header', () => {
  assert.equal(sameHost('', 'umbrel.local'), true);
  assert.equal(sameHost(undefined, undefined), true);
});

test('same-host: rejects different origins', () => {
  assert.equal(sameHost('https://evil.example.com', 'umbrel.local'), false);
  assert.equal(sameHost('http://umbrel.local.evil.com', 'umbrel.local'), false);
  assert.equal(sameHost('http://192.168.1.84:3850', '192.168.1.83:3850'), false);
  assert.equal(sameHost('http://umbrel.local', ''), false);
  assert.equal(sameHost('http://umbrel.local', undefined), false);
});

test('same-host: rejects malformed origins', () => {
  assert.equal(sameHost('null', 'umbrel.local'), false);
  assert.equal(sameHost('umbrel.local', 'umbrel.local'), false);
  assert.equal(sameHost('ftp://umbrel.local', 'umbrel.local'), false);
  assert.equal(sameHost('http://umbrel.local/path', 'umbrel.local'), false);
  assert.equal(sameHost('http://user@umbrel.local', 'umbrel.local'), false);
  assert.equal(sameHost('http://', 'umbrel.local'), false);
  assert.equal(sameHost('http://umbrel.local', 'bad host/'), false);
});

test('strict: keeps the local-network allowlist', () => {
  assert.equal(strict('http://umbrel.local:3850', 'umbrel.local'), true);
  assert.equal(strict('http://192.168.1.83:3850', 'anything'), true);
  assert.equal(strict('http://100.64.0.1', 'anything'), true);
  assert.equal(strict('', 'umbrel.local'), true);
  assert.equal(strict('https://umbrel.tail1234.ts.net', 'umbrel.tail1234.ts.net'), false);
  assert.equal(strict('https://journal.example.com', 'journal.example.com'), false);
});
