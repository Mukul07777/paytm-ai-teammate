let mq = '', mtimer;

function spark(vals) {
  const max = Math.max(...vals), min = Math.min(...vals), w = 90, h = 26;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / Math.max(1, max - min) * (h - 4)).toFixed(1)}`).join(' ');
  const up = vals.at(-1) >= vals[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--green)' : 'var(--red)'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function onSearch(v) { mq = v; clearTimeout(mtimer); mtimer = setTimeout(() => window.page.render(S), 200); }

window.page = {
  async render(S) {
    const list = await api(`/api/merchants?q=${encodeURIComponent(mq)}`);
    const had = document.activeElement?.id === 'mSearch';
    $('#view').innerHTML = `<div class="phead"><div><h1>Merchants</h1><p class="sub">The live merchant base Dost watches — ${S.metrics.merchants} merchants, 30-day GMV history, device telemetry, KYC and credit.</p></div>
      <div class="search">🔎<input id="mSearch" placeholder="Search name, city, language, MID" value="${esc(mq)}" oninput="onSearch(this.value)"></div></div>
    <div class="card" style="margin-top:18px;overflow:auto;max-height:calc(100vh - 190px)">
      <table class="tbl"><thead><tr><th>Merchant</th><th>City · Language</th><th>Avg daily GMV</th><th>30-day trend</th><th>Device</th><th>KYC</th><th>Credit</th><th></th></tr></thead><tbody>
      ${list.map(m => `<tr>
        <td><b>${esc(m.name)}</b><br><small style="color:var(--mute)">${esc(m.owner)} · with Paytm ${m.tenureMonths >= 12 ? Math.floor(m.tenureMonths / 12) + " yr" : m.tenureMonths + " mo"}</small></td>
        <td>${esc(m.city)}<br><small style="color:var(--mute)">${esc(m.language)}</small></td>
        <td><b>${inr(m.avgDaily)}</b><br><small style="color:${m.growthPct >= 0 ? 'var(--green)' : 'var(--red)'}">${m.growthPct >= 0 ? '+' : ''}${m.growthPct}% (14d)</small></td>
        <td>${spark(m.trend)}</td>
        <td><span class="tag ${m.device.status === 'online' ? 't-green' : m.device.status === 'replacing' ? 't-amber' : 't-red'}">${m.device.status}</span><br><small style="color:var(--mute)">${esc(m.device.model)}</small></td>
        <td><span class="tag ${m.kycDays <= 7 ? 't-red' : m.kycDays <= 30 ? 't-amber' : 't-gray'}">${m.kycDays} days</span></td>
        <td>${m.activeLoan ? '<span class="tag t-violet">active loan</span>' : '<span class="tag t-gray">none</span>'}${m.openTickets ? `<br><span class="tag t-red" style="margin-top:4px">${m.openTickets} open ticket</span>` : ''}</td>
        <td><button class="btn gh sm" onclick="deploy({goal:'Do a full health check for ${esc(m.name)} (${m.id}) and fix anything that is wrong'})">Ask Dost</button></td>
      </tr>`).join('')}
      </tbody></table>${list.length ? '' : '<div class="empty">No merchants match.</div>'}
    </div>`;
    if (had) { const i = $('#mSearch'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
};
