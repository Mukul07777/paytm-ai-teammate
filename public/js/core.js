// Shared console runtime: shell, API, live updates, command palette, toasts.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => {
  n = Math.round(n || 0);
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
};
const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const clock = t => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// One shared sign-in prompt; the server answers with an HttpOnly session cookie.
let signingIn = null;
function signIn() {
  return signingIn ||= (async () => {
    for (let msg = 'Enter your Dost access token'; ;) {
      const token = window.prompt(msg);
      if (token === null) throw new Error('Sign in required');
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (r.ok) return;
      msg = r.status === 429 ? 'Too many attempts — wait a minute, then enter your token' : 'That token was not accepted. Try again';
    }
  })().finally(() => { signingIn = null; });
}

async function api(path, body, retried) {
  const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401 && !retried) { await signIn(); return api(path, body, true); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

const AGENTS = {
  triage: { n: 'Triage', c: '#7A5AF8', g: 'Tr', role: 'Detects & classifies' },
  resolver: { n: 'Resolver', c: '#00B9F1', g: 'Re', role: 'Fixes & executes' },
  growth: { n: 'Growth', c: '#12B76A', g: 'Gr', role: 'Sales & credit' },
  compliance: { n: 'Compliance', c: '#F79009', g: 'Co', role: 'Risk, policy, RBI' },
  voice: { n: 'Voice', c: '#0BA5EC', g: 'Vo', role: 'Calls & messages' },
  qa: { n: 'QA Auditor', c: '#E0457B', g: 'QA', role: 'Verifies outcomes' },
  human: { n: 'You', c: '#012A72', g: 'You' }
};
const SEV = { critical: ['t-red', '🚨'], high: ['t-amber', '⚠️'], regulatory: ['t-violet', '🛡️'], opportunity: ['t-green', '📈'] };
const SIG_ICON = { device_offline: '🔊', settlement_failed: '💸', complaint: '🔥', kyc_due: '🛡️', growth: '📈' };
const STATUS = { running: 'Running', waiting: 'Awaiting approval', done: 'Completed', handoff: 'Handed to human', failed: 'Failed', interrupted: 'Interrupted', noop: 'No action needed' };
const RISK = ['None', 'Low', 'Medium', 'High'];
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const NAV = [
  ['overview', '/app/', 'Command Center', '<path d="M3 12l9-8 9 8M5 10v10h14V10"/>'],
  ['missions', '/app/missions', 'Live Missions', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  ['approvals', '/app/approvals', 'Approvals', '<path d="M9 12l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="3"/>'],
  ['merchants', '/app/merchants', 'Merchants', '<path d="M4 7h16l-1 4H5zM5 11v9h14v-9M9 20v-5h6v5"/>'],
  ['brain', '/app/brain', 'Brain & Policies', '<path d="M12 3v18M8 7a3 3 0 00-4 3 3 3 0 001 5 3 3 0 006 1M16 7a3 3 0 014 3 3 3 0 01-1 5 3 3 0 01-6 1"/>'],
  ['trust', '/app/trust', 'Trust & Evals', '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'],
  ['standup', '/app/standup', 'Daily Stand-up', '<path d="M7 3h10l4 4v14H3V3h4zM8 11h8M8 15h6"/>']
];
const AUTONOMY = {
  1: ['Supervised', 'Dost asks before every gated action. Ideal for week one.'],
  2: ['Balanced', 'Low-risk actions run on their own; medium & high risk ask a human.'],
  3: ['Bold', 'Low & medium risk run on their own; high-risk stays human-gated.']
};

let S = null, active = null;

function shell() {
  document.body.insertAdjacentHTML('afterbegin', `
  <div class="app">
    <aside class="side">
      <a class="brand" href="/"><div class="logo">D</div><div><b>Dost</b><small>Autonomous AI Teammate</small></div></a>
      <nav class="nav" id="nav"></nav>
      <div class="dialcard"><h5><span>Autonomy level</span><span id="autoLbl" style="color:var(--navy)"></span></h5><div class="seg" id="seg"></div><p id="autoDesc"></p><div id="autoSw"></div><div id="modePill"></div></div>
    </aside>
    <main class="main" id="main">
      <div class="top">
        <div class="cmd" onclick="openPal()"><span class="spark">✦</span><span id="cmdHint">Give Dost a goal…</span><kbd>Ctrl K</kbd></div>
        <button class="mic" id="micBtn" onclick="toggleMic()" title="Speak a goal to Dost">🎙️</button>
        <div class="live"><span class="dot"></span><span id="liveTxt">connecting…</span></div>
      </div>
      <div class="view" id="view"></div>
    </main>
  </div>
  <div class="ov" id="ov" onclick="if(event.target===this)closePal()"><div class="pal">
    <input id="palIn" placeholder="Tell Dost what outcome you want…" autocomplete="off">
    <div class="sg" id="palSg"></div>
    <div class="ft"><span>↵ Deploy</span><span>↑↓ Navigate</span><span>Esc Close</span><span style="margin-left:auto">Plan → Simulate → Act → Verify</span></div>
  </div></div>
  <div class="toasts" id="toasts"></div>`);
}

function renderShell() {
  $('#nav').innerHTML = '<div class="navlabel">Workspace</div>' + NAV.map(([k, href, label, p], i) => `${i === 4 ? '<div class="navlabel">Intelligence</div>' : ''}
    <a href="${href}" class="${k === active ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>${label}
    ${k === 'approvals' && S.approvals.length ? `<span class="badge">${S.approvals.length}</span>` : ''}${k === 'missions' && S.metrics.live ? `<span class="badge" style="background:var(--cyan)">${S.metrics.live}</span>` : ''}</a>`).join('');
  const a = S.settings.autonomy;
  $('#seg').innerHTML = [1, 2, 3].map(n => `<button class="${a === n ? 'on' : ''}" onclick="setAutonomy(${n})">L${n}</button>`).join('');
  $('#autoLbl').textContent = AUTONOMY[a][0];
  $('#autoDesc').textContent = AUTONOMY[a][1];
  $('#autoSw').innerHTML = `<div class="switch ${S.settings.autopilot ? 'on' : ''}" onclick="setAutopilot(${!S.settings.autopilot})"><div>Autopilot<small>${S.settings.autopilot ? 'Dost picks up urgent work itself' : 'Off — missions start on demand'}</small></div><div class="tog"></div></div>`;
  $('#modePill').innerHTML = S.mode === 'llm'
    ? `<div class="modepill t-violet">🧠 Planner: <b>${esc(S.model)}</b></div>`
    : `<div class="modepill t-gray">⚙️ Planner: deterministic playbooks<br><span style="color:var(--mute)">Set ANTHROPIC_API_KEY for open-ended goals</span></div>`;
  $('#liveTxt').textContent = `${S.metrics.live} live mission${S.metrics.live === 1 ? '' : 's'} · ${S.signals.length} signals · ${S.metrics.devicesOnline}/${S.metrics.devices} devices online`;
  $('#cmdHint').textContent = S.signals[0] ? `Try: “${S.signals[0].title}” — or describe any outcome` : 'Give Dost a goal…';
}

async function setAutonomy(n) { await api('/api/settings', { autonomy: n }); toast('🎚️', `Autonomy L${n} · ${AUTONOMY[n][0]}`, AUTONOMY[n][1]); }

async function setAutopilot(on) { await api('/api/settings', { autopilot: on }); toast(on ? '🛸' : '⏸️', `Autopilot ${on ? 'on' : 'off'}`, on ? 'Dost will start missions for critical, high and regulatory signals on its own' : 'Missions start only when someone deploys them'); }

/* ---- Voice: browser speech synthesis & recognition (no keys needed) ---- */
const VOICE_LANG = { Hindi: 'hi-IN', Marathi: 'mr-IN', Gujarati: 'gu-IN', Punjabi: 'pa-IN', Tamil: 'ta-IN', Telugu: 'te-IN', Kannada: 'kn-IN', Malayalam: 'ml-IN', Bengali: 'bn-IN', English: 'en-IN' };
const voiceOn = () => { try { return localStorage.getItem('dost-voice') === '1'; } catch { return false; } };
function setVoice(on) { try { localStorage.setItem('dost-voice', on ? '1' : '0'); } catch { } if (!on) speechSynthesis?.cancel(); }
function speak(text, language, who) {
  if (!voiceOn() || !window.speechSynthesis) return;
  // Romanised Hinglish reads most naturally with an Indian-English voice.
  const want = /[ऀ-෿]/.test(text) ? (VOICE_LANG[language] || 'hi-IN') : 'en-IN';
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find(v => v.lang === want) || voices.find(v => v.lang.startsWith('en-IN')) || voices.find(v => v.lang.startsWith('en')) || null;
  u.lang = u.voice?.lang || want;
  u.pitch = who === 'dost' ? 1.05 : 0.85; u.rate = 1.02;
  speechSynthesis.speak(u);
}
let rec = null;
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('🎙️', 'Voice input not supported', 'Use Chrome or Edge for speech recognition');
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true;
  $('#micBtn').classList.add('rec');
  openPal();
  rec.onresult = e => { $('#palIn').value = [...e.results].map(r => r[0].transcript).join(''); drawPal(); };
  rec.onend = () => { $('#micBtn').classList.remove('rec'); rec = null; };
  rec.onerror = e => toast('🎙️', 'Mic error', e.error);
  rec.start();
}

/* ---- Animated numbers ---- */
const prevNums = {};
function animateNumbers(root = document) {
  root.querySelectorAll('[data-n]').forEach(el => {
    const key = el.dataset.key, to = Number(el.dataset.n), fmt = el.dataset.fmt;
    const from = prevNums[key] ?? 0; prevNums[key] = to;
    const f = v => fmt === 'inr' ? inr(v) : fmt === 'min' ? (v >= 60 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`) : fmt === 'pct' ? `${Math.round(v)}%` : Math.round(v).toLocaleString('en-IN');
    if (from === to) { el.textContent = f(to); return; }
    const t0 = performance.now();
    const tick = t => { const p = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - p, 3); el.textContent = f(from + (to - from) * e); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

async function deploy(body) {
  try { const m = await api('/api/missions', body); location.href = `/app/missions?id=${m.id}`; }
  catch (e) { toast('⚠️', 'Could not start mission', e.message); }
}

function toast(icon, title, text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="sev t-cyan">${esc(icon)}</div><div><b>${esc(title)}</b><small>${esc(text)}</small></div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ---- Command palette ---- */
let palIdx = 0, palItems = [];
function openPal() { $('#ov').classList.add('show'); $('#palIn').value = ''; palIdx = 0; drawPal(); setTimeout(() => $('#palIn').focus(), 20); }
function closePal() { $('#ov').classList.remove('show'); }
function drawPal() {
  const q = $('#palIn').value.trim();
  palItems = [];
  if (q) palItems.push({ icon: '✦', text: `Deploy goal: “${q}”`, hint: S.mode === 'llm' ? 'Claude plans it' : 'Playbook match', body: { goal: q } });
  const sigs = S.signals.filter(s => !q || (s.title + s.detail).toLowerCase().includes(q.toLowerCase()));
  for (const s of sigs.slice(0, 7)) palItems.push({ icon: SIG_ICON[s.type], text: `${s.title} — ${s.detail}`, hint: s.severity, body: { signalId: s.id } });
  $('#palSg').innerHTML = palItems.length ? palItems.map((it, i) => `<button class="${i === palIdx ? 'hl' : ''}" data-i="${i}"><span>${it.icon}</span>${esc(it.text)}<small>${esc(it.hint)}</small></button>`).join('')
    : '<div class="empty">No live signals. Type any goal.</div>';
  $('#palSg').querySelectorAll('button').forEach(b => b.onclick = () => { closePal(); deploy(palItems[+b.dataset.i].body); });
}

/* ---- Boot ---- */
async function refresh() {
  S = await api('/api/state');
  renderShell();
  await window.page?.render(S);
  animateNumbers();
}

function boot(name) {
  active = name;
  shell();
  $('#palIn').addEventListener('input', () => { palIdx = 0; drawPal(); });
  $('#palIn').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { palIdx = Math.min(palIdx + 1, palItems.length - 1); drawPal(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { palIdx = Math.max(palIdx - 1, 0); drawPal(); e.preventDefault(); }
    if (e.key === 'Enter' && palItems[palIdx]) { closePal(); deploy(palItems[palIdx].body); }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPal(); }
    if (e.key === 'Escape') closePal();
  });
  refresh().then(() => $('#view').classList.add('fade'));
  const spot = document.createElement('div'); spot.className = 'spot'; document.body.appendChild(spot);
  addEventListener('pointermove', e => { spot.style.left = e.clientX + 'px'; spot.style.top = e.clientY + 'px'; }, { passive: true });
  window.speechSynthesis?.getVoices();
  const es = new EventSource('/api/events');
  let busy = false;
  es.onmessage = async ev => {
    const d = JSON.parse(ev.data);
    if (d.type === 'toast') return toast(d.icon, d.title, d.text);
    if (busy) return;
    busy = true;
    try { await refresh(); } finally { busy = false; }
  };
}

/* ---- Shared renderers ---- */
function kpiTiles(m) {
  const tiles = [
    ['✓', 't-green', 'Resolved by Dost', m.resolved, 'int', `${m.handoffs} warm hand-offs`],
    ['⏱', 't-cyan', 'Human time saved', m.minutesSaved, 'min', 'from tool-level effort model'],
    ['₹', 't-green', 'Revenue influenced', m.revenue, 'inr', `${inr(m.protected)} protected`],
    ['🛡', 't-violet', 'Fixed before complaint', m.prevented, 'int', 'proactive missions'],
    ['◎', 't-amber', 'Autonomy rate', m.autonomyRate, 'pct', 'done with zero approvals']
  ];
  return `<div class="grid kpis">${tiles.map(([i, c, l, v, f, d]) => `<div class="card kpi"><div class="l"><i class="${c}">${i}</i>${l}</div><div class="v" ${v == null ? '' : `data-n="${v}" data-fmt="${f}" data-key="kpi-${l}"`}>${v == null ? '—' : ''}</div><div class="d">${d}</div></div>`).join('')}</div>`;
}
