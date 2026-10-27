// Proactive Radar: derives actionable signals from live data. Nothing here is scripted.
import { getDb } from './store.js';
import { baseline, growth, kycDays, inr, sum, HOUR, DAY } from './calc.js';
import { P } from './policy.js';

const ORDER = { critical: 0, high: 1, regulatory: 2, opportunity: 3 };

export function detectSignals() {
  const db = getDb(), now = Date.now(), out = [];
  const byId = id => db.merchants.find(m => m.id === id);
  // Signals already being worked, or already handed to a human, are not re-raised.
  const busy = new Set(db.missions.filter(m => ['running', 'waiting', 'handoff'].includes(m.status)).map(m => m.signalId));

  for (const d of db.devices) {
    if (d.status !== 'offline' || d.replacementEta) continue;
    const m = byId(d.merchantId), h = Math.max(1, Math.round((now - d.lastHeartbeat) / HOUR));
    out.push({
      id: `sig-dev-${d.id}`, type: 'device_offline', severity: 'critical', merchantId: m.id,
      title: `${d.model} offline · ${h}h`, detail: `${m.name} · ${m.city} · ~${inr(baseline(m))}/day digital volume at risk`,
      goal: `${m.name}'s ${d.model} (${d.id}) has been offline for ${h} hours. Restore their ability to accept and hear payments and make sure they don't lose sales.`
    });
  }

  for (const s of db.settlements) {
    if (s.status !== 'FAILED' || s.needsMerchantAction) continue;
    const m = byId(s.merchantId);
    out.push({
      id: `sig-stl-${s.id}`, type: 'settlement_failed', severity: 'high', merchantId: m.id, settlementId: s.id,
      title: `Settlement failed · ${inr(s.amount)}`, detail: `${m.name} · ${m.city} · ${s.reason}`,
      goal: `Settlement ${s.id} of ${inr(s.amount)} for ${m.name} failed (${s.reason}). Get the money to the merchant safely and close the loop.`
    });
  }

  for (const t of db.tickets) {
    if (t.status !== 'open' || t.kind !== 'duplicate_debit') continue;
    const m = byId(t.merchantId), angry = t.sentiment < -0.6;
    out.push({
      id: `sig-tkt-${t.id}`, type: 'complaint', severity: angry ? 'critical' : 'high', merchantId: m.id, ticketId: t.id,
      title: `Duplicate debit ${inr(t.amount)} · ${angry ? 'distressed customer' : 'customer complaint'}`,
      detail: `${t.customer} @ ${m.name} · “${t.text.slice(0, 64)}${t.text.length > 64 ? '…' : ''}”`,
      goal: `Customer ${t.customer} reports: "${t.text}" (ticket ${t.id}, merchant ${m.name}). Resolve it; if the customer is highly distressed, hand off to a human with a full brief.`
    });
  }

  const win = P('kyc').due_window_days ?? 7;
  const due = db.merchants.filter(m => kycDays(m) <= win && !m.kycReminded);
  if (due.length) out.push({
    id: 'sig-kyc', type: 'kyc_due', severity: 'regulatory', merchantIds: due.map(m => m.id),
    title: `Re-KYC due · ${due.length} merchant${due.length > 1 ? 's' : ''}`,
    detail: `Within ${win} days · ~${inr(sum(due.map(baseline)))}/day settlement-freeze exposure`,
    goal: `${due.length} merchants have re-KYC due within ${win} days. Make sure none of them get their settlements frozen.`
  });

  const grow = db.merchants
    .filter(m => growth(m) > 0.25 && !m.activeLoan && !(m.loanDeclinedAt && now - m.loanDeclinedAt < (P('lending').cooldown_days_after_decline ?? 30) * DAY) && !db.tickets.some(t => t.merchantId === m.id && t.status === 'open'))
    .sort((a, b) => growth(b) - growth(a)).slice(0, 3);
  for (const m of grow) {
    const pct = Math.round(growth(m) * 100);
    out.push({
      id: `sig-grw-${m.id}`, type: 'growth', severity: 'opportunity', merchantId: m.id,
      title: `Growth signal · GMV +${pct}%`, detail: `${m.name} · ${m.city} · no active credit line`,
      goal: `${m.name} grew GMV ${pct}% over the last two weeks with no active credit line. Evaluate eligibility and, if appropriate, help them get working capital — with explicit consent.`
    });
  }

  return out.filter(s => !busy.has(s.id)).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
