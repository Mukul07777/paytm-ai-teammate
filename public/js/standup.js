window.page = {
  async render() {
    const d = await api('/api/standup'), m = d.metrics;
    const langs = Object.entries(d.languages).map(([k, v]) => `${v} in ${k}`).join(', ');
    const li = (arr, f, empty) => arr.length ? arr.map(f).join('') : `<li style="color:var(--mute)">${empty}</li>`;
    $('#view').innerHTML = `<div class="card doc">
      <span class="tag t-cyan">Generated from live data · ${new Date(d.generatedAt).toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
      <h2>Dost's stand-up for the team 👋</h2>
      <p class="sub" style="font-size:14px">The last 24 hours — what I did, what I learned, and where I need you.</p>
      <div class="stats"><div><b>${m.resolved}</b><small>resolved by me</small></div><div><b>${m.handoffs}</b><small>handed off with briefs</small></div><div><b>${inr(m.revenue)}</b><small>revenue influenced</small></div><div><b>${m.minutesSaved} min</b><small>human time saved</small></div></div>
      <h4>✅ What I did</h4><ul>${li(d.done, x => `<li><b>${esc(x.title)}</b>${x.merchant ? ' — ' + esc(x.merchant) : ''}: ${esc(x.outcome || 'completed')}</li>`, 'Nothing completed yet today.')}
        ${langs ? `<li>Spoke on calls ${esc(langs)}</li>` : ''}</ul>
      <h4>🤝 Handed to humans</h4><ul>${li(d.handoffs, h => `<li><b>${esc(h.to)}</b> — ${esc(h.summary)} <span style="color:var(--mute)">(${h.status}; suggested: ${esc(h.recommended)})</span></li>`, 'No hand-offs.')}</ul>
      <h4>🧠 What I learned</h4><ul>${li(d.learned, r => `<li>${r.id}: <b>${esc(r.text)}</b> — applied ${r.uses}× since</li>`, 'No new rules today.')}</ul>
      <h4>🎯 Today's focus (from the Radar)</h4><ul>${li(d.focus, f => `<li><b>${esc(f.title)}</b> — ${esc(f.detail)}</li>`, 'Radar is clear.')}</ul>
      <h4>🙋 Waiting on you</h4><ul>${li(d.waiting, w => `<li><b>${esc(w.label)}</b>${w.merchant ? ' for ' + esc(w.merchant) : ''}${w.amount != null ? ' · ' + inr(w.amount) : ''} — <a href="/app/approvals" style="text-decoration:underline">review</a></li>`, 'Nothing pending.')}</ul>
    </div>`;
  }
};
