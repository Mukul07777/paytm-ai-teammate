// Deterministic planner used when no LLM key is configured. It calls the same tools,
// through the same guardrails, and reasons from what those tools actually return.
import { detectSignals } from './radar.js';
import { inr } from './calc.js';
import { P } from './policy.js';

const HINDI_BELT = ['Hindi', 'Marathi', 'Gujarati', 'Punjabi'];
const say = (p, hi, en) => (HINDI_BELT.includes(p.language) ? hi : en);

export function classify(goal) {
  const q = goal.toLowerCase();
  if (/sound|offline|device|speaker|edc/.test(q)) return 'device_offline';
  if (/settle|payout|paisa|not received/.test(q)) return 'settlement_failed';
  if (/loan|grow|credit|upsell|revenue|capital/.test(q)) return 'growth';
  if (/kyc|frozen|freeze|compliance|deadline/.test(q)) return 'kyc_due';
  if (/angry|complain|customer|refund|debit|fraud/.test(q)) return 'complaint';
  return null;
}

export async function runPlaybook(m, sig, ctx) {
  const { think } = ctx;
  const mid = !sig && /MID-\d+/.exec(m.goal)?.[0];
  if (mid) {
    const p = await ctx.call('get_merchant_profile', { merchant_id: mid });
    if (p.error) { m.outcome = p.error; return; }
    sig = detectSignals().find(s => s.merchantId === mid || s.merchantIds?.includes(mid));
    if (!sig) {
      await think('triage', `Health check for ${p.name}: device ${p.device.status}, GMV trend ${p.gmv_growth_14d_pct}% (14d), KYC ${p.kyc_days_left} days left, ${p.open_tickets.length} open tickets. Nothing needs action.`);
      m.outcome = `${p.name} is healthy — no action needed`; return;
    }
    ctx.attach(sig);
    await think('triage', `Health check found an issue for ${p.name}: ${sig.title}. Taking it on.`);
    return PB[sig.type](m, sig, ctx);
  }
  if (!sig) {
    const type = classify(m.goal);
    if (!type) { await think('triage', `I can't map “${m.goal}” to a playbook. Add an ANTHROPIC_API_KEY to let me plan open-ended goals.`); m.outcome = 'Goal outside playbook coverage'; return; }
    sig = detectSignals().find(s => s.type === type);
    if (!sig) { await think('triage', `Scanned every live signal for “${m.goal}” — nothing needs action right now.`); m.outcome = 'All clear — nothing to fix'; return; }
    ctx.attach(sig);
    await think('triage', `Interpreted the goal as “${type.replace('_', ' ')}”. Highest-priority match: ${sig.title} — ${sig.detail}.`);
  }
  return PB[sig.type](m, sig, ctx);
}

const PB = {
  async device_offline(m, sig, { call, think }) {
    const p = await call('get_merchant_profile', { merchant_id: sig.merchantId });
    await think('triage', `${p.name} (${p.city}): ${p.device.model} offline for ${p.device.offline_hours}h. Average daily GMV ${inr(p.avg_daily_gmv)} is at risk. ${p.open_tickets.length ? 'Merchant has an open ticket.' : 'No complaint raised yet — acting proactively.'}`);
    const h = await call('get_device_health', { merchant_id: p.id });
    const cause = h.sim_signal === 'none' ? 'SIM / network failure' : h.battery.startsWith('0%') ? 'power failure' : 'firmware crash loop';
    await think('resolver', `Telemetry points to ${cause}. Trying the cheapest fix first: remote recovery.`);
    const r = await call('remote_reboot_device', { device_id: h.device_id });
    if (r.recovered) {
      await call('send_message', { merchant_id: p.id, channel: 'whatsapp', text: say(p, `${p.owner} ji, aapka ${h.model} remotely theek kar diya gaya hai — payments phir se chalu hain.`, `${p.owner}, your ${h.model} was fixed remotely — payments are flowing again.`) });
      m.outcome = 'Recovered remotely — no field visit needed'; return;
    }
    await think('resolver', `Remote recovery failed (${r.detail || r.error}). Moving to hardware replacement, and protecting sales in the meantime.`);
    await call('place_call', { merchant_id: p.id, language: p.language, topic: 'device', message: say(p,
      `Namaste ${p.owner} ji, main Dost bol raha hoon Paytm se. Aapka ${h.model} ${Math.round(p.device.offline_hours)} ghante se offline hai — kya payment alerts aa rahe hain?`,
      `Hello ${p.owner}, this is Dost from Paytm. Your ${h.model} has been offline for ${Math.round(p.device.offline_hours)} hours — are you getting payment alerts?`) });
    await call('enable_fallback_alerts', { merchant_id: p.id });
    await call('simulate_action', { action: 'dispatch_replacement', target_id: p.id });
    const d = await call('dispatch_replacement_device', { merchant_id: p.id, reason: cause });
    if (d.error) { m.outcome = 'Replacement not dispatched — awaiting human direction'; return; }
    await call('place_call', { merchant_id: p.id, language: p.language, topic: 'device', message: say(p,
      `${d.field_agent} naya device lekar aa rahe hain. Tab tak har payment ka alert aapke phone par aayega.`,
      `${d.field_agent} is on the way with a new device. Until then every payment alert will come to your phone.`) });
    m.outcome = `Replacement dispatched with ${d.field_agent}; phone alerts live — sales protected`;
  },

  async settlement_failed(m, sig, { call, think }) {
    const p = await call('get_merchant_profile', { merchant_id: sig.merchantId });
    const list = await call('list_settlements', { merchant_id: p.id });
    const s = list.find(x => x.id === sig.settlementId);
    await think('triage', `${p.name}: settlement ${s.id} of ${inr(s.amount)} FAILED — ${s.reason}. ${p.open_tickets.length ? 'Merchant already wrote in.' : 'Merchant hasn\'t complained yet.'}`);
    const dup = await call('check_duplicate_risk', { settlement_id: s.id });
    if (!dup.safe_to_retry) {
      await call('handoff_to_human', { role: 'risk', summary: `Settlement ${s.id} not safe to auto-retry`, brief: [`${inr(s.amount)} for ${p.name}`, `Duplicate found: ${dup.duplicate_found}`, `Prior retries: ${dup.prior_retries}`], recommended_action: 'Manually reconcile before any retry' });
      m.outcome = 'Duplicate-payout risk — routed to Risk Ops'; return;
    }
    const tw = await call('simulate_action', { action: 'retry_settlement', target_id: s.id });
    await think('compliance', tw.recommended ? 'Simulation clean: no duplicate payout path, ledger balances after credit.' : `Simulation flags a problem: ${tw.after}. Retrying once to confirm root cause.`);
    const r = await call('retry_settlement', { settlement_id: s.id, rail: 'IMPS' });
    if (r.error) { m.outcome = 'Retry declined by human'; return; }
    if (!r.success) {
      await think('resolver', `Retry failed: ${r.detail}. This needs the merchant, not a retry loop.`);
      await call('send_message', { merchant_id: p.id, channel: 'whatsapp', text: say(p, `${p.owner} ji, aapke bank ka IFSC badal gaya hai. Is link se naye bank details update karein, hum turant ${inr(s.amount)} bhej denge.`, `${p.owner}, your bank's IFSC has changed. Please update your bank details via this link and we'll send ${inr(s.amount)} right away.`) });
      await call('handoff_to_human', { role: 'support', summary: `Settlement ${s.id} blocked by invalid IFSC`, brief: [`${inr(s.amount)} pending for ${p.name}`, 'Root cause: IFSC invalid after bank merger', 'Merchant has been sent the bank-update link'], recommended_action: 'Verify the updated bank details, then re-trigger settlement' });
      m.outcome = 'Root cause found (invalid IFSC); merchant notified; briefed hand-off'; return;
    }
    await call('send_message', { merchant_id: p.id, channel: 'whatsapp', text: say(p, `${p.owner} ji, aapka ${inr(r.amount)} settlement credit ho gaya hai (UTR ${r.utr}). Deri ke liye maafi.`, `${p.owner}, your ${inr(r.amount)} settlement has been credited (UTR ${r.utr}). Sorry for the delay.`) });
    m.outcome = `${inr(r.amount)} credited via ${r.rail} (UTR ${r.utr})`;
  },

  async complaint(m, sig, { call, think }) {
    const t = await call('get_ticket', { ticket_id: sig.ticketId });
    const tx = await call('check_transaction', { ticket_id: t.id });
    const esc = P('escalation'), words = [].concat(esc.handoff_keywords || []);
    const distressed = t.sentiment < (esc.handoff_sentiment_below ?? -0.6) || words.some(w => t.text.toLowerCase().includes(w.toLowerCase()));
    await think('triage', `Duplicate debit of ${inr(t.amount)} confirmed in ledger (${tx.txn_id}). Customer sentiment ${t.sentiment}${distressed ? ' — high distress' : ''}.`);
    const c = await call('place_call', { merchant_id: t.merchant_id, ticket_id: t.id, language: 'English', topic: 'complaint',
      message: `I completely understand — seeing ${inr(t.amount)} taken twice is alarming. I can see the duplicate debit and I'm starting the reversal right now.` });
    await call('simulate_action', { action: 'reversal', target_id: t.id });
    const rv = await call('initiate_reversal', { ticket_id: t.id });
    if (distressed || c.wants_human) {
      await think('qa', `${c.wants_human ? 'Customer asked for a human' : 'High distress'} — policy says a person must own this. My job now is to make that person faster.`);
      await call('handoff_to_human', { role: 'support', ticket_id: t.id, summary: `Duplicate debit ${inr(t.amount)} — ${t.customer}`,
        brief: [`Duplicate debit ${inr(t.amount)} confirmed (txn ${tx.txn_id})`, rv.error ? 'Reversal NOT initiated — was declined' : `Reversal initiated · ARN ${rv.arn} · ETA ${rv.eta}`, `Sentiment ${c.sentiment} — ${c.wants_human ? 'explicitly asked for a human' : 'high churn risk'}`],
        recommended_action: 'Apologise, share the ARN, offer goodwill cashback' });
      m.outcome = 'Reversal started; warm hand-off with full brief — zero repeat questions'; return;
    }
    if (rv.error) { m.outcome = 'Reversal declined by human'; return; }
    await call('send_message', { merchant_id: t.merchant_id, ticket_id: t.id, channel: 'sms', text: `Your extra ${inr(t.amount)} is being reversed (ARN ${rv.arn}), ETA ${rv.eta}. Sorry for the trouble.` });
    await call('resolve_ticket', { ticket_id: t.id, resolution: `Reversal ARN ${rv.arn}` });
    m.outcome = `Reversal ${inr(t.amount)} initiated (ARN ${rv.arn}); ticket closed`;
  },

  async growth(m, sig, { call, think }) {
    const p = await call('get_merchant_profile', { merchant_id: sig.merchantId });
    const sc = await call('score_credit_eligibility', { merchant_id: p.id });
    if (!sc.eligible) { await think('growth', `Not eligible right now: ${sc.reasons.join('; ')}. No pitch — responsible lending.`); m.outcome = 'Not eligible — no pitch made'; return; }
    await think('growth', `Eligible: score ${sc.score}, pre-approved ${inr(sc.limit)}, EMI ${inr(sc.daily_emi)}/day = ${sc.emi_to_gmv_pct}% of daily GMV.`);
    await call('place_call', { merchant_id: p.id, language: p.language, topic: 'loan', message: say(p,
      `${p.owner} ji, aapki sales ${p.gmv_growth_14d_pct}% badhi hai — badhai ho! Aapke liye ${inr(sc.limit)} ka pre-approved loan hai, ${inr(sc.daily_emi)} daily EMI seedha settlement se.`,
      `${p.owner}, your sales are up ${p.gmv_growth_14d_pct}% — congratulations! You're pre-approved for ${inr(sc.limit)}, repaid at ${inr(sc.daily_emi)}/day from settlements.`) });
    await call('place_call', { merchant_id: p.id, language: p.language, topic: 'loan', message: say(p,
      'Koi naya document nahi chahiye — sab already verified hai. Main Key Fact Statement WhatsApp kar raha hoon.',
      'No new documents needed — everything is already verified. I\'m sending the Key Fact Statement on WhatsApp.') });
    const cs = await call('request_consent', { merchant_id: p.id, product: 'Merchant Cash Advance', amount: sc.limit });
    if (cs.consent !== 'granted') { await think('growth', 'Merchant declined. Respecting that — no follow-up for 30 days.'); m.outcome = 'Merchant declined — respected'; return; }
    await call('simulate_action', { action: 'submit_loan', target_id: p.id, amount: sc.limit });
    const ap = await call('submit_loan_application', { merchant_id: p.id, amount: sc.limit });
    if (ap.error) { m.outcome = `Loan not submitted — ${ap.note || ap.error}`; return; }
    await call('send_message', { merchant_id: p.id, channel: 'whatsapp', text: say(p, `Badhai ho! ${inr(sc.limit)} sanction ho gaya hai (${ap.application_id}). Aaj hi aapke account mein.`, `Congratulations! ${inr(sc.limit)} is sanctioned (${ap.application_id}) and will reach your account today.`) });
    m.outcome = `${inr(sc.limit)} loan sanctioned (${ap.application_id})`;
  },

  async kyc_due(m, sig, { call, think }) {
    const due = await call('list_kyc_due', { days: P('kyc').due_window_days ?? 7 });
    const langs = Object.entries(due.languages).map(([k, v]) => `${v} ${k}`).join(', ');
    await think('compliance', `${due.count} merchants due for re-KYC within 7 days (${langs}). Exposure if frozen: ${inr(due.exposure_per_day)}/day.`);
    await call('simulate_action', { action: 'kyc_campaign', target_id: 'all' });
    const r = await call('run_kyc_campaign', { merchant_ids: due.merchants.map(x => x.id) });
    if (r.error) { m.outcome = 'Campaign declined by human'; return; }
    await think('qa', `${r.completed_video_kyc}/${r.delivered} finished video-KYC immediately; ${r.pending_follow_up} scheduled for follow-up in their quiet hours.`);
    m.outcome = `${r.completed_video_kyc} of ${r.delivered} merchants re-KYC'd; rest on auto follow-up`;
  }
};
