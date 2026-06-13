# DentAI Production Rollout & Rollback Playbook

This document serves as the guide for releasing new versions of DentAI to Vercel, monitoring telemetry metrics, and executing rollback actions.

---

## 1. Staged Rollout Strategy (Vercel)

We utilize Vercel's Git integrations or CLI deployments to perform canary releases and traffic splitting:

```
[ Git Push to Main ] ────> Auto Deploy Staging (Preview)
                                 │
                                 ├── Manual QA (Accents, telemetry checks)
                                 ▼
                         Canary Production Release
                         (e.g., 10% Traffic Split via Vercel Dashboard)
                                 │
                                 ├── Monitor /api/telemetry (P95 Latency)
                                 ▼
                         100% Production Promotion
```

### Rollout Step-by-Step
1. **Push code to branch**: Create a PR to `main` branch. This triggers a **Vercel Preview Deployment**.
2. **Staging Smoke Test**: Access the preview URL and run Indian/AU accent simulations.
   - Verify `/api/telemetry` responds with `200 OK`.
3. **Merge to Main**: Merging triggers production deployment.
4. **Configure Traffic Split** (Canary):
   - Navigate to the **Vercel Dashboard** -> **Deployments**.
   - Under the latest deployment, select **Promote to Production** but configure a traffic split (e.g. 10% of traffic to the new version).
5. **Telemetrical Monitoring Window**: Observe logs and endpoints for **1 hour**.
6. **Full Promotion**: If metrics remain normal, split 100% of traffic to the new deployment.

---

## 2. Telemetry and Decision Thresholds

Query `GET https://<your-app-domain>/api/telemetry` or inspect Vercel logs to make the following decisions:

| Metric | Target (Advance) | Hold & Investigate | Rollback Immediately |
|---|---|---|---|
| **API Error Rate** | 0% | < 2% of requests | >= 2% of requests or new critical anomalies |
| **P95 Latency** | < 3000ms | 3000ms - 5000ms | > 5000ms |
| **HTTP Statuses** | 200, 400 (Expected validation errors) | 503 (API down) | 500 Internal Server Errors |

---

## 3. Rollback Playbook

If any rollback condition (Red) is triggered, execute one of the following methods immediately:

### Method A: Vercel Instant Dashboard Rollback (Recommended)
1. Log in to the **Vercel Dashboard**.
2. Select your project: **dentai**.
3. Under the **Deployments** tab, find the last known stable deployment.
4. Click the three dots `...` next to the stable deployment and click **Promote to Production**.
5. *Time to recovery: < 30 seconds.*

### Method B: Vercel CLI Rollback
Run this command from your terminal:
```bash
# Roll back to the specific stable deployment hash
vercel rollback <stable-deployment-id>
```
*Time to recovery: < 1 minute.*

### Method C: Git Reversion
If a code change caused database/API schema errors:
1. Revert the commit locally:
   ```bash
   git revert HEAD
   git commit -m "revert: Rollback to stable release"
   git push origin main
   ```
2. The CI/CD pipeline will automatically trigger and deploy the reverted stable version.
3. *Time to recovery: < 3 minutes.*
