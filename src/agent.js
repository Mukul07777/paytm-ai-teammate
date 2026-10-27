// Mission engine: plan → act (through guardrails) → verify. LLM-driven when a key is set.
import { getDb, save, flush, uid } from './store.js';
import { changed, feed, toast } from './bus.js';
import { TOOL_MAP, apiTools } from './tools.js';
import { detectSignals } from './radar.js';
import { runPlaybook } from './playbooks.js';
import { hasLLM, MODEL, createMessage, textOf } from './llm.js';
import { inr, RISK } from './calc.js';
import { policyPrompt } from './policy.js';

// Playbooks execute instantly; pace them so humans can follow the mission live.
const STEP_DELAY = Number(process.env.DOST_STEP_DELAY_MS ?? 1100);
const pace = () => new Promise(r => setTimeout(r, STEP_DELAY));
const STEP_KIND ={ read: 'tool', action: 'action', comms: 'comms', twin: 'twin', handoff: 'handoff' };
const pending = new Map();
const runs = new Map();
const TOOL_TIMEOUT_MS = 20000;

export const missionSettled = id => runs.get(id) || Promise.resolve();

// Read tools are idempotent, so they get one retry; actions never auto-retry (no double execution).
async function withTimeout(fn, label) {
  let t;
  try { return await Promise.race([fn(), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS); })]); }
  finally { clearTimeout(t); }
}

function step(m, s) { s.at = Date.now(); m.steps.push(s); save(); changed(); return s; }

function attach(m, sig) {
  const db = getDb(), mer = sig.merchantId && db.merchants.find(x => x.id === sig.merchantId);
  Object.assign(m, {
    signalId: sig.id, signalType: sig.type, proactive: true,
    merchantId: mer?.id || null, merchantName: mer?.name || (sig.merchantIds ? `${sig.merchantIds.length} merchants` : null), city: mer?.city || null
  });
}

export function startMission({ goal, signalId }) {
  const db = getDb();
  const sig = signalId ? detectSignals().find(s => s.id === signalId) : null;
  if (signalId && !sig) throw new Error('That signal is no longer active');
  if (!goal && !sig) throw new Error('Provide a goal or a signalId');
  const m = {
    id: uid('M'), title: sig?.title || goal, goal: sig?.goal || goal, mode: hasLLM ? 'llm' : 'playbook',
    status: 'running', steps: [], calls: [], twin: null, minutesSaved: 0, revenue: 0, protected: 0, approvalsNeeded: 0,
    proactive: false, signalId: null, signalType: null, merchantId: null, merchantName: null, city: null, createdAt: Date.now()
  };
  if (sig) attach(m, sig);
  db.missions.unshift(m);
  feed('triage', `Started mission <b>${m.title}</b>${m.merchantName ? ' · ' + m.merchantName : ''}`);
  toast('🎯', 'Mission deployed', m.title);
  runs.set(m.id, run(m, sig).finally(() => runs.delete(m.id)));
  return m;
}

export function retryMission(id) {
  const old = getDb().missions.find(x => x.id === id);
  if (!old) throw new Error('Mission not found');
  if (['running', 'waiting'].includes(old.status)) throw new Error('Mission is still running');
  const live = old.signalId && detectSignals().find(s => s.id === old.signalId);
  return startMission(live ? { signalId: live.id } : { goal: old.goal });
}

// Autopilot: Dost picks up urgent work by itself, within a concurrency budget.
const AUTOPILOT_SEVERITIES = new Set(['critical', 'high', 'regulatory']);
export function autopilotTick() {
  const db = getDb();
  if (!db.settings.autopilot) return;
  const live = db.missions.filter(m => m.status === 'running' || m.status === 'waiting').length;
  if (live >= (db.settings.maxConcurrent || 3)) return;
  const sig = detectSignals().find(s => AUTOPILOT_SEVERITIES.has(s.severity));
  if (!sig) return;
  feed('triage', `Autopilot picked up <b>${sig.title}</b> without being asked`);
  startMission({ signalId: sig.id });
}

async function run(m, sig) {
  try {
    if (hasLLM) await runLLM(m, sig);
    else await runPlaybook(m, sig, {
      call: async (name, input) => { await pace(); return execTool(m, name, input); },
      think: async (agent, text) => { await pace(); step(m, { k: 'think', agent, text }); },
      attach: s => attach(m, s)
    });
    const acted = m.steps.filter(s => (s.k === 'action' || s.k === 'comms') && !s.failed).length;
    const failed = m.steps.filter(s => s.failed).length;
    step(m, { k: 'verify', agent: 'qa', text: `QA audit: ${acted} actions executed, ${failed} failed, ${m.approvalsNeeded} human approval${m.approvalsNeeded === 1 ? '' : 's'}. Every step is in the audit trail.` });
    m.status = m.handedOff ? 'handoff' : acted ? 'done' : 'noop';
    feed(m.handedOff ? 'triage' : 'qa', `${m.handedOff ? 'Handed off' : 'Completed'} <b>${m.title}</b> — ${m.outcome || 'done'}`);
    toast(m.handedOff ? '🤝' : '✅', m.handedOff ? 'Warm hand-off' : 'Mission accomplished', m.outcome || m.title);
  } catch (e) {
    step(m, { k: 'error', agent: 'qa', text: e.message });
    m.status = 'failed';
  }
  m.finishedAt = Date.now();
  save(); changed();
}

export async function execTool(m, name, input) {
  const tool = TOOL_MAP[name];
  if (!tool) return { error: `Unknown tool ${name}` };
  let risk = 0;
  try { risk = typeof tool.risk === 'function' ? tool.risk(input) : (tool.risk || 0); }
  catch (e) { return { error: e.message }; }
  if (risk > 0) {
    const d = await gate(m, tool, input, risk);
    if (!d.approved) return { error: 'REJECTED_BY_HUMAN', note: d.note || 'A human teammate declined this action. Do not retry it.' };
  }
  const s = step(m, { k: STEP_KIND[tool.kind], agent: tool.agent, tool: name, label: tool.label || name, input, pending: true });
  try {
    let out;
    try { out = await withTimeout(() => tool.run(input, { mission: m }), name); }
    catch (e) {
      if (tool.kind !== 'read' || /not found/i.test(e.message)) throw e;
      s.retried = true;
      out = await withTimeout(() => tool.run(input, { mission: m }), name);
    }
    s.output = out;
    m.minutesSaved += typeof tool.minutes === 'function' ? tool.minutes(input) : (tool.minutes || 0);
    if (tool.kind === 'twin') m.twin = out;
    return out;
  } catch (e) {
    s.output = { error: e.message }; s.failed = true;
    return { error: e.message };
  } finally {
    s.pending = false; save(); changed();
  }
}

async function gate(m, tool, input, risk) {
  const db = getDb();
  const amount = tool.amount ? tool.amount(input) : null;
  const label = tool.label || tool.name;
  const rule = risk < 3 && db.rules.find(r => r.tool === tool.name && (r.maxAmount == null || (amount ?? 0) <= r.maxAmount));
  if (rule) {
    rule.uses++;
    step(m, { k: 'auto', agent: 'compliance', learned: true, text: `Learned rule ${rule.id} applied — “${rule.text}”. No human interruption needed.` });
    return { approved: true };
  }
  if (risk < db.settings.autonomy && risk < 3) {
    step(m, { k: 'auto', agent: 'compliance', text: `${RISK[risk]}-risk “${label}” is within autonomy L${db.settings.autonomy} — executing.` });
    return { approved: true };
  }
  const ap = { id: uid('A'), missionId: m.id, tool: tool.name, label, input, risk, amount, merchant: m.merchantName, preview: m.twin, teachable: risk < 3, createdAt: Date.now() };
  db.approvals.unshift(ap);
  m.status = 'waiting'; m.approvalsNeeded++;
  step(m, { k: 'wait', agent: 'compliance', approvalId: ap.id, text: `${RISK[risk]}-risk “${label}”${amount != null ? ` (${inr(amount)})` : ''} needs a human decision${risk === 3 ? ' — always human-gated by policy' : ''}.` });
  flush(); // durable before we wait: a crash now must not lose the pending decision
  toast('✋', 'Dost needs your approval', `${label}${amount != null ? ' · ' + inr(amount) : ''}`);
  const res = await new Promise(r => pending.set(ap.id, r));
  m.status = 'running'; save(); changed();
  return res;
}

const ACTIONS = new Set(['approve', 'teach', 'reject']);

export function decide(id, action, note, by = 'You') {
  if (!ACTIONS.has(action)) throw new Error('action must be approve, teach or reject');
  const db = getDb(), i = db.approvals.findIndex(a => a.id === id);
  if (i < 0) throw new Error('Approval not found');
  const ap = db.approvals.splice(i, 1)[0], m = db.missions.find(x => x.id === ap.missionId);
  note = note == null ? note : String(note).slice(0, 500);
  if (action === 'teach' && ap.teachable) {
    // A rule never auto-approves more than the human actually saw and approved.
    const max = ap.amount ?? null;
    const rule = { id: `R-${String(db.rules.length + 1).padStart(2, '0')}`, tool: ap.tool, maxAmount: max, text: `Auto-approve “${ap.label}”${max != null ? ` up to ${inr(max)}` : ''}`, by, createdAt: Date.now(), uses: 0, fromMission: m.id };
    db.rules.unshift(rule);
    feed('qa', `Learned rule ${rule.id}: ${rule.text}`);
    toast('🧠', 'Dost learned a new rule', rule.text);
  }
  const approved = action !== 'reject';
  step(m, { k: approved ? 'approved' : 'rejected', agent: 'human', by, text: approved ? `Approved by ${by}${action === 'teach' ? ' and taught as a reusable rule' : ''}.` : `Rejected by ${by}${note ? ': ' + note : ''}.` });
  flush();
  const resolve = pending.get(id);
  pending.delete(id);
  if (resolve) return resolve({ approved, note });
  // The server restarted while this approval was waiting: finish the approved action now.
  runs.set(m.id, resumeAfterRestart(m, ap, approved).finally(() => runs.delete(m.id)));
}

async function resumeAfterRestart(m, ap, approved) {
  const tool = TOOL_MAP[ap.tool];
  m.status = 'running'; changed();
  if (approved && tool) {
    const s = step(m, { k: STEP_KIND[tool.kind], agent: tool.agent, tool: ap.tool, label: ap.label, input: ap.input, pending: true, resumed: true });
    try { s.output = await withTimeout(() => tool.run(ap.input, { mission: m }), ap.tool); }
    catch (e) { s.output = { error: e.message }; s.failed = true; }
    s.pending = false;
  }
  step(m, { k: 'verify', agent: 'qa', text: `Resumed after a restart: ${approved ? 'the approved action was executed' : 'nothing was executed'}. Remaining follow-ups need a retry.` });
  m.status = approved && !m.steps.at(-2)?.failed ? 'done' : 'interrupted';
  m.finishedAt = Date.now(); save(); changed();
}

const SYSTEM = `You are Dost, an autonomous AI teammate on Paytm's merchant sales & support team. You own outcomes end-to-end, not conversations.

How you work:
- Investigate with read tools before acting. Before any money movement, asset dispatch or loan submission, call simulate_action and check its result.
- Prefer the cheapest effective fix first (e.g. remote recovery before replacing hardware).
- Speak to merchants in their preferred language from their profile (romanised Hinglish for Hindi-belt languages). Keep messages short and warm.
- Hand off to a human (handoff_to_human) when a customer is highly distressed, asks for a person, or the fix is outside your authority. Give a crisp 3-4 bullet brief.
- Guardrails are enforced by the system: some actions pause for human approval. If a tool returns REJECTED_BY_HUMAN, do not retry it — adapt.
- Lending: only pitch if score_credit_eligibility says eligible, and only submit after explicit consent via request_consent.
- Before each tool call, write one short sentence of reasoning.
- When finished, reply with a final line starting "OUTCOME:" summarising the measurable result in under 15 words.`;

async function runLLM(m, sig) {
  const brief = sig
    ? `Signal detected by the Proactive Radar:\n${JSON.stringify({ id: sig.id, type: sig.type, title: sig.title, detail: sig.detail, merchantId: sig.merchantId, ticketId: sig.ticketId, settlementId: sig.settlementId, merchantIds: sig.merchantIds })}\n\nGoal: ${sig.goal}`
    : `Goal from a teammate: ${m.goal}\nUse list_signals / find_merchants to locate the relevant work.`;
  const messages = [{ role: 'user', content: brief }];

  for (let turn = 0; turn < 25; turn++) {
    const resp = await createMessage({ model: MODEL, max_tokens: 16000, system: `${SYSTEM}

# Standard operating procedures (binding)
${policyPrompt()}`, tools: apiTools, messages, output_config: { effort: 'medium' } });
    if (resp.stop_reason === 'refusal') { step(m, { k: 'error', agent: 'qa', text: 'Model declined this request.' }); break; }
    const text = textOf(resp);
    if (text) {
      const o = /OUTCOME:\s*(.+)/i.exec(text);
      if (o) m.outcome = o[1].trim();
      const reasoning = text.replace(/OUTCOME:.*$/is, '').trim();
      if (reasoning) step(m, { k: 'think', agent: guessAgent(resp), text: reasoning });
    }
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason === 'pause_turn') continue;
    if (resp.stop_reason !== 'tool_use') break;

    const results = [];
    for (const tu of resp.content.filter(b => b.type === 'tool_use')) {
      const out = await execTool(m, tu.name, tu.input);
      if (!m.merchantId && tu.input?.merchant_id) {
        const mer = getDb().merchants.find(x => x.id === tu.input.merchant_id);
        if (mer) Object.assign(m, { merchantId: mer.id, merchantName: mer.name, city: mer.city });
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out), is_error: !!out?.error });
    }
    messages.push({ role: 'user', content: results });
  }
}

const guessAgent = resp => TOOL_MAP[resp.content.find(b => b.type === 'tool_use')?.name]?.agent || 'triage';
