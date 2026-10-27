// A mission parked on a human approval must survive a server restart and finish once approved.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dost-'));
const PORT = 3990 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
let srv;
after(() => { srv?.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

async function boot() {
  srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DOST_DB_FILE: path.join(DIR, 'db.json'), DOST_MODE: 'playbook', DOST_STEP_DELAY_MS: '0', ANTHROPIC_API_KEY: '', DOST_OPERATOR_TOKEN: '', DOST_APPROVER_TOKEN: '' }
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const stop = () => new Promise(r => { srv.once('exit', r); srv.kill('SIGTERM'); });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const state = () => fetch(`${BASE}/api/state`).then(r => r.json());
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) { const v = await fn(); if (v) return v; } throw new Error('timed out'); };

test('approval survives restart and executes after it', async () => {
  await boot();
  await post('/api/settings', { autonomy: 1, autopilot: false });
  await post('/api/simulate/settlement_failed', {});
  const sig = await until(async () => (await state()).signals.find(s => s.type === 'settlement_failed'));
  const m = await post('/api/missions', { signalId: sig.id });
  const ap = await until(async () => (await state()).approvals.find(a => a.missionId === m.id));
  await stop();

  await boot();
  const s = await state();
  assert.equal(s.approvals.find(a => a.id === ap.id)?.resumed, true, 'approval kept after restart');
  assert.equal(s.missions.find(x => x.id === m.id).status, 'waiting');
  await post(`/api/approvals/${ap.id}`, { action: 'approve' });
  const done = await until(async () => { const x = (await state()).missions.find(x => x.id === m.id); return x.status !== 'waiting' && x.status !== 'running' && x; });
  assert.equal(done.status, 'done');
  const full = await fetch(`${BASE}/api/missions/${m.id}`).then(r => r.json());
  assert.ok(full.steps.some(st => st.resumed && st.tool === ap.tool && !st.failed), 'approved tool ran after restart');
});
