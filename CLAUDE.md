# AFCNeighborhoodWatch

## Deploy — CodeLime-LLC org pipeline (added 2026-07-04)
Lives in the **CodeLime-LLC** org. **Deploy to Firebase Hosting from phone or Mac:**
```bash
gh workflow run firebase-hosting.yml -R CodeLime-LLC/AFCNeighborhoodWatch
```
Auto-deploys on push to `main` (free Ubuntu runner). Auth = org-level `FIREBASE_TOKEN`
(shared) → no per-repo secrets; project `afc-neighborhood-watch` comes from `.firebaserc`. Public `VITE_*`
web config is committed as `.env.production` so CI needs nothing extra.

## ⏰ Report times in Central — he's in Iowa (`America/Chicago`)
CI, GitHub Actions, Cloud Run and Firestore all log **UTC**. Convert before telling him
anything: a UTC stamp after 05:00 belongs to the *previous* Central day, so raw UTC describes
his afternoon as "overnight" and his evening as tomorrow. Name the day when it isn't today,
and quote a raw UTC log line only with the Central time beside it.

## Deploying the Cloud Functions — NOT automatic
`firebase-hosting.yml` auto-deploys the web app on every push to `main`. The **functions do
not**: `functions-deploy.yml` is `workflow_dispatch` only, so a merge that changes anything
under `functions/` ships the frontend and leaves the backend on the old build. Deploy them:
```bash
gh workflow run functions-deploy.yml -R CodeLime-LLC/AFCNeighborhoodWatch
```

## The report window is anchored on discovery, not sale date (2026-08-31)
Polk County publishes sales long after they close — **median 16 days, p90 32, tail past 100**;
only 47% land within two weeks. A `saleDate >= now - timeframe` window therefore closes before
the county publishes the sale, and that mover then sits outside every future window forever.
Measured against 483 real in-radius sales, a monthly cadence on that window never reported
**63%** of them.

So the weekly email covers **every in-radius sale first ingested since the last report actually
sent** — watermark at `config/email.lastReportAt`. Do not "simplify" this back to a sale-date
window. Details that matter:
- The query is bounded on both ends, `(watermark, runAt]`, so a record written mid-run is
  neither duplicated nor skipped.
- The watermark advances **only after a confirmed send**, so a failed delivery re-reports.
- `config/email.timeframeMonths` now only sets the **first** report's lookback.

## The county feed stalls — say so, never send a silent zero
The export froze on **2026-08-18** with nothing newer than **2026-07-28**, and four weekly
reports went out empty and unexplained. `runPipeline` now records the export's newest sale date
and `Last-Modified` on `config/church`. A report with no movers is **suppressed** when the feed
is healthy, and carries a stalled-feed notice when it isn't. A total CSV fetch failure is logged
as `error`, never `success` with a count of zero, and `fetchLogs` is written on every run —
including zero-record ones, whose absence made a stalled feed look like a stopped job.
