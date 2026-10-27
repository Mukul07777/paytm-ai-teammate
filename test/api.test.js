// Boots the real server in memory mode with auth on, then exercises the security surface.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const OP = 'operator-token-0123456789', AP = 'approver-token-0123456789', HOOK = 'webhook-secret-0123456789';
let srv;

before(async () => {
  srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DOST_MEMORY: '1', DOST_MODE: 'playbook', DOST_STEP_DELAY_MS: '0', ANTHROPIC_API_KEY: '', DOST_OPERATOR_TOKEN: OP, DOST_APPROVER_TOKEN: AP, DOST_WEBHOOK_SECRET: HOOK }
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => srv?.kill());

const call = (p, { token, method = 'GET', body, headers = {} } = {}) => fetch(BASE + p, {
  method, body: body && JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
});

test('health check is public', async () => {
  const r = await call('/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('API rejects anonymous callers', async () => {
  for (const [p, method] of [['/api/state', 'GET'], ['/api/approvals/A-X', 'POST'], ['/api/reset', 'POST'], ['/api/audit.csv', 'GET']])
    assert.equal((await call(p, { method, body: method === 'GET' ? undefined : {} })).status, 401, p);
});

test('operator can read but cannot approve, edit policy or reset', async () => {
  assert.equal((await call('/api/state', { token: OP })).status, 200);
  assert.equal((await call('/api/approvals/A-X', { token: OP, method: 'POST', body: { action: 'approve' } })).status, 403);
  assert.equal((await call('/api/policies/refunds', { token: OP, method: 'PUT', body: { raw: '---\nx: 1\n---' } })).status, 403);
  assert.equal((await call('/api/reset', { token: OP, method: 'POST', body: {} })).status, 403);
});

test('wrong token is rejected; login sets an HttpOnly session cookie', async () => {
  assert.equal((await call('/api/state', { token: 'nope' })).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { token: 'nope' } })).status, 401);
  const r = await call('/api/login', { method: 'POST', body: { token: AP } });
  assert.equal((await r.json()).role, 'approver');
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const me = await call('/api/me', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await me.json()).role, 'approver');
});

test('tampered session cookie is rejected', async () => {
  const r = await call('/api/login', { method: 'POST', body: { token: OP } });
  const forged = r.headers.get('set-cookie').split(';')[0].replace('operator.', 'approver.');
  assert.equal((await call('/api/me', { headers: { Cookie: forged } })).status, 401);
});

test('security headers are set', async () => {
  const r = await call('/healthz');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.ok(r.headers.get('content-security-policy'));
  assert.equal(r.headers.get('x-powered-by'), null);
});

const hook = (body, secret = HOOK, ts) => {
  const raw = JSON.stringify(body);
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return fetch(`${BASE}/api/webhooks/events`, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-Dost-Signature': sig, ...(ts ? { 'X-Dost-Timestamp': String(ts) } : {}) } });
};

test('webhooks: signature, replay window, validation and idempotency', async () => {
  const state = await (await call('/api/merchants', { token: OP })).json();
  const merchant_id = state[0].id, ev = { type: 'settlement.failed', merchant_id, amount: 1200, settlement_id: 'STL-TEST-1' };
  assert.equal((await hook(ev, 'wrong-secret')).status, 401);
  assert.equal((await hook(ev, HOOK, Math.floor(Date.now() / 1000) - 3600)).status, 401);
  assert.equal((await hook({ ...ev, amount: -5 })).status, 422);
  assert.equal((await hook(ev)).status, 202);
  const dup = await hook(ev);
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).duplicate, true);
});

test('unknown approval action is rejected', async () => {
  const r = await call('/api/approvals/A-X', { token: AP, method: 'POST', body: { action: 'yolo' } });
  assert.equal(r.status, 400);
});

test('unknown API routes return JSON 404', async () => {
  const r = await call('/api/nope', { token: OP });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'Not found');
});
