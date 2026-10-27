const INCIDENT_LABEL = { device: '🔊 Device outage', settlement: '💸 Failed settlement', complaint: '🔥 Angry customer', kyc: '🛡️ KYC deadline', growth: '📈 Growth spike' };

async function injectIncident(t) {
  try { await api(`/api/simulate/${t}`, {}); toast('🧪', 'Incident injected', `${INCIDENT_LABEL[t]} — watch the Radar pick it up`); }
  catch (e) { toast('⚠️', 'Simulation failed', e.message); }
}
async function closeHandoff(id) { await api(`/api/handoffs/${id}/close`, {}); }

window.page = {
  render(S) {
    const m = S.metrics;
    const working = new Set(S.missions.filter(x => x.status === 'running').map(x => x.agent));
    const openHo = S.handoffs.filter(h => h.status === 'open');
    $('#view').innerHTML = `
    <div class="hero">
      <div style="position:relative;z-index:1">
        <span class="tag t-green"><span class="dot"></span> ${m.merchants} merchants monitored · ${inr(m.gmvToday)} processed since boot</span>
        <h1>Dost doesn't just answer. <span class="grad">It gets the job done.</span></h1>
        <p class="sub">Your autonomous teammate for merchant sales & service. It spots problems in live data, calls merchants in their language, fixes issues end-to-end, verifies the result — and brings in a human only when it should.</p>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
          ${S.signals[0] ? `<button class="btn pri" onclick="deploy({signalId:'${S.signals[0].id}'})">▶ Deploy on top signal</button>` : ''}
          <button class="btn gh" onclick="openPal()">✦ Give Dost a goal</button>
          <a class="btn gh" href="/app/missions">View missions →</a>
        </div>
      </div>
      <div class="orb"><i></i><i></i><i></i></div>
    </div>
    ${kpiTiles(m)}
    <div class="card" style="margin-top:18px"><div class="ch"><h3>🧬 Live agent mesh</h3><small>Signals flow into Dost's core and out to specialist agents in real time</small></div><div id="neuralSlot"></div></div>
    <div class="grid row2">
      <div class="card">
        <div class="ch"><h3>📡 Proactive Radar</h3><small>${S.signals.length} signals computed from live data</small></div>
        ${S.signals.length ? S.signals.slice(0, 8).map(s => `<div class="sig">
          <div class="sev ${SEV[s.severity][0]}">${SIG_ICON[s.type]}</div>
          <div><b>${esc(s.title)}</b><small>${esc(s.detail)}</small></div>
          <div class="right"><span class="tag ${SEV[s.severity][0]}">${s.severity}</span><button class="btn cy sm" onclick="deploy({signalId:'${s.id}'})">Deploy</button></div>
        </div>`).join('') : '<div class="empty">All clear — no signals right now.<br>Inject an incident below to see Dost react.</div>'}
      </div>
      <div class="card"><div class="ch"><h3>⚡ Live activity</h3><small><span class="dot"></span> streaming</small></div>
        <div class="feed">${S.feed.length ? S.feed.map(f => { const a = AGENTS[f.agent] || AGENTS.triage; return `<div class="fi"><div class="ic" style="background:${a.c}1A;color:${a.c}">${a.g}</div><div><p><b>${a.n}</b> · ${f.text}</p><time>${ago(f.at)}</time></div></div>`; }).join('') : '<div class="empty">No activity yet — deploy a mission.</div>'}</div>
      </div>
    </div>
    <div class="grid row3">
      <div class="card"><div class="ch"><h3>🤖 Agent squad</h3><small>Specialists behind one teammate</small></div>
        <div class="squad">${Object.entries(AGENTS).filter(([k]) => k !== 'human').map(([k, a]) => `<div class="ag"><div class="gl" style="background:${a.c}">${a.g}</div><div><b>${a.n}</b><small>${working.has(k) ? '<span style="color:var(--green);font-weight:600">● Working now</span>' : a.role}</small></div></div>`).join('')}</div>
      </div>
      <div class="card"><div class="ch"><h3>👥 Human teammates</h3><small>${openHo.length} open hand-off${openHo.length === 1 ? '' : 's'}</small></div>
        ${S.team.map(t => `<div class="sig"><div class="av" style="background:${t.color}">${initials(t.name)}</div><div><b>${esc(t.name)}</b><small>${t.role}</small></div><div class="right"><span class="tag ${t.openHandoffs ? 't-violet' : 't-gray'}">${t.openHandoffs} hand-off${t.openHandoffs === 1 ? '' : 's'}</span></div></div>`).join('')}
        ${openHo.slice(0, 3).map(h => `<div class="sig" style="background:#FBFAFF"><div class="sev t-violet">🤝</div><div><b>${esc(h.summary)}</b><small>→ ${esc(h.toName)} · ${esc(h.recommended_action)}</small></div><div class="right"><button class="btn gh sm" onclick="closeHandoff('${h.id}')">Mark done</button></div></div>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-top:18px"><div class="ch"><h3>🧪 Chaos lab</h3><small>Inject a real incident into the simulator — Dost has to find and fix it</small></div>
      <div class="chaos">${S.incidents.map(t => `<button class="btn gh" onclick="injectIncident('${t}')">${INCIDENT_LABEL[t]}</button>`).join('')}</div>
    </div>`;
    mountNeural();
  }
};

/* ---- Live agent mesh (canvas) — persists across re-renders ---- */
let mesh = null;
const SEV_COLOR = { critical: '#F04438', high: '#F79009', regulatory: '#7A5AF8', opportunity: '#12B76A' };
function mountNeural() {
  const slot = $('#neuralSlot');
  if (!slot) return;
  if (mesh) { slot.replaceWith(mesh.el); return; }
  const el = document.createElement('div');
  el.className = 'neural';
  el.innerHTML = `<canvas></canvas><div class="legend"><span><i style="background:#F04438"></i>critical</span><span><i style="background:#F79009"></i>high</span><span><i style="background:#7A5AF8"></i>regulatory</span><span><i style="background:#12B76A"></i>opportunity</span><span><i style="background:#00B9F1"></i>work in flight</span></div>`;
  slot.replaceWith(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const parts = [], lastSpawn = {};
  mesh = { el };
  const agentKeys = Object.keys(AGENTS).filter(k => k !== 'human');

  function frame(t) {
    requestAnimationFrame(frame);
    if (!el.isConnected || document.hidden) return;
    const r = el.getBoundingClientRect(), dpr = devicePixelRatio || 1, w = r.width, h = r.height;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 - 8, rot = t * 0.00004;
    const pos = {};
    agentKeys.forEach((k, i) => { const a = i / agentKeys.length * Math.PI * 2 - Math.PI / 2 + rot; pos[k] = [cx + Math.cos(a) * Math.min(w * 0.26, 250), cy + Math.sin(a) * h * 0.30]; });
    const sigs = (S?.signals || []).slice(0, 10);
    const sp = sigs.map((s, i) => { const a = (i + 0.5) / Math.max(sigs.length, 1) * Math.PI * 2 - Math.PI / 2 - rot * 0.6; return [cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * h * 0.42]; });

    // edges
    ctx.lineWidth = 1;
    for (const k of agentKeys) { ctx.strokeStyle = 'rgba(1,42,114,.10)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...pos[k]); ctx.stroke(); }
    sigs.forEach((s, i) => { ctx.setLineDash([3, 5]); ctx.strokeStyle = SEV_COLOR[s.severity] + '55'; ctx.beginPath(); ctx.moveTo(...sp[i]); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]); });

    // particles for in-flight missions
    for (const m of (S?.missions || []).filter(x => x.status === 'running' || x.status === 'waiting')) {
      const to = m.status === 'waiting' ? 'compliance' : (m.agent || 'triage');
      if (!lastSpawn[m.id] || t - lastSpawn[m.id] > 420) { lastSpawn[m.id] = t; parts.push({ to, t0: t, c: m.status === 'waiting' ? '#F79009' : '#00B9F1' }); }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i], k = (t - p.t0) / 950;
      if (k >= 1 || !pos[p.to]) { parts.splice(i, 1); continue; }
      const [tx, ty] = pos[p.to], x = cx + (tx - cx) * k, y = cy + (ty - cy) * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9); g.addColorStop(0, p.c); g.addColorStop(1, p.c + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
    }

    // signal nodes
    ctx.font = '600 10.5px Inter, sans-serif'; ctx.textAlign = 'center';
    sigs.forEach((s, i) => {
      const [x, y] = sp[i], pulse = 1 + Math.sin(t / 400 + i) * 0.15;
      ctx.fillStyle = SEV_COLOR[s.severity] + '22'; ctx.beginPath(); ctx.arc(x, y, 13 * pulse, 0, 7); ctx.fill();
      ctx.fillStyle = SEV_COLOR[s.severity]; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#43506B'; ctx.fillText(s.title.length > 26 ? s.title.slice(0, 25) + '…' : s.title, x, y + 24);
    });

    // agent nodes
    const busy = new Set((S?.missions || []).filter(x => x.status === 'running').map(x => x.agent));
    for (const k of agentKeys) {
      const [x, y] = pos[k], a = AGENTS[k];
      if (busy.has(k)) { ctx.fillStyle = a.c + '30'; ctx.beginPath(); ctx.arc(x, y, 26 + Math.sin(t / 220) * 3, 0, 7); ctx.fill(); }
      ctx.fillStyle = a.c; ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText(a.g, x, y + 4);
      ctx.fillStyle = '#0B1B3F'; ctx.font = '600 11.5px Inter, sans-serif'; ctx.fillText(a.n, x, y + 34);
    }

    // core
    const pr = 30 + Math.sin(t / 600) * 2;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr * 2.4); halo.addColorStop(0, 'rgba(0,185,241,.28)'); halo.addColorStop(1, 'rgba(0,185,241,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, pr * 2.4, 0, 7); ctx.fill();
    const core = ctx.createLinearGradient(cx - pr, cy - pr, cx + pr, cy + pr); core.addColorStop(0, '#00B9F1'); core.addColorStop(1, '#012A72');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, pr, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 14px Inter, sans-serif'; ctx.fillText('DOST', cx, cy + 5);
  }
  requestAnimationFrame(frame);
}
