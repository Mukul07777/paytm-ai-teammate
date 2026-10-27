# Dost — the autonomous AI teammate

**Track 3 · Autonomous AI Teammates.** Dost works alongside Paytm's merchant sales & support teams. It detects problems in live data, plans a fix, simulates risky actions, executes through risk-gated tools, verifies the outcome, and learns from every human approval.

## Run it

On Windows, double-click **`run.bat`**. It installs dependencies on first run, starts the server and opens the console.

Or:

```bash
npm install
npm start            # → http://localhost:3000
```

- `/` is the landing page. `/app/` is the console (Command Center, Live Missions, Approvals, Merchants, Brain & Guardrails, Daily Stand-up).
- With no API key, Dost runs **deterministic playbooks** for the five signal types. They call the same tools and pass through the same guardrails.
- To let Claude plan open-ended goals, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. The default model is `claude-opus-5-5`.
- `npm run reset` re-seeds the synthetic merchant base.

## What makes it real-world

- **Policies as code-free SOPs** (`policies/*.md`): the frontmatter sets the guardrail thresholds and the body guides the LLM. They're editable live in *Brain & Policies*.
- **Evaluation suite** (`npm run eval`, or the *Trust & Evals* page): 16 τ-bench-style scenarios and 45 policy checks, run against an isolated in-memory world. A mutation test confirms it catches policy regressions.
- **Autopilot**: Dost starts missions for critical, high and regulatory signals on its own, up to 3 at a time.
- **Signed webhooks**: `POST /api/webhooks/events`, verified with HMAC-SHA256 (`DOST_WEBHOOK_SECRET`). Supports `device.offline`, `settlement.failed` and `ticket.created`.
- **Resilience**: 20 s tool timeouts. Read tools retry once; actions never retry automatically, so nothing executes twice. Missions can be retried.
- **Audit**: every step can be exported from `/api/audit.csv`.
- **Voice**: the browser speaks call lines aloud (Web Speech API), and you can speak goals into the mic.

## Production readiness

| Concern | How Dost handles it |
|---|---|
| **Access control** | Two roles. **Operator** (`DOST_OPERATOR_TOKEN`) runs missions and reads data. **Approver** (`DOST_APPROVER_TOKEN`) can also decide approvals, edit policies, change autonomy, export the audit trail and reset. Login sets a signed, HttpOnly, SameSite=Strict session cookie that lasts 12 hours. |
| **Safe defaults** | With `NODE_ENV=production`, the server refuses to start unless all four secrets are set and at least 16 characters long. |
| **Durable approvals** | A pending approval is written to disk at once. If the server restarts or crashes, the approval stays in the inbox. Approving it afterwards still runs the action. |
| **Data integrity** | Writes go to a temp file that is then renamed, so a crash never leaves a half-written database. State is flushed on SIGTERM/SIGINT. |
| **Learned rules** | A taught rule never auto-approves more than the amount the human actually saw and approved. |
| **Webhooks** | HMAC-SHA256 signature with a constant-time comparison, an optional `X-Dost-Timestamp` window of ±5 minutes, amount validation, and idempotency on `settlement_id`/`ticket_id`. |
| **HTTP hardening** | Security headers (CSP, nosniff, frame-deny, HSTS in production), per-IP rate limits (strict on login and demo requests), a 100 KB body limit, JSON 404s and errors that don't leak internals. |
| **Operations** | `GET /healthz`, one JSON log line per request, policy edits logged as audit events, and graceful shutdown. |
| **Quality gates** | `npm test` (API, auth and restart-durability tests) and `npm run eval` (agent policy suite). Both run in GitHub Actions along with `npm audit`. |

```bash
docker build -t dost .
docker run -p 3000:3000 -v dost-data:/data --env-file .env dost
```

**Known limits:** storage is a single JSON file, so run one instance. For horizontal scale, move to Postgres and use Redis-backed rate limits. The tokens are shared secrets, not per-user identities; put SSO (OIDC) in front for named approvers.

## Where the data comes from

Nothing in the UI is hard-coded. Everything is generated or computed on the server:

| Layer | What it does | File |
|---|---|---|
| Seed generator | Procedurally builds 60 merchants: 30-day GMV, devices, KYC, settlements, team | `src/seed.js` |
| Simulator | Device heartbeats, live sales, and random incidents (outages, failed settlements, complaints, KYC deadlines, growth spikes) | `src/simulator.js` |
| Proactive Radar | Turns raw data into prioritised signals | `src/radar.js` |
| Tools (23) | Real reads and writes on the store, each with a risk level | `src/tools.js` |
| Agent engine | Plan → simulate → act → verify, plus guardrail gate, approvals and learned rules | `src/agent.js` |
| Planner | Claude tool-use loop, or playbooks | `src/agent.js`, `src/playbooks.js` |
| Persistence | JSON store in `data/db.json` | `src/store.js` |

Metrics (resolved count, time saved, revenue influenced, autonomy rate) are computed from completed missions. Each tool declares its own human-effort estimate.

## Demo script (≈3 min)

1. **Command Center**: show the Radar (signals computed from data) and the Chaos lab.
2. **Deploy** on a device outage. Dost tries a remote fix, calls the merchant in their language, runs a digital-twin simulation, dispatches a replacement, and QA verifies.
3. **Deploy** on a failed settlement. It pauses for approval (medium risk). Click **Approve & teach**.
4. Inject another failed settlement in the Chaos lab and deploy it. Dost applies the **learned rule** and finishes with no interruption.
5. **Deploy** on an angry customer. Dost reverses the debit and makes a **warm hand-off** with a brief.
6. **Brain**: change the autonomy dial live. **Stand-up**: an auto-generated team report.

## Open-source references

These are in `../references`, and all are MIT-licensed:
- [openai/openai-cs-agents-demo](https://github.com/openai/openai-cs-agents-demo): triage and specialist hand-offs, with guardrails shown in the UI.
- [filip-michalsky/SalesGPT](https://github.com/filip-michalsky/SalesGPT): stage-aware sales agent over voice and text.
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench): benchmark for agents that use tools under domain policy.

Next steps for production: real voice through Pipecat or LiveKit with Sarvam (22 Indian languages), and Paytm APIs in place of the simulator.
