async function decideApproval(id, action) {
  try { await api(`/api/approvals/${id}`, { action }); }
  catch (e) { toast('⚠️', 'Could not record decision', e.message); }
}

window.page = {
  render(S) {
    $('#view').innerHTML = `<div class="phead"><div><h1>Approvals</h1><p class="sub">Dost only asks when an action's risk exceeds its autonomy level. Approve once — or <b>teach it</b>, so similar cases never need you again.</p></div></div>
    <div class="card" style="margin-top:18px">${S.approvals.length ? S.approvals.map(a => {
      const tint = a.risk === 3 ? 't-red' : a.risk === 2 ? 't-amber' : 't-cyan';
      return `<div class="ap">
        <div class="risk ${tint}">${a.risk === 3 ? '⚠' : '✋'}</div>
        <div>
          <span class="tag ${tint}">${RISK[a.risk]} risk</span> <small style="color:var(--mute)">${ago(a.createdAt)} · <a href="/app/missions?id=${a.missionId}" style="text-decoration:underline">View mission</a></small><br>
          <b>${esc(a.label)}${a.amount != null ? ' · ' + inr(a.amount) : ''}</b>
          <p>${esc(a.merchant || "")}</p>
          ${a.preview ? `<p>🧪 Digital twin: <b>${esc(a.preview.after)}</b> · ${esc((a.preview.checks || []).join(' · '))}</p>` : ''}
          ${a.teachable ? `<div class="teach">🧠 Teachable — “Approve & teach” creates a rule for “${esc(a.label)}”${a.amount != null ? ' up to this amount' : ''}</div>` : `<div class="teach t-red">🔒 High-risk — always requires a human by policy</div>`}
        </div>
        <div class="acts">
          <button class="btn no sm" onclick="decideApproval('${a.id}','reject')">Reject</button>
          <button class="btn ok sm" onclick="decideApproval('${a.id}','approve')">Approve</button>
          ${a.teachable ? `<button class="btn pri sm" onclick="decideApproval('${a.id}','teach')">Approve & teach</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="empty" style="padding:64px"><div style="font-size:34px">🎉</div><br>Inbox zero. Dost is handling everything within its guardrails.<br>Tip: set autonomy to <b>L1</b> to see every gated action come here.</div>'}</div>`;
  }
};
