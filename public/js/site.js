// Shared chrome for marketing pages: nav, footer, scroll reveal.
(() => {
  const page = document.body.dataset.page;
  const LINKS = [['product', '/product', 'Product'], ['use-cases', '/use-cases', 'Use cases'], ['trust', '/trust', 'Trust'], ['company', '/company', 'Company']];
  const links = LINKS.map(([k, h, l]) => `<a href="${h}" class="${k === page ? 'on' : ''}">${l}</a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
  <header class="snav" id="snav"><div class="bar">
    <a class="logo" href="/"><i>D</i>Dost</a>
    <nav class="links">${links}</nav>
    <div class="right">
      <a class="btn light" href="/company#demo">Book a demo</a>
      <a class="btn dark" href="/app/">Open console <span class="arr">→</span></a>
      <button class="burger" aria-label="Menu" onclick="document.getElementById('mnav').classList.toggle('open')">☰</button>
    </div>
  </div></header>
  <nav class="mnav" id="mnav">${links}<a href="/company#demo">Book a demo</a></nav>`);

  document.body.insertAdjacentHTML('beforeend', `
  <footer class="foot"><div class="wrap">
    <div class="cols">
      <div><a class="logo" href="/"><i>D</i>Dost</a><p style="color:var(--ink2);margin-top:16px;line-height:1.6;max-width:320px">The autonomous AI teammate for merchant sales and service. Built for Bharat's merchants.</p></div>
      <div><h5>Product</h5><a href="/product">Overview</a><a href="/product#capabilities">Capabilities</a><a href="/app/">Live console</a></div>
      <div><h5>Solutions</h5><a href="/use-cases#service">Merchant service</a><a href="/use-cases#growth">Merchant growth</a><a href="/use-cases#compliance">Compliance</a></div>
      <div><h5>Company</h5><a href="/trust">Trust & safety</a><a href="/company">About</a><a href="/company#demo">Contact</a></div>
    </div>
    <div class="base"><span>© ${new Date().getFullYear()} Dost · Hackathon prototype</span><span>Made with care for Track 3 · Autonomous AI Teammates</span></div>
  </div></footer>`);

  const nav = document.getElementById('snav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.rv').forEach(el => io.observe(el));
})();

// Live product window: real missions & signals from the running Dost instance.
window.mountProductWindow = async function (el) {
  const AG = { triage: ['#7A5AF8', 'Tr', 'Triage'], resolver: ['#00B9F1', 'Re', 'Resolver'], growth: ['#12B76A', 'Gr', 'Growth'], compliance: ['#F79009', 'Co', 'Compliance'], voice: ['#0BA5EC', 'Vo', 'Voice'], qa: ['#E0457B', 'QA', 'QA'], human: ['#012A72', 'You', 'Human'] };
  const SEV = { critical: '#F04438', high: '#F79009', regulatory: '#7A5AF8', opportunity: '#12B76A' };
  const KIND = { think: 'REASONING', tool: 'LOOKING UP', action: 'ACTING', comms: 'TALKING', twin: 'SIMULATING', auto: 'GUARDRAIL', wait: 'ASKING A HUMAN', approved: 'APPROVED', handoff: 'HANDING OFF', verify: 'VERIFIED' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const human = s => s.text || ({ get_merchant_profile: 'Reading the merchant profile', get_device_health: 'Checking device telemetry', remote_reboot_device: 'Trying a remote recovery', enable_fallback_alerts: 'Switching payment alerts to the merchant’s phone', dispatch_replacement_device: 'Dispatching a replacement device', list_settlements: 'Tracing the settlement', check_duplicate_risk: 'Checking for duplicate-payout risk', retry_settlement: 'Re-initiating the settlement', simulate_action: 'Simulating the fix on a digital twin', place_call: 'On a call with the merchant', send_message: 'Sending a WhatsApp update', score_credit_eligibility: 'Checking credit eligibility', request_consent: 'Sharing terms and capturing consent', submit_loan_application: 'Submitting the application', get_ticket: 'Reading the ticket', check_transaction: 'Confirming the debit in the ledger', initiate_reversal: 'Reversing the duplicate debit', resolve_ticket: 'Closing the ticket', handoff_to_human: 'Handing off with a brief', list_kyc_due: 'Finding merchants due for re-KYC', run_kyc_campaign: 'Sending re-KYC reminders' }[s.tool] || s.label);
  async function draw() {
    try {
      const S = await (await fetch('/api/state')).json();
      const ms = S.missions.find(m => m.status === 'running' || m.status === 'waiting') || S.missions.find(m => m.status === 'done' || m.status === 'handoff');
      const m = ms && await (await fetch(`/api/missions/${ms.id}`)).json();
      el.querySelector('[data-sigs]').innerHTML = S.signals.slice(0, 5).map((s, i) => `<div class="wsig" style="animation-delay:${i * 60}ms"><span class="d" style="background:${SEV[s.severity]}"></span><div><b>${esc(s.title)}</b><small>${esc(s.detail.split('·')[0])}</small></div></div>`).join('') || '<p style="color:var(--mute);font-size:13px">All clear right now.</p>';
      el.querySelector('[data-title]').textContent = m ? m.title : 'Waiting for the first mission…';
      el.querySelector('[data-steps]').innerHTML = m ? m.steps.slice(-6).map(s => { const a = AG[s.agent] || AG.triage; return `<div class="wstep"><div class="a" style="background:${a[0]}">${a[1]}</div><div><small>${a[2]} · ${KIND[s.k] || ''}</small><p>${esc(human(s))}</p></div></div>`; }).join('') : '<p style="color:var(--mute);font-size:13px">Open the console and deploy Dost on a signal to see it work here, live.</p>';
      el.querySelector('[data-call]').innerHTML = m?.calls?.length ? m.calls.slice(-4).map(c => `<div class="bub ${c.who === 'dost' ? 'me' : 'them'}">${esc(c.text)}</div>`).join('') : '<div class="bub them">Namaste! Main Dost hoon — aapki dukaan ka AI saathi.</div>';
    } catch { /* console offline: keep the static frame */ }
  }
  draw();
  try { new EventSource('/api/events').onmessage = () => draw(); } catch { }
};
