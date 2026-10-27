import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { load, getDb, reset, save, flush, ROOT } from './src/store.js';
import { bus, changed, feed } from './src/bus.js';
import { startSimulator, inject, INCIDENTS } from './src/simulator.js';
import { detectSignals } from './src/radar.js';
import { startMission, decide, retryMission, autopilotTick } from './src/agent.js';
import { policies, savePolicy } from './src/policy.js';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { toolCatalog } from './src/tools.js';
import { hasLLM, MODEL } from './src/llm.js';
import { baseline, growth, kycDays, sum, DAY } from './src/calc.js';
import { AUTH_ON, requireRole, roleForToken, issueCookie, clearCookie } from './src/auth.js';
import { securityHeaders, rateLimit, requestLog } from './src/http.js';

const PROD = process.env.NODE_ENV === 'production';
// Refuse to boot in production with demo-grade security.
if (PROD) {
  const missing = ['DOST_OPERATOR_TOKEN', 'DOST_APPROVER_TOKEN', 'DOST_WEBHOOK_SECRET', 'DOST_SESSION_SECRET'].filter(k => !process.env[k] || process.env[k].length < 16);
  if (missing.length) { console.error(`Refusing to start: set ${missing.join(', ')} (16+ chars each) in production.`); process.exit(1); }
}

load();
startSimulator();

const autopilot = setInterval(() => { try { autopilotTick(); } catch (e) { console.error('autopilot', e); } }, 4000);

const app = express();
app.disable('x-powered-by');
if (process.env.DOST_TRUST_PROXY) app.set('trust proxy', process.env.DOST_TRUST_PROXY);
app.use(securityHeaders);
app.use(requestLog);
// Keep the raw body so webhook signatures can be verified byte-for-byte.
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.get('/healthz', (req, res) => res.json({ ok: true, mode: hasLLM ? 'llm' : 'playbook', uptimeS: Math.round(process.uptime()) }));

app.use('/api/', rateLimit({ max: Number(process.env.DOST_RATE_LIMIT) || 300 }));
app.post('/api/login', rateLimit({ max: 10 }), (req, res) => {
  const role = roleForToken(String(req.body?.token || ''));
  if (!role) return res.status(401).json({ error: 'Invalid token' });
  issueCookie(res, role); res.json({ role });
});
app.post('/api/logout', (req, res) => { clearCookie(res); res.json({ ok: true }); });
app.get('/api/me', requireRole('viewer'), (req, res) => res.json({ role: req.role, auth: AUTH_ON }));

const viewer = requireRole('viewer'), operator = requireRole('operator'), approver = requireRole('approver');

const GUARDRAILS = [
  ['Lending decisions', 'Always human-approved'],
  ['Money moves ≥ ₹2,00,000', 'Always human-approved'],
  ['Digital-twin simulation', 'Before every money / asset action'],
  ['Duplicate-payout check', 'Mandatory before settlement retry'],
  ['Credit consent (RBI digital lending)', 'Explicit KFS consent required'],
  ['Audit trail', 'Every step logged']
];

function metrics() {
  const db = getDb(), ms = db.missions;
  const done = ms.filter(m => m.status === 'done'), handoffs = ms.filter(m => m.status === 'handoff');
  const finished = done.length + handoffs.length, solo = done.filter(m => !m.approvalsNeeded).length;
  return {
    missions: ms.length, resolved: done.length, handoffs: handoffs.length, solo,
    autonomyRate: finished ? Math.round(solo / finished * 100) : null,
    minutesSaved: sum(ms.map(m => m.minutesSaved)), revenue: sum(ms.map(m => m.revenue)), protected: sum(ms.map(m => m.protected)),
    prevented: done.filter(m => m.proactive).length,
    live: ms.filter(m => m.status === 'running' || m.status === 'waiting').length,
    merchants: db.merchants.length,
    devicesOnline: db.devices.filter(d => d.status === 'online').length, devices: db.devices.length,
    gmvToday: sum(db.merchants.map(m => m.todayGmv || 0))
  };
}

const summary = m => ({
  id: m.id, title: m.title, status: m.status, mode: m.mode, merchantName: m.merchantName, city: m.city, signalType: m.signalType,
  steps: m.steps.length, outcome: m.outcome, createdAt: m.createdAt, approvalsNeeded: m.approvalsNeeded,
  agent: [...m.steps].reverse().find(s => s.agent && s.agent !== 'human')?.agent || null
});

app.get('/api/state', viewer, (req, res) => {
  const db = getDb();
  res.json({
    mode: hasLLM ? 'llm' : 'playbook', model: hasLLM ? MODEL : null, settings: db.settings,
    metrics: metrics(), signals: detectSignals(), missions: db.missions.slice(0, 50).map(summary),
    approvals: db.approvals, rules: db.rules, team: db.team.map(t => ({ ...t, openHandoffs: db.handoffs.filter(h => h.to === t.id && h.status === 'open').length })),
    handoffs: db.handoffs.slice(0, 20), feed: db.feed.slice(0, 40), tools: toolCatalog, guardrails: GUARDRAILS, incidents: INCIDENTS, lastEval: (db.evals || [])[0] ? { passed: db.evals[0].passed, scenarios: db.evals[0].scenarios, passRate: db.evals[0].passRate, at: db.evals[0].at } : null
  });
});

app.get('/api/missions/:id', viewer, (req, res) => {
  const m = getDb().missions.find(x => x.id === req.params.id);
  m ? res.json(m) : res.status(404).json({ error: 'Mission not found' });
});

app.post('/api/missions', operator, (req, res) => {
  try { res.json(summary(startMission(req.body || {}))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/approvals/:id', approver, (req, res) => {
  try { decide(req.params.id, req.body?.action, req.body?.note, req.role === 'approver' && AUTH_ON ? 'Approver' : 'You'); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/handoffs/:id/close', operator, (req, res) => {
  const h = getDb().handoffs.find(x => x.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'Hand-off not found' });
  h.status = 'closed'; save(); changed(); res.json({ ok: true });
});

app.post('/api/settings', approver, (req, res) => {
  const s = getDb().settings, b = req.body || {};
  if (b.autonomy !== undefined) {
    const a = Number(b.autonomy);
    if (![1, 2, 3].includes(a)) return res.status(400).json({ error: 'autonomy must be 1, 2 or 3' });
    s.autonomy = a;
  }
  if (b.autopilot !== undefined) s.autopilot = !!b.autopilot;
  save(); changed(); res.json(s);
});

app.post('/api/missions/:id/retry', operator, (req, res) => {
  try { res.json(summary(retryMission(req.params.id))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/policies', operator, (req, res) => res.json(Object.values(policies()).map(({ name, title, params, raw }) => ({ name, title, params, raw }))));
app.put('/api/policies/:name', approver, (req, res) => {
  try {
    const p = savePolicy(req.params.name, String(req.body?.raw || ''));
    console.log(JSON.stringify({ t: new Date().toISOString(), audit: 'policy.updated', policy: p.name, params: p.params, role: req.role }));
    feed('compliance', `Policy <b>${p.title}</b> updated — guardrails now use ${JSON.stringify(p.params)}`);
    res.json({ ok: true, params: p.params });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Evals run in a child process against an isolated in-memory world.
let evalRun = null;
app.post('/api/evals/run', operator, (req, res) => {
  if (evalRun) return res.status(409).json({ error: 'An eval run is already in progress' });
  evalRun = new Promise(resolve => {
    let out = '';
    const p = spawn(process.execPath, [path.join(ROOT, 'src', 'evals.js'), '--json'], { cwd: ROOT, env: { ...process.env, DOST_MODE: req.body?.mode === 'llm' ? '' : 'playbook' } });
    p.stdout.on('data', d => out += d);
    p.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ error: 'Eval run failed' }); } });
  });
  changed();
  evalRun.then(r => {
    evalRun = null;
    if (!r.error) { const db = getDb(); db.evals = [r, ...(db.evals || [])].slice(0, 10); feed('qa', `Eval suite: <b>${r.passed}/${r.scenarios}</b> scenarios passed (${r.checksPassed}/${r.checksTotal} checks)`); }
    save(); changed(); res.json(r);
  });
});
app.get('/api/evals', operator, (req, res) => res.json({ running: !!evalRun, runs: getDb().evals || [] }));

// Signed inbound webhooks: real systems push events; Dost turns them into world state.
app.post('/api/webhooks/events', (req, res) => {
  const secret = process.env.DOST_WEBHOOK_SECRET || 'dev-secret';
  // Reject stale or replayed deliveries when the sender stamps them.
  const ts = Number(req.get('X-Dost-Timestamp') || 0);
  if (ts && Math.abs(Date.now() - ts * 1000) > 5 * 60000) return res.status(401).json({ error: 'Stale webhook' });
  const sig = String(req.get('X-Dost-Signature') || '');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(401).json({ error: 'Invalid signature' });
  const db = getDb(), e = req.body || {}, now = Date.now();
  const m = db.merchants.find(x => x.id === e.merchant_id);
  if (!m) return res.status(422).json({ error: 'Unknown merchant_id' });
  const amount = Number(e.amount);
  if (e.type !== 'device.offline' && !(amount > 0 && amount < 1e9)) return res.status(422).json({ error: 'amount must be a positive number' });
  const seen = (db.webhookIds ||= []), key = e.settlement_id || e.ticket_id;
  if (key && seen.includes(key)) return res.status(200).json({ accepted: true, duplicate: true });
  if (key) { seen.unshift(key); seen.length = Math.min(seen.length, 500); }
  if (e.type === 'device.offline') {
    const d = db.devices.find(x => x.id === m.deviceId);
    Object.assign(d, { status: 'offline', fault: e.fault || 'sim', lastHeartbeat: now - (e.offline_hours || 2) * 36e5 });
  } else if (e.type === 'settlement.failed') {
    db.settlements.push({ id: e.settlement_id || `STL-${now}`, merchantId: m.id, amount: Number(e.amount), date: now, status: 'FAILED', retries: 0, utr: null, reason: e.reason || 'Bank timeout' });
  } else if (e.type === 'ticket.created') {
    db.tickets.push({ id: e.ticket_id || `TKT-${now}`, kind: 'duplicate_debit', merchantId: m.id, customer: e.customer || 'Customer', channel: e.channel || 'call', text: String(e.text || ''), amount: Number(e.amount), sentiment: Number(e.sentiment ?? -0.5), txnId: e.txn_id || 'TXN-WEBHOOK', status: 'open', createdAt: now });
  } else return res.status(422).json({ error: `Unsupported event type ${e.type}` });
  feed('triage', `Webhook received: <b>${e.type}</b> for ${m.name}`);
  save(); changed(); res.status(202).json({ accepted: true });
});

app.post('/api/demo-requests', rateLimit({ max: 5 }), (req, res) => {
  const { name, email, company, team, message } = req.body || {};
  if (!name || !/^\S+@\S+\.\S+$/.test(String(email || ''))) return res.status(400).json({ error: 'Please add your name and a valid email.' });
  const db = getDb();
  (db.demoRequests ||= []).unshift({ name: String(name).slice(0, 120), email: String(email).slice(0, 200), company: String(company || '').slice(0, 120), team: String(team || ''), message: String(message || '').slice(0, 2000), at: Date.now() });
  save(); res.status(201).json({ ok: true });
});

app.get('/api/audit.csv', approver, (req, res) => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['mission_id', 'mission', 'merchant', 'time', 'agent', 'kind', 'tool', 'input', 'output', 'text'].join(',')];
  for (const m of getDb().missions) for (const s of m.steps)
    rows.push([m.id, m.title, m.merchantName, new Date(s.at).toISOString(), s.agent, s.k, s.tool, s.input && JSON.stringify(s.input), s.output && JSON.stringify(s.output), s.text].map(q).join(','));
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="dost-audit.csv"' }).send(rows.join('\n'));
});

app.post('/api/simulate/:type', operator, (req, res) => {
  if (!INCIDENTS.includes(req.params.type)) return res.status(400).json({ error: 'Unknown incident type' });
  const r = inject(req.params.type); save(); changed(); res.json(r || { skipped: true });
});

app.get('/api/merchants', operator, (req, res) => {
  const db = getDb(), q = String(req.query.q || '').toLowerCase();
  res.json(db.merchants.filter(m => !q || [m.id, m.name, m.city, m.language].some(v => v.toLowerCase().includes(q))).map(m => {
    const d = db.devices.find(x => x.id === m.deviceId);
    return {
      id: m.id, name: m.name, owner: m.owner, city: m.city, language: m.language, category: m.category, tenureMonths: m.tenureMonths,
      avgDaily: baseline(m), growthPct: Math.round(growth(m) * 100), trend: m.gmv30, todayGmv: m.todayGmv || 0,
      device: { id: d.id, model: d.model, status: d.replacementEta ? 'replacing' : d.status },
      kycDays: kycDays(m), activeLoan: m.activeLoan, openTickets: db.tickets.filter(t => t.merchantId === m.id && t.status === 'open').length
    };
  }));
});

app.get('/api/standup', operator, (req, res) => {
  const db = getDb(), since = Date.now() - DAY, ms = db.missions.filter(m => m.createdAt > since);
  const langs = {};
  for (const m of ms) for (const c of m.calls) if (c.language) langs[c.language] = (langs[c.language] || 0) + 1;
  res.json({
    generatedAt: Date.now(), metrics: metrics(),
    done: ms.filter(m => m.status === 'done').map(m => ({ title: m.title, merchant: m.merchantName, outcome: m.outcome })),
    handoffs: db.handoffs.filter(h => h.at > since).map(h => ({ to: h.toName, summary: h.summary, recommended: h.recommended_action, status: h.status })),
    learned: db.rules.filter(r => r.createdAt > since), languages: langs,
    focus: detectSignals().slice(0, 6).map(s => ({ title: s.title, detail: s.detail, severity: s.severity })),
    waiting: db.approvals.map(a => ({ label: a.label, merchant: a.merchant, amount: a.amount }))
  });
});

app.post('/api/reset', approver, (req, res) => {
  if (getDb().missions.some(m => m.status === 'running' || m.status === 'waiting')) return res.status(409).json({ error: 'Missions still running' });
  reset(); for (const t of INCIDENTS) inject(t); getDb().meta.bootstrapped = true; save(); changed(); res.json({ ok: true });
});

app.get('/api/events', viewer, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  const onChange = () => res.write('data: {"type":"update"}\n\n');
  const onToast = t => res.write(`data: ${JSON.stringify({ type: 'toast', ...t })}\n\n`);
  let timer = null;
  const throttled = () => { if (!timer) timer = setTimeout(() => { timer = null; onChange(); }, 400); };
  bus.on('change', throttled); bus.on('toast', onToast);
  req.on('close', () => { bus.off('change', throttled); bus.off('toast', onToast); clearTimeout(timer); });
});

app.use('/api/', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), error: err.message, path: req.path }));
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Internal error' });
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => console.log(`Dost running → http://localhost:${PORT}  (mode: ${hasLLM ? `Claude ${MODEL}` : 'playbook'}, auth: ${AUTH_ON ? 'on' : 'OFF — local demo only'})`));

// Graceful shutdown: stop taking work, persist state, then exit.
function shutdown(sig) {
  console.log(`${sig} received — shutting down`);
  clearInterval(autopilot);
  server.close();
  server.closeAllConnections?.();
  try { flush(); } catch (e) { console.error('flush failed', e); }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => console.error('unhandledRejection', e));
