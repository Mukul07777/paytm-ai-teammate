const KIND_LABEL = { think: 'REASON', tool: 'READ', action: 'ACTION', comms: 'COMMS', twin: 'SIMULATE', auto: 'GUARDRAIL', wait: 'APPROVAL', approved: 'APPROVED', rejected: 'REJECTED', handoff: 'HAND-OFF', verify: 'VERIFIED', error: 'ERROR' };
const KIND_TINT = { wait: 't-amber', approved: 't-green', rejected: 't-red', auto: 't-violet', handoff: 't-violet', verify: 't-green', twin: 't-cyan', error: 't-red', action: 't-cyan' };

const fmtVal = v => Array.isArray(v) ? (v.length && typeof v[0] === 'object' ? `[${v.length} items]` : v.join(', ')) : (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}=${typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ') : String(v));
const kv = o => Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<span class="k">${esc(k)}:</span> ${esc(fmtVal(v))}`).join('<br>');
const args = o => Object.entries(o || {}).filter(([k]) => !['message', 'text', 'brief'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.length > 40 ? v.slice(0, 40) + '…' : v}"` : Array.isArray(v) ? `[${v.length}]` : v}`).join(', ');

const DOING = {
  get_merchant_profile: 'Reading the merchant’s profile', get_device_health: 'Checking device health', remote_reboot_device: 'Trying a remote recovery',
  enable_fallback_alerts: 'Sending payment alerts to the merchant’s phone', dispatch_replacement_device: 'Dispatching a replacement device', list_settlements: 'Tracing recent settlements',
  check_duplicate_risk: 'Making sure nothing gets paid twice', retry_settlement: 'Re-sending the settlement', simulate_action: 'Rehearsing the fix on a digital twin',
  place_call: 'Calling', send_message: 'Sending an update', score_credit_eligibility: 'Checking credit eligibility', request_consent: 'Sharing terms and asking for consent',
  submit_loan_application: 'Submitting the loan application', get_ticket: 'Reading the complaint', check_transaction: 'Confirming the debit in the ledger',
  initiate_reversal: 'Reversing the extra debit', resolve_ticket: 'Closing the ticket', handoff_to_human: 'Handing over to a teammate',
  list_kyc_due: 'Finding merchants due for re-KYC', run_kyc_campaign: 'Sending re-KYC reminders', list_signals: 'Scanning for work', find_merchants: 'Looking up merchants'
};
function resultLine(s) {
  const o = s.output || {};
  if (o.error) return o.error === 'REJECTED_BY_HUMAN' ? 'Declined by a teammate — not done.' : o.error;
  switch (s.tool) {
    case 'get_merchant_profile': return `${o.name} · ${o.city} · speaks ${o.language} · ${inr(o.avg_daily_gmv)}/day`;
    case 'get_device_health': return o.status === 'online' ? 'Device is healthy' : `Offline ${o.last_heartbeat_hours_ago}h · signal ${o.sim_signal} · battery ${o.battery}`;
    case 'remote_reboot_device': return o.recovered ? '✓ Back online' : `✗ ${o.detail}`;
    case 'enable_fallback_alerts': return '✓ Alerts now go to the merchant’s phone';
    case 'dispatch_replacement_device': return o.already_dispatched ? 'Already on its way' : `✓ ${o.field_agent} is on the way · ~${o.eta_minutes} min`;
    case 'list_settlements': return `${o.length} recent settlements found`;
    case 'check_duplicate_risk': return o.safe_to_retry ? '✓ Safe — no duplicate possible' : '✗ Not safe to retry';
    case 'retry_settlement': return o.success ? `✓ ${inr(o.amount)} credited via ${o.rail}` : `✗ ${o.detail}`;
    case 'simulate_action': return `${o.recommended ? '✓' : '⚠'} ${o.after}`;
    case 'score_credit_eligibility': return o.eligible ? `✓ Eligible for ${inr(o.limit)} · EMI ${inr(o.daily_emi)}/day` : `Not eligible · ${o.reasons.join('; ')}`;
    case 'request_consent': return o.consent === 'granted' ? '✓ Consent given' : 'Merchant said no — respected';
    case 'submit_loan_application': return `✓ Sanctioned · disbursal today`;
    case 'get_ticket': return `“${o.text}”`;
    case 'check_transaction': return `Debited twice · ${inr(o.amount)}`;
    case 'initiate_reversal': return `✓ Reversal started · back in ${o.eta}`;
    case 'resolve_ticket': return '✓ Ticket closed';
    case 'list_kyc_due': return `${o.count} merchants due`;
    case 'run_kyc_campaign': return `✓ Reached ${o.delivered} · ${o.completed_video_kyc} done already`;
    case 'handoff_to_human': return `✓ Now with ${o.handed_to}`;
    default: return Array.isArray(s.output) ? `${s.output.length} found` : '✓ Done';
  }
}

function stepHTML(s) {
  const a = AGENTS[s.agent] || AGENTS.triage;
  let body = s.text ? `<p>${esc(s.text)}</p>` : `<p>${esc(DOING[s.tool] || s.label)}${s.tool === 'place_call' ? ' ' + esc(s.output?.callee || '') : ''}</p>`;
  if (s.learned) body = `<div class="callout t-violet">🧠 ${esc(s.text)}</div>`;
  if (s.tool) {
    const out = s.output || {};
    const bad = out.error || out.success === false || out.recovered === false || out.safe_to_retry === false;
    if (!s.pending && !['place_call', 'send_message', 'handoff_to_human'].includes(s.tool)) body += `<div class="callout ${bad ? 't-red' : 't-gray'}">${esc(resultLine(s))}</div>`;
    if (!s.pending) body += `<details style="margin-top:6px"><summary style="font-size:11.5px;color:var(--mute);cursor:pointer">Details</summary><div class="code"><span class="fn">${esc(s.tool)}</span>(${esc(args(s.input))})<br><span class="${bad ? 'er' : 'ok'}">${Array.isArray(s.output) ? s.output.slice(0, 4).map(r => esc(fmtVal(r))).join('<br>') : kv(out)}</span></div></details>`;
    if (s.tool === 'send_message' && !s.pending) body += `<div class="msg">${esc(s.input.text)}<small>${s.input.channel === 'sms' ? 'SMS' : 'WhatsApp'} → ${esc(out.to)} · delivered ✓✓</small></div>`;
    if (s.tool === 'place_call' && !s.pending && out.reply) body += `<div class="msg" style="background:#fff;border-color:var(--line)"><b style="font-size:11px;color:var(--mute)">DOST:</b> ${esc(s.input.message)}<br><b style="font-size:11px;color:var(--mute)">${esc(out.callee).toUpperCase()}:</b> ${esc(out.reply)}</div>`;
    if (s.tool === 'handoff_to_human' && !s.pending) body += `<div class="brief"><b style="font-size:12px;color:#5925DC">BRIEF FOR ${esc(out.handed_to || '').toUpperCase()}</b><ul style="margin-top:6px">${(s.input.brief || []).map(b => `<li>${esc(b)}</li>`).join('')}</ul><p style="font-size:12.5px;margin-top:6px"><b>Recommended:</b> ${esc(s.input.recommended_action)}</p></div>`;
  }
  if (s.k === 'wait') body += `<a class="btn pri sm" style="margin-top:8px" href="/app/approvals">Review in Approvals →</a>`;
  if (s.pending) body += `<div class="thinking"><i></i><i></i><i></i></div>`;
  return `<div class="step"><div class="sn" style="background:${a.c}">${a.g}</div><div><div class="hd"><b>${a.n}</b><span class="kind ${KIND_TINT[s.k] || ''}">${KIND_LABEL[s.k] || s.k}</span><span>${clock(s.at)}</span></div>${body}</div></div>`;
}

let lastSteps = -1, lastId = null;
const spoken = {};

function toggleVoice() { setVoice(!voiceOn()); window.page.render(S); toast('🔊', voiceOn() ? 'Voice on' : 'Voice off', voiceOn() ? 'Dost will speak live call lines aloud' : 'Calls are text only'); }
async function retry(id) {
  try { const m = await api(`/api/missions/${id}/retry`, {}); location.href = `/app/missions?id=${m.id}`; }
  catch (e) { toast('⚠️', 'Retry failed', e.message); }
}

// Speak only lines that arrive while you're watching — never replay history.
function speakNew(m) {
  if (!(m.id in spoken)) { spoken[m.id] = m.calls.length; return; }
  const lang = m.calls.find(c => c.language)?.language;
  for (const c of m.calls.slice(spoken[m.id])) speak(c.text, lang, c.who);
  spoken[m.id] = m.calls.length;
}

window.page = {
  async render(S) {
    const params = new URLSearchParams(location.search);
    const id = params.get('id') || S.missions[0]?.id;
    if (!id) {
      $('#view').innerHTML = `<div class="phead"><div><h1>Live Missions</h1><p class="sub">Each mission is an outcome Dost owns from start to finish.</p></div></div>
        <div class="card" style="margin-top:18px"><div class="empty" style="padding:70px"><div style="font-size:38px">🎯</div><h3 style="justify-content:center;margin:10px 0 6px;color:var(--ink)">No missions yet</h3>Deploy one from the Proactive Radar or press Ctrl K.<br><br>
        ${S.signals[0] ? `<button class="btn pri" onclick="deploy({signalId:'${S.signals[0].id}'})">▶ Deploy on “${esc(S.signals[0].title)}”</button>` : ''}</div></div>`;
      return;
    }
    const m = await api(`/api/missions/${id}`);
    const tl = $('.tl'), atBottom = !tl || tl.scrollHeight - tl.scrollTop - tl.clientHeight < 60;
    const last = m.calls.filter(c => c.who === 'callee').at(-1);
    const sentiment = last ? last.sentiment : null;
    const callLang = m.calls.find(c => c.language)?.language;
    const live = m.status === 'running' && m.steps.at(-1)?.tool === 'place_call' && m.steps.at(-1)?.pending;

    $('#view').innerHTML = `<div class="phead"><div><h1>Live Missions</h1><p class="sub">Plan → Simulate → Act → Verify. Every step is a real tool call against live data.</p></div><div style="display:flex;gap:8px"><button class="btn gh" onclick="toggleVoice()">${voiceOn() ? '🔊 Voice on' : '🔈 Voice off'}</button>${['failed', 'interrupted', 'noop'].includes(m.status) ? `<button class="btn gh" onclick="retry('${m.id}')">↻ Retry</button>` : ''}<button class="btn pri" onclick="openPal()">✦ New mission</button></div></div>
    <div class="mwrap">
      <div class="card mlist">${S.missions.map(x => `<a class="mi ${x.id === m.id ? 'on' : ''}" href="?id=${x.id}">
        <div style="display:flex;justify-content:space-between;gap:8px"><span class="st ${x.status}">${STATUS[x.status]}</span><small>${ago(x.createdAt)}</small></div>
        <b>${SIG_ICON[x.signalType] || '✦'} ${esc(x.title)}</b><small>${esc(x.merchantName || 'Goal-driven')}${x.city ? ' · ' + esc(x.city) : ''} · ${x.steps} steps</small></a>`).join('')}</div>
      <div class="mdet">
        <div class="card">
          <div class="mhead">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="st ${m.status}">${STATUS[m.status]}</span><span class="tag ${m.mode === 'llm' ? 't-violet' : 't-gray'}">${m.mode === 'llm' ? '🧠 LLM-planned' : '⚙️ Playbook'}</span><small style="color:var(--mute)">Started ${clock(m.createdAt)}</small></div>
            <h2>${SIG_ICON[m.signalType] || '✦'} ${esc(m.title)}</h2>
            <small style="color:var(--ink2);line-height:1.5;display:block">${esc(m.goal)}</small>
            ${m.outcome ? `<div class="callout ${m.status === 'handoff' ? 't-violet' : m.status === 'done' ? 't-green' : 't-amber'}" style="margin-top:12px">🏁 Outcome: ${esc(m.outcome)}</div>` : ''}
          </div>
          <div class="tl">${m.steps.map(stepHTML).join('') || '<div class="empty">Planning…</div>'}${m.status === 'running' && !m.steps.at(-1)?.pending ? '<div class="step"><div class="sn" style="background:var(--mute)">…</div><div><div class="thinking"><i></i><i></i><i></i></div></div></div>' : ''}</div>
        </div>
        <div class="grid" style="align-content:start">
          <div class="card">
            <div class="callh"><div class="av" style="background:rgba(255,255,255,.18)">📞</div><div><b style="font-size:13.5px">${m.calls.length ? (live ? 'Live call' : 'Voice channel') : 'Voice channel'}</b><small>${m.calls.length ? esc(last?.name || '') + ' · ' + esc(callLang || '') : 'Idle — Dost calls when it helps'}</small></div>
              <div class="wave ${live ? '' : 'off'}">${[10, 18, 8, 20, 12, 16, 6, 14].map((h, i) => `<i style="height:${h}px;animation-delay:${i * 0.1}s"></i>`).join('')}</div></div>
            ${m.calls.length ? `<div class="tx">${m.calls.map(c => `<div class="bub ${c.who}"><small>${c.who === 'dost' ? 'Dost' : esc(c.name)}</small>${esc(c.text)}</div>`).join('')}</div>
            <div class="sent"><div class="lbl"><span>Live sentiment</span><b style="color:var(--ink)">${sentiment == null ? '—' : sentiment < -0.3 ? 'Upset' : sentiment < 0.3 ? 'Neutral' : 'Positive'} (${sentiment ?? '—'})</b></div><div class="meter"><i style="left:${((sentiment ?? 0) + 1) * 50}%"></i></div></div>` : '<div class="empty">No calls in this mission</div>'}
          </div>
          <div class="card"><div class="ch"><h3>🧪 Digital twin</h3><small>Simulate before act</small></div>
            ${m.twin ? `<div class="ba"><div class="bx t-red"><b>BEFORE</b>${esc(m.twin.before)}</div><div style="text-align:center;color:var(--mute)">→</div><div class="bx ${m.twin.recommended ? 't-green' : 't-amber'}"><b>PREDICTED</b>${esc(m.twin.after)}</div></div>
              <div class="checks">${(m.twin.checks || []).map(c => `• ${esc(c)}`).join('<br>')}</div>` : '<div class="empty">Dost simulates money and asset actions on a digital twin before running them.</div>'}
          </div>
          <div class="card"><div class="ch"><h3>📊 Mission impact</h3><small>Measured, not claimed</small></div>
            <div class="impact"><div><b>${m.minutesSaved} min</b><small>human effort saved</small></div><div><b>${inr(m.revenue)}</b><small>revenue influenced</small></div><div><b>${inr(m.protected)}</b><small>money protected</small></div><div><b>${m.approvalsNeeded}</b><small>human approvals</small></div></div>
          </div>
        </div>
      </div>
    </div>`;
    const t2 = $('.tl');
    if (t2 && (atBottom || lastId !== m.id || m.steps.length !== lastSteps)) t2.scrollTop = t2.scrollHeight;
    const tx = $('.tx'); if (tx) tx.scrollTop = tx.scrollHeight;
    lastSteps = m.steps.length; lastId = m.id;
    speakNew(m);
  }
};
