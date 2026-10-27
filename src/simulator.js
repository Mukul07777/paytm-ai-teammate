// Live world simulator: heartbeats, sales, and randomly occurring incidents.
import { getDb, save, uid } from './store.js';
import { changed, feed } from './bus.js';
import { baseline, DAY, HOUR, inr } from './calc.js';
import { ri, rnd, pick, OWNERS, SURNAMES } from './seed.js';

const TICK_MS = 5000;
export const INCIDENTS = ['device', 'settlement', 'complaint', 'kyc', 'growth'];

export function startSimulator() {
  const db = getDb();
  if (!db.meta.bootstrapped) { for (const t of INCIDENTS) inject(t); db.meta.bootstrapped = true; save(); }
  setInterval(tick, TICK_MS);
}

function tick() {
  const db = getDb(), now = Date.now();
  for (const d of db.devices) {
    if (d.replacementEta && now >= d.replacementEta) {
      const m = db.merchants.find(x => x.id === d.merchantId);
      Object.assign(d, { fault: null, status: 'online', lastHeartbeat: now, replacementEta: null });
      feed('resolver', `Replacement ${d.model} for <b>${m.name}</b> is online — payments flowing again`);
    }
    if (!d.fault && d.status === 'online') d.lastHeartbeat = now;
  }
  for (const m of db.merchants) {
    const online = db.devices.find(d => d.id === m.deviceId)?.status === 'online';
    m.todayGmv = (m.todayGmv || 0) + Math.round(baseline(m) * TICK_MS / DAY * (online ? rnd(0.8, 1.2) : 0.15));
  }
  if (Math.random() < 0.035) inject(pick(INCIDENTS));
  save(); changed();
}

export function inject(type) {
  const db = getDb(), now = Date.now();
  const m = pick(db.merchants);
  switch (type) {
    case 'device': {
      const d = pick(db.devices.filter(x => x.status === 'online'));
      if (!d) return null;
      Object.assign(d, { fault: pick(['sim', 'power', 'firmware', 'sim']), status: 'offline', lastHeartbeat: now - ri(3, 20) * HOUR });
      return { type, ref: d.id };
    }
    case 'settlement': {
      const s = { id: `STL-${ri(100000, 999999)}`, merchantId: m.id, amount: Math.round(baseline(m) * rnd(0.8, 1.2)), date: now - ri(2, 10) * HOUR, status: 'FAILED', retries: 0, utr: null,
        reason: pick(['Beneficiary bank timeout (HDFC)', 'NPCI switch timeout', 'Beneficiary bank timeout (SBI)', 'IFSC invalid after bank merger']) };
      db.settlements.push(s);
      if (Math.random() < 0.6) db.tickets.push({ id: uid('TKT'), kind: 'settlement_missing', merchantId: m.id, settlementId: s.id, customer: m.owner, channel: 'whatsapp',
        text: `Kal ka settlement ${inr(s.amount)} abhi tak nahi aaya. Supplier ko payment karna hai.`, sentiment: -0.4, status: 'open', createdAt: now });
      return { type, ref: s.id };
    }
    case 'complaint': {
      const amount = ri(3, 180) * 50, sentiment = +rnd(-0.95, -0.3).toFixed(2), customer = `${pick(OWNERS)} ${pick(SURNAMES)[0]}.`;
      const text = sentiment < -0.6
        ? `You people debited ${inr(amount)} twice at ${m.name}! This is fraud, I will file a police complaint.`
        : `My payment of ${inr(amount)} at ${m.name} got deducted twice. Please refund the extra amount.`;
      const t = { id: uid('TKT'), kind: 'duplicate_debit', merchantId: m.id, customer, channel: 'call', text, amount, sentiment, txnId: `TXN-${ri(1e7, 9e7)}`, status: 'open', createdAt: now };
      db.tickets.push(t);
      return { type, ref: t.id };
    }
    case 'kyc': {
      const batch = db.merchants.filter(x => !x.kycReminded).sort(() => Math.random() - 0.5).slice(0, ri(4, 10));
      for (const x of batch) x.kycExpiry = now + ri(1, 6) * DAY;
      return { type, ref: batch.length };
    }
    case 'growth': {
      const g = pick(db.merchants.filter(x => !x.activeLoan && !x.loanDeclinedAt));
      if (!g) return null;
      g.gmv30 = g.gmv30.map((v, i) => (i >= 16 ? Math.round(v * rnd(1.2, 1.35)) : v));
      return { type, ref: g.id };
    }
  }
  return null;
}
