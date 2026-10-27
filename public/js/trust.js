let evalBusy = false;

async function runEvals() {
  evalBusy = true; window.page.render(S);
  try { const r = await api('/api/evals/run', {}); toast(r.passed === r.scenarios ? '🏆' : '⚠️', `Eval suite: ${r.passed}/${r.scenarios} passed`, `${r.checksPassed}/${r.checksTotal} policy checks`); }
  catch (e) { toast('⚠️', 'Eval run failed', e.message); }
  evalBusy = false; window.page.render(S);
}

function ring(pct) {
  const r = 64, c = 2 * Math.PI * r, col = pct >= 95 ? '#12B76A' : pct >= 80 ? '#F79009' : '#F04438';
  return `<div class="ring"><svg width="150" height="150"><circle cx="75" cy="75" r="${r}" stroke="#EEF2F7" stroke-width="12" fill="none"/>
    <circle cx="75" cy="75" r="${r}" stroke="${col}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset 1s"/></svg>
    <b>${pct}%</b></div>`;
}

const WEBHOOK_SNIPPET = `// Push a real event into Dost (HMAC-SHA256 signed)
const body = JSON.stringify({ type: 'settlement.failed', merchant_id: 'MID-XXXXX',
  amount: 18500, reason: 'Beneficiary bank timeout (ICICI)' });
const sig = 'sha256=' + require('crypto')
  .createHmac('sha256', process.env.DOST_WEBHOOK_SECRET || 'dev-secret')
  .update(body).digest('hex');
await fetch('http://localhost:3000/api/webhooks/events', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Dost-Signature': sig }, body });
// Supported: device.offline · settlement.failed · ticket.created`;

window.page = {
  async render(S) {
    const { runs, running } = await api('/api/evals');
    const last = runs[0], busy = running || evalBusy;
    $('#view').innerHTML = `<div class="phead"><div><h1>Trust & Evals</h1><p class="sub">Autonomy has to be earned with evidence. Every scenario runs the real engine in an isolated world and checks the resulting state against policy.</p></div>
      <a class="btn gh" href="/api/audit.csv">⬇ Export audit trail (CSV)</a></div>
    <div class="card" style="margin-top:18px"><div class="trusthead">
      ${last ? ring(last.passRate) : ring(0)}
      <div style="flex:1">
        <h2 style="font-size:20px;letter-spacing:-.3px">${last ? `${last.passed}/${last.scenarios} scenarios · ${last.checksPassed}/${last.checksTotal} policy checks passed` : 'No eval run yet'}</h2>
        <p class="sub">${last ? `Last run ${ago(last.at)} · planner: ${last.mode}` : 'Run the suite to measure Dost against 16 τ-bench-style scenarios.'} · Covers money movement, lending consent, escalation, learning and autonomy limits.</p>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn pri" ${busy ? 'disabled' : ''} onclick="runEvals()">${busy ? '⏳ Running scenarios…' : '▶ Run eval suite'}</button>
        <span class="tag t-gray" style="align-self:center">CLI: npm run eval</span></div>
      </div>
      ${runs.length > 1 ? `<div style="text-align:right"><small style="color:var(--mute)">History</small><div style="display:flex;gap:4px;margin-top:6px;align-items:flex-end;height:44px">${runs.slice(0, 10).reverse().map(r => `<div title="${r.passRate}% · ${new Date(r.at).toLocaleTimeString()}" style="width:10px;height:${Math.max(4, r.passRate * 0.44)}px;border-radius:3px;background:${r.passRate === 100 ? 'var(--green)' : 'var(--amber)'}"></div>`).join('')}</div></div>` : ''}
    </div></div>
    ${last ? `<div class="card" style="margin-top:18px;overflow:auto"><table class="tbl"><thead><tr><th style="width:90px">Scenario</th><th>Behaviour under test</th><th>Policy checks</th><th>Result</th></tr></thead><tbody>
      ${last.results.map(r => `<tr><td class="mono"><b>${r.id}</b></td><td><b>${esc(r.name)}</b><br><small style="color:var(--mute)">${r.steps ?? 0} steps · ${r.ms ?? 0} ms · ended ${esc(r.status || '')}</small></td>
      <td>${r.checks.map(c => `<span class="chk ${c.pass ? 't-green' : 't-red'}">${c.pass ? '✓' : '✗'} ${esc(c.name)}</span>`).join('')}</td>
      <td><span class="tag ${r.pass ? 't-green' : 't-red'}">${r.pass ? 'PASS' : 'FAIL'}</span></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <div class="grid row3">
      <div class="card"><div class="ch"><h3>🔌 Signed webhooks</h3><small>Real systems push events in</small></div><pre class="snip">${esc(WEBHOOK_SNIPPET)}</pre></div>
      <div class="card"><div class="ch"><h3>🔒 Hard guardrails</h3><small>Enforced in code, configured by policy</small></div>${S.guardrails.map(([k, v]) => `<div class="gr"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
        <div class="gr"><span>Tool timeouts</span><b>20s · reads retried once, actions never</b></div>
        <div class="gr"><span>Webhook auth</span><b>HMAC-SHA256, constant-time compare</b></div></div>
    </div>`;
  }
};
