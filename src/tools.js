// Tool registry: every action Dost can take. Each tool reads or mutates the live store.
// risk: 0 = no gate, 1 = low, 2 = medium, 3 = high (always human-gated).
import { getDb, uid } from './store.js';
import { baseline, growth, kycDays, inr, avg, sum, DAY, HOUR } from './calc.js';
import { detectSignals } from './radar.js';
import { calleeReply } from './responder.js';
import { ri } from './seed.js';
import { P } from './policy.js';

const db = () => getDb();
const str = { type: 'string' }, num = { type: 'number' };
const find = (list, id, what) => { const x = db()[list].find(v => v.id === id); if (!x) throw new Error(`${what} ${id} not found`); return x; };
const M = id => find('merchants', id, 'Merchant');
const S = id => find('settlements', id, 'Settlement');
const T = id => find('tickets', id, 'Ticket');
const device = m => db().devices.find(d => d.id === m.deviceId);
const offlineHours = d => (d.status === 'offline' ? +((Date.now() - d.lastHeartbeat) / HOUR).toFixed(1) : 0);

function creditScore(m) {
  const g = growth(m), open = db().tickets.filter(t => t.merchantId === m.id && t.status === 'open').length;
  const score = Math.max(0, Math.min(0.99, 0.55 + g * 0.9 + Math.min(m.tenureMonths, 60) / 60 * 0.15 - open * 0.15 - (m.activeLoan ? 0.4 : 0)));
  const limit = Math.min(500000, Math.round(avg(m.gmv30) * 30 * 0.3 / 10000) * 10000);
  const emi = Math.round(limit * 1.14 / 270);
  return { score: +score.toFixed(2), limit, emi, emiPct: +(emi / baseline(m) * 100).toFixed(1), open };
}

export const TOOLS = [
  {
    name: 'list_signals', kind: 'read', agent: 'triage',
    description: 'List live operational signals (incidents and opportunities) detected across the merchant base.',
    props: {}, required: [],
    run: () => detectSignals().map(({ id, type, severity, title, detail, merchantId, ticketId, settlementId }) => ({ id, type, severity, title, detail, merchantId, ticketId, settlementId }))
  },
  {
    name: 'find_merchants', kind: 'read', agent: 'triage',
    description: 'Search merchants by name, city or merchant ID.',
    props: { query: str }, required: ['query'],
    run: ({ query }) => {
      const q = query.toLowerCase();
      return db().merchants.filter(m => [m.id, m.name, m.city].some(v => v.toLowerCase().includes(q))).slice(0, 8)
        .map(m => ({ id: m.id, name: m.name, city: m.city, language: m.language }));
    }
  },
  {
    name: 'get_merchant_profile', kind: 'read', agent: 'triage',
    description: 'Full merchant profile: language, tenure, average daily GMV, growth, device status, KYC, loans and open tickets.',
    props: { merchant_id: str }, required: ['merchant_id'],
    run: ({ merchant_id }) => {
      const m = M(merchant_id), d = device(m);
      return {
        id: m.id, name: m.name, owner: m.owner, city: m.city, language: m.language, category: m.category,
        tenure_months: m.tenureMonths, avg_daily_gmv: baseline(m), gmv_growth_14d_pct: Math.round(growth(m) * 100),
        device: { id: d.id, model: d.model, status: d.status, offline_hours: offlineHours(d) },
        kyc_days_left: kycDays(m), active_loan: m.activeLoan, fallback_alerts: m.fallbackAlerts,
        open_tickets: db().tickets.filter(t => t.merchantId === m.id && t.status === 'open').map(t => ({ id: t.id, kind: t.kind }))
      };
    }
  },
  {
    name: 'get_device_health', kind: 'read', agent: 'resolver',
    description: "Telemetry for the merchant's payment device: heartbeat, SIM signal, battery, firmware.",
    props: { merchant_id: str }, required: ['merchant_id'],
    run: ({ merchant_id }) => {
      const d = device(M(merchant_id));
      return {
        device_id: d.id, model: d.model, status: d.status, last_heartbeat_hours_ago: offlineHours(d),
        sim_signal: d.fault === 'sim' ? 'none' : 'good', battery: d.fault === 'power' ? '0% (not charging)' : 'ok',
        firmware: d.fault === 'firmware' ? 'crash loop detected' : 'healthy', replacement_in_progress: !!d.replacementEta
      };
    }
  },
  {
    name: 'remote_reboot_device', kind: 'action', agent: 'resolver', label: 'Remote device recovery', risk: 1, minutes: 4,
    description: 'Push an over-the-air reboot / firmware recovery. Only fixes firmware faults; cannot fix SIM or power failures.',
    props: { device_id: str }, required: ['device_id'],
    run: ({ device_id }) => {
      const d = find('devices', device_id, 'Device');
      if (d.fault === 'firmware') { Object.assign(d, { fault: null, status: 'online', lastHeartbeat: Date.now() }); return { recovered: true, detail: 'Device rebooted and re-registered on the network' }; }
      return { recovered: false, detail: d.fault === 'sim' ? 'No ACK — device has no network connectivity' : 'No ACK — device appears to be powered off' };
    }
  },
  {
    name: 'enable_fallback_alerts', kind: 'action', agent: 'resolver', label: 'Enable phone payment alerts', risk: 1, minutes: 3,
    description: "Route payment voice/SMS alerts to the merchant's phone while their device is down.",
    props: { merchant_id: str }, required: ['merchant_id'],
    run: ({ merchant_id }) => { const m = M(merchant_id); m.fallbackAlerts = true; return { enabled: true, phone: m.phone }; }
  },
  {
    name: 'dispatch_replacement_device', kind: 'action', agent: 'resolver', label: 'Dispatch replacement device', risk: 1, minutes: 25,
    description: 'Send a field agent with a replacement device. Use when remote recovery fails.',
    props: { merchant_id: str, reason: str }, required: ['merchant_id', 'reason'],
    run: ({ merchant_id }, { mission }) => {
      const m = M(merchant_id), d = device(m);
      if (d.replacementEta) return { already_dispatched: true, eta: new Date(d.replacementEta).toISOString() };
      const secs = Number(process.env.DOST_REPLACEMENT_SECONDS) || 120;
      d.replacementEta = Date.now() + secs * 1000;
      const fa = db().fieldAgents.find(f => f.city === m.city) || db().fieldAgents[0];
      mission.revenue += baseline(m);
      return { field_ticket: uid('FLD'), field_agent: fa.name, city: m.city, eta_minutes: Math.max(1, Math.round(secs / 60)) };
    }
  },
  {
    name: 'list_settlements', kind: 'read', agent: 'resolver',
    description: 'Recent settlements for a merchant with status and failure reasons.',
    props: { merchant_id: str }, required: ['merchant_id'],
    run: ({ merchant_id }) => db().settlements.filter(s => s.merchantId === merchant_id).sort((a, b) => b.date - a.date).slice(0, 6)
      .map(s => ({ id: s.id, amount: s.amount, date: new Date(s.date).toISOString().slice(0, 10), status: s.status, reason: s.reason, retries: s.retries }))
  },
  {
    name: 'check_duplicate_risk', kind: 'read', agent: 'compliance',
    description: 'Check whether re-initiating a settlement could cause a duplicate payout.',
    props: { settlement_id: str }, required: ['settlement_id'],
    run: ({ settlement_id }) => {
      const s = S(settlement_id);
      const dup = db().settlements.some(x => x !== s && x.merchantId === s.merchantId && x.amount === s.amount && x.status === 'SETTLED' && Math.abs(x.date - s.date) < DAY / 2);
      return { settlement_id, status: s.status, prior_retries: s.retries, duplicate_found: dup, safe_to_retry: s.status === 'FAILED' && !dup && s.retries < (P('settlements').max_retries ?? 2) };
    }
  },
  {
    name: 'retry_settlement', kind: 'action', agent: 'resolver', label: 'Re-initiate settlement', minutes: 30,
    risk: i => { const a = S(i.settlement_id).amount, p = P('settlements'); return a >= (p.human_required_from ?? 200000) ? 3 : a >= (p.auto_approve_below ?? 10000) ? 2 : 1; },
    amount: i => S(i.settlement_id).amount,
    description: 'Re-initiate a failed settlement on a payment rail. Moves money — run check_duplicate_risk and simulate_action first.',
    props: { settlement_id: str, rail: { type: 'string', enum: ['IMPS', 'NEFT'] } }, required: ['settlement_id', 'rail'],
    run: ({ settlement_id, rail }, { mission }) => {
      const s = S(settlement_id);
      if (s.status !== 'FAILED') return { success: false, detail: `Settlement is ${s.status}` };
      s.retries++;
      if (/IFSC/.test(s.reason)) { s.needsMerchantAction = true; return { success: false, error_code: 'IFSC_INVALID', detail: 'Beneficiary IFSC no longer valid after bank merger — merchant must update bank details' }; }
      Object.assign(s, { status: 'SETTLED', utr: String(ri(1e11, 9e11)), rail, settledAt: Date.now() });
      for (const t of db().tickets) if (t.settlementId === s.id) t.status = 'resolved';
      mission.protected += s.amount;
      return { success: true, utr: s.utr, amount: s.amount, rail };
    }
  },
  {
    name: 'score_credit_eligibility', kind: 'read', agent: 'growth',
    description: 'Score a merchant for a working-capital loan from their transaction history.',
    props: { merchant_id: str }, required: ['merchant_id'],
    run: ({ merchant_id }) => {
      const m = M(merchant_id), c = creditScore(m), reasons = [];
      if (m.activeLoan) reasons.push('already has an active loan');
      if (kycDays(m) <= 0) reasons.push('KYC expired');
      if (c.open) reasons.push(`${c.open} open complaint(s)`);
      const lp = P('lending');
      if (c.score < (lp.min_score ?? 0.7)) reasons.push(`score ${c.score} below policy minimum ${lp.min_score ?? 0.7}`);
      if (c.limit < 20000) reasons.push('volume too low for minimum ticket');
      if (c.emiPct > (lp.max_emi_to_gmv_pct ?? 15)) reasons.push(`EMI would be ${c.emiPct}% of daily GMV (policy max ${lp.max_emi_to_gmv_pct}%)`);
      const eligible = !reasons.length;
      if (!eligible) m.loanDeclinedAt = Date.now();
      return { eligible, score: c.score, limit: c.limit, daily_emi: c.emi, emi_to_gmv_pct: c.emiPct, reasons };
    }
  },
  {
    name: 'request_consent', kind: 'comms', agent: 'growth', minutes: 5,
    description: 'Send the Key Fact Statement and capture explicit consent for a credit product (RBI digital lending).',
    props: { merchant_id: str, product: str, amount: num }, required: ['merchant_id', 'product', 'amount'],
    run: ({ merchant_id }) => {
      // Consent is the merchant's choice: modelled by their persona's appetite for credit.
      const m = M(merchant_id), ok = (m.creditAppetite ?? 1) > 0.15;
      if (ok) m.loanConsent = true; else m.loanDeclinedAt = Date.now();
      return { kfs_sent: true, channel: 'WhatsApp', consent: ok ? 'granted' : 'declined' };
    }
  },
  {
    name: 'submit_loan_application', kind: 'action', agent: 'growth', label: 'Submit loan for disbursal', risk: 3, minutes: 45,
    amount: i => i.amount,
    description: 'Submit a consented working-capital application to the lending partner. Always requires human approval.',
    props: { merchant_id: str, amount: num }, required: ['merchant_id', 'amount'],
    run: ({ merchant_id, amount }, { mission }) => {
      const m = M(merchant_id);
      if (!m.loanConsent) throw new Error('No consent on record — call request_consent first');
      const c = creditScore(m);
      if (amount > c.limit) throw new Error(`Amount exceeds pre-approved limit ${inr(c.limit)}`);
      const loan = { id: uid('APP'), merchantId: m.id, amount, emi: Math.round(amount * 1.14 / 270), status: 'SANCTIONED', createdAt: Date.now() };
      db().loans.push(loan); m.activeLoan = true; mission.revenue += amount;
      return { application_id: loan.id, status: loan.status, daily_emi: loan.emi, disbursal: 'T+0' };
    }
  },
  {
    name: 'place_call', kind: 'comms', agent: 'voice', minutes: 8,
    description: "Speak to the merchant (or, with ticket_id, the customer on that ticket) in their language. Returns their reply and live sentiment.",
    props: { merchant_id: str, ticket_id: str, language: str, topic: { type: 'string', enum: ['device', 'settlement', 'loan', 'complaint', 'kyc', 'general'] }, message: str },
    required: ['merchant_id', 'language', 'topic', 'message'],
    run: async ({ merchant_id, ticket_id, language, topic, message }, { mission }) => {
      const m = M(merchant_id), t = ticket_id ? T(ticket_id) : null;
      const callee = t ? t.customer : `${m.owner} (${m.name})`;
      const d = device(m);
      const situation = t ? `You are a customer. Complaint: "${t.text}". Your mood: ${t.sentiment < -0.6 ? 'furious' : 'annoyed'}.`
        : `You own ${m.name} in ${m.city}. Context: ${topic === 'device' ? `your ${d.model} has been offline for ${offlineHours(d)}h` : topic === 'loan' ? `your sales grew ${Math.round(growth(m) * 100)}% recently` : topic}.`;
      const stage = mission.calls.filter(c => c.who === 'callee').length;
      const r = await calleeReply({ callee, situation, message, topic, stage, sentiment: t?.sentiment ?? 0 });
      mission.calls.push({ who: 'dost', text: message, language, at: Date.now() }, { who: 'callee', name: callee, text: r.text, sentiment: r.sentiment, at: Date.now() });
      return { connected: true, callee, reply: r.text, sentiment: r.sentiment, wants_human: r.wants_human };
    }
  },
  {
    name: 'send_message', kind: 'comms', agent: 'voice', minutes: 2,
    description: 'Send a WhatsApp or SMS message to the merchant, or to the customer on a ticket.',
    props: { merchant_id: str, ticket_id: str, channel: { type: 'string', enum: ['whatsapp', 'sms'] }, text: str },
    required: ['merchant_id', 'channel', 'text'],
    run: ({ merchant_id, ticket_id, channel, text }) => {
      const m = M(merchant_id), to = ticket_id ? T(ticket_id).customer : m.owner;
      db().messages.push({ merchantId: m.id, to, channel, text, at: Date.now() });
      return { delivered: true, to, channel };
    }
  },
  {
    name: 'simulate_action', kind: 'twin', agent: 'resolver',
    description: 'Digital-twin simulation: predict the before/after effect and safety checks of an action before executing it.',
    props: { action: { type: 'string', enum: ['retry_settlement', 'dispatch_replacement', 'submit_loan', 'kyc_campaign', 'reversal'] }, target_id: str, amount: num },
    required: ['action', 'target_id'],
    run: ({ action, target_id, amount }) => {
      if (action === 'retry_settlement') {
        const s = S(target_id), bad = /IFSC/.test(s.reason);
        return { before: `${inr(s.amount)} stuck · ${s.reason}`, after: bad ? 'Retry predicted to FAIL — bank details invalid' : `Credited via IMPS in ~2 min · ledger delta 0`,
          checks: [`Prior retries: ${s.retries}`, bad ? 'Root cause is merchant-side' : 'No duplicate payout path'], recommended: !bad };
      }
      if (action === 'dispatch_replacement') {
        const m = M(target_id), d = device(m), avail = db().fieldAgents.some(f => f.city === m.city);
        return { before: `${d.model} offline ${offlineHours(d)}h · ~${inr(baseline(m))}/day digital volume at risk`, after: `Replacement live today · ${inr(baseline(m))}/day recovered`,
          checks: [avail ? `Field agent available in ${m.city}` : 'No local agent — nearest hub used', m.tenureMonths >= 12 ? 'Warranty: covered' : 'Warranty: chargeable'], recommended: true };
      }
      if (action === 'submit_loan') {
        const m = M(target_id), c = creditScore(m), amt = amount || c.limit;
        const cap = P('lending').max_emi_to_gmv_pct ?? 15;
        return { before: 'No working-capital credit line', after: `${inr(amt)} sanctioned · EMI ${inr(Math.round(amt * 1.14 / 270))}/day (${c.emiPct}% of daily GMV)`,
          checks: [`EMI-to-GMV ${c.emiPct}% ${c.emiPct <= cap ? `≤ ${cap}% ✓` : `> ${cap}% ✗`}`, m.loanConsent ? 'Consent on record ✓' : 'Consent missing ✗'], recommended: c.emiPct <= cap && m.loanConsent };
      }
      if (action === 'kyc_campaign') {
        const due = db().merchants.filter(m => kycDays(m) <= (P('kyc').due_window_days ?? 7) && !m.kycReminded);
        return { before: `${due.length} merchants · ${inr(sum(due.map(baseline)))}/day freeze exposure`, after: `~45% expected to finish video-KYC within the hour`, checks: ['Messages in each merchant\'s language', 'Quiet-hours respected'], recommended: true };
      }
      const t = T(target_id);
      return { before: `${inr(t.amount)} debited twice`, after: `${inr(t.amount)} reversed to customer in ~2h`, checks: ['Second debit confirmed in ledger', 'No prior reversal'], recommended: true };
    }
  },
  {
    name: 'get_ticket', kind: 'read', agent: 'triage',
    description: 'Read a support ticket including text and detected sentiment.',
    props: { ticket_id: str }, required: ['ticket_id'],
    run: ({ ticket_id }) => { const t = T(ticket_id); return { id: t.id, kind: t.kind, customer: t.customer, merchant_id: t.merchantId, text: t.text, amount: t.amount, sentiment: t.sentiment, status: t.status }; }
  },
  {
    name: 'check_transaction', kind: 'read', agent: 'resolver',
    description: 'Inspect the transaction behind a duplicate-debit ticket in the ledger.',
    props: { ticket_id: str }, required: ['ticket_id'],
    run: ({ ticket_id }) => { const t = T(ticket_id); return { txn_id: t.txnId, amount: t.amount, debits_found: 2, second_debit: t.reversal ? 'reversal initiated' : 'captured', reversal_arn: t.reversal?.arn || null }; }
  },
  {
    name: 'initiate_reversal', kind: 'action', agent: 'resolver', label: 'Reverse duplicate debit', minutes: 15,
    risk: i => (T(i.ticket_id).amount < (P('refunds').auto_approve_below ?? 2000) ? 1 : 2), amount: i => T(i.ticket_id).amount,
    description: 'Reverse the duplicate debit on a ticket back to the customer.',
    props: { ticket_id: str }, required: ['ticket_id'],
    run: ({ ticket_id }, { mission }) => {
      const t = T(ticket_id);
      if (t.reversal) return { already: true, ...t.reversal };
      t.reversal = { arn: String(ri(1e7, 9e7)), eta: '2h' }; mission.protected += t.amount;
      return { initiated: true, ...t.reversal };
    }
  },
  {
    name: 'resolve_ticket', kind: 'action', agent: 'resolver', minutes: 3,
    description: 'Close a ticket with a resolution note.',
    props: { ticket_id: str, resolution: str }, required: ['ticket_id', 'resolution'],
    run: ({ ticket_id, resolution }) => { const t = T(ticket_id); t.status = 'resolved'; t.resolution = resolution; return { closed: true }; }
  },
  {
    name: 'handoff_to_human', kind: 'handoff', agent: 'triage', minutes: 10,
    description: 'Warm hand-off to a human teammate with a concise brief. Use for distress, explicit human requests, or anything outside your authority.',
    props: { role: { type: 'string', enum: ['support', 'sales', 'risk'] }, summary: str, brief: { type: 'array', items: str }, recommended_action: str, ticket_id: str },
    required: ['role', 'summary', 'brief', 'recommended_action'],
    run: ({ role, summary, brief, recommended_action, ticket_id }, { mission }) => {
      const who = db().team.find(t => t.id === role);
      const h = { id: uid('HO'), missionId: mission.id, to: who.id, toName: who.name, summary, brief, recommended_action, status: 'open', at: Date.now() };
      db().handoffs.unshift(h);
      if (ticket_id) T(ticket_id).status = 'handed_off';
      mission.handedOff = true;
      return { handed_to: `${who.name} (${who.role})`, handoff_id: h.id };
    }
  },
  {
    name: 'list_kyc_due', kind: 'read', agent: 'compliance',
    description: 'Merchants whose re-KYC falls due within N days.',
    props: { days: num }, required: ['days'],
    run: ({ days }) => {
      const due = db().merchants.filter(m => kycDays(m) <= days && !m.kycReminded);
      const langs = {}; for (const m of due) langs[m.language] = (langs[m.language] || 0) + 1;
      return { count: due.length, exposure_per_day: sum(due.map(baseline)), languages: langs, merchants: due.map(m => ({ id: m.id, name: m.name, language: m.language, days_left: kycDays(m) })) };
    }
  },
  {
    name: 'run_kyc_campaign', kind: 'action', agent: 'compliance', label: 'Launch re-KYC outreach', risk: 1,
    minutes: i => 6 * (i.merchant_ids?.length || 0),
    description: "Send personalised voice notes + one-tap video-KYC links in each merchant's language.",
    props: { merchant_ids: { type: 'array', items: str } }, required: ['merchant_ids'],
    run: ({ merchant_ids }, { mission }) => {
      let done = 0;
      for (const id of merchant_ids) {
        const m = M(id); m.kycReminded = true;
        if (Math.random() < 0.45) { m.kycExpiry = Date.now() + 365 * DAY; done++; mission.protected += baseline(m); }
      }
      return { delivered: merchant_ids.length, completed_video_kyc: done, pending_follow_up: merchant_ids.length - done };
    }
  }
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]));
export const apiTools = TOOLS.map(t => ({
  name: t.name, description: t.description,
  input_schema: { type: 'object', properties: t.props, required: t.required, additionalProperties: false }
}));
export const toolCatalog = TOOLS.map(t => ({
  name: t.name, label: t.label || t.name, kind: t.kind, agent: t.agent, description: t.description,
  risk: typeof t.risk === 'function' ? 'by amount' : (t.risk || 0)
}));
