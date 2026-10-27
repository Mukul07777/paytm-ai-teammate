---
title: Settlement recovery
auto_approve_below: 10000
human_required_from: 200000
max_retries: 2
---
# Settlement recovery SOP

1. Always trace the failed settlement in the ledger before acting.
2. Run the duplicate-payout check. If a duplicate exists or retries are exhausted, **do not retry** — hand off to Risk Ops.
3. Simulate the retry on the digital twin first.
4. Retries below `auto_approve_below` may run autonomously. Larger amounts need approval unless a learned rule covers them. From `human_required_from` upwards a human must always approve.
5. If the bank rejects beneficiary details (e.g. invalid IFSC), stop retrying, send the merchant the bank-update link, and hand off to Support.
6. Always confirm the credit to the merchant with the UTR.
