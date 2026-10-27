let pols = null, polSel = null, polDirty = false;

async function loadPolicies() { pols = await api('/api/policies'); polSel ??= pols[0]?.name; }
function selectPolicy(n) { if (polDirty && !confirm('Discard unsaved policy changes?')) return; polSel = n; polDirty = false; window.page.render(S, true); }
async function savePolicyDraft() {
  const raw = $('#polText').value;
  try {
    const put = () => fetch(`/api/policies/${polSel}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
    let r = await put();
    if (r.status === 401) { await signIn(); r = await put(); }
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    polDirty = false; pols = null;
    toast('📜', 'Policy saved — guardrails updated live', JSON.stringify(j.params));
    window.page.render(S, true);
  } catch (e) { toast('⚠️', 'Policy not saved', e.message); }
}

window.page = {
  async render(S, force) {
    // Never clobber a policy someone is editing.
    if (!force && (polDirty || document.activeElement?.id === 'polText')) return;
    if (!pols) await loadPolicies();
    const a = S.settings.autonomy, cur = pols.find(p => p.name === polSel) || pols[0];
    const byKind = {};
    for (const t of S.tools) (byKind[t.kind] ||= []).push(t);
    $('#view').innerHTML = `<div class="phead"><div><h1>Brain & Policies</h1><p class="sub">Dost's behaviour is configured in plain language, not code. Edit a policy and the guardrails change instantly — then prove it on the Trust page.</p></div></div>
    <div class="grid row3" style="grid-template-columns:1.35fr 1fr">
      <div class="grid" style="align-content:start">
        <div class="card policy"><div class="ch"><h3>📜 Standard operating procedures</h3><small>Frontmatter drives guardrails · body guides the planner</small></div>
          <div class="ptabs">${pols.map(p => `<button class="${p.name === cur.name ? 'on' : ''}" onclick="selectPolicy('${p.name}')">${esc(p.title)}</button>`).join('')}</div>
          <div style="padding:14px 18px 6px"><textarea id="polText" spellcheck="false" oninput="polDirty=true">${esc(cur.raw)}</textarea></div>
          <div style="display:flex;gap:8px;align-items:center;padding:0 18px 16px;flex-wrap:wrap">
            ${Object.entries(cur.params).filter(([k]) => k !== 'title').map(([k, v]) => `<span class="tag t-cyan mono">${esc(k)} = ${esc(Array.isArray(v) ? v.join(', ') : v)}</span>`).join('')}
            <button class="btn pri sm" style="margin-left:auto" onclick="savePolicyDraft()">Save policy</button>
          </div>
        </div>
        <div class="card"><div class="ch"><h3>🧠 Learned playbook</h3><small>${S.rules.length} rule${S.rules.length === 1 ? '' : 's'} taught by teammates</small></div>
          ${S.rules.length ? S.rules.map(r => `<div class="rule"><span class="n">${r.id}</span><div><p>${esc(r.text)}</p><small>Taught by ${esc(r.by)} · ${ago(r.createdAt)} · <a href="/app/missions?id=${r.fromMission}" style="text-decoration:underline">see where it learned this</a> · applied ${r.uses}×</small></div></div>`).join('')
            : '<div class="empty">No rules yet. Click <b>Approve & teach</b> on an approval — the next similar action will run without asking.</div>'}
        </div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="ch"><h3>🎚️ Autonomy dial</h3><small>Changes take effect instantly</small></div>
          <div style="padding:16px 18px 6px">${[1, 2, 3].map(n => `<button class="dl ${a === n ? 'on' : ''}" onclick="setAutonomy(${n})"><b>L${n} · ${AUTONOMY[n][0]}</b><small>${AUTONOMY[n][1]}</small></button>`).join('')}</div>
        </div>
        <div class="card"><div class="ch"><h3>🛠️ Capabilities</h3><small>${S.tools.length} tools · each risk-gated</small></div>
          ${Object.entries(byKind).map(([k, ts]) => `<div class="gr" style="align-items:flex-start"><span style="text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:.05em;min-width:70px">${k}</span><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">${ts.map(t => `<span class="tag ${t.risk === 3 ? 't-red' : t.risk === 2 ? 't-amber' : t.risk === 1 ? 't-cyan' : t.risk === 'by amount' ? 't-violet' : 't-gray'}" title="${esc(t.description)}">${esc(t.name)}${t.risk ? ' · ' + (typeof t.risk === 'number' ? RISK[t.risk] : t.risk) : ''}</span>`).join('')}</div></div>`).join('')}
        </div>
      </div>
    </div>`;
  }
};
