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

## The SALES export stalls — but the county has not (2026-08-31)
The **sales** export (`exports/res/sales/juris/<J>/<year>.csv`) stopped gaining content after
~2026-08-03 and stopped being rewritten after **2026-08-18**, topping out at deed book **20608**
/ sale date **2026-07-28**. Four weekly reports went out empty and unexplained.

**Sales did not stop.** The sibling **inventory** export `exports/res/inven/juris/<J>.csv` was
refreshed **2026-08-23** with transfers through **2026-08-20** — deed books **20609–20632**, 228
recordings the sales export never received. Nothing was announced: the whole export tree was
crawled and the Aug 2026 RealTalk newsletter says nothing about a data change.

**Never conclude "no sales happened" from one export.** That mistake cost six weeks of movers.

### The fallback is implemented, not just advice
`runPipeline` reads **both** exports every run (`fetchTransfers.ts`). They share the deed key
`book-pg` — verified 98% overlap on arm's-length sales — so both feed one collection, one dedup
key and one geocoding path.
- The sales export **wins** on a shared deed: it has price and arm's-length grading the
  inventory lacks. A deed first seen in the inventory is **upgraded in place** when the sales
  export publishes it — but `createdAt` is never touched, since it is the report watermark and
  moving it re-sends a mover.
- Inventory rows are filtered to recent **owner-occupied residential** transfers: `occupancy` in
  {Single Family, Condominium, Townhouse, Bi-attached, Duplex} — condos and townhouses are
  movers too, an earlier Single-Family-only pass undercounted by a fifth — mailing address ==
  property address, and title holder not an organisation.
- Entity matching is **per whole word**, never substring: `" TRUST"` inside "TRUSTIN" and
  `" BANK"` inside a Banks surname silently drop real households. A unit test pins this.
- The 19 MB file is filtered inside `csv-parse` via `on_record`; materialising 27k rows of 130+
  columns first blows the memory budget. Measured 0.8s / 26 MB heap. Functions run at **1 GiB**.

Freshness of **both** exports is recorded on `config/church` (`sourceMaxSaleDate`,
`sourceMaxTransferDate`, `sourceLastModified`), so staleness reflects the best available picture.
A report with no movers is **suppressed** when the feed is healthy and carries a stalled-feed
notice when it isn't. A total fetch failure logs `error`, never `success` with a count of zero,
and `fetchLogs` is written on every run — including zero-record ones, whose absence made a
stalled feed look like a stopped job.

## Where this was left on 2026-08-31
Shipped and deployed (hosting + functions, 7:28 AM Central). A one-off **catch-up email of 62
movers** (Jul 30 – Aug 20) went to Debbie, and those 62 are in Firestore as `source:
"inventory"` with doc ids `catchup_<book>_<pg>`. `config/email.lastReportAt` was seeded to
**2026-08-31T11:51:30Z** so the weekly report resumes cleanly and cannot re-send them.

## The whole export tree froze — assessor contacted (2026-10-06)
The inventory fallback stalled too. A crawl of all 2,064 files under `/info/web/exports/`
(run from a GitHub runner, since the county host is blocked in the cloud container) found
**nothing newer than Sep 6, 2026 7:22 AM Central**, and no renamed or new paths:
- every **sales** export (res/comm/ag, per-juris and `polk/`) last written **Aug 18 ~6 PM Central**
- every **inventory** export (res/comm/ag, per-juris and `POLKCOUNTY.csv`) last written
  **Sep 6 ~7:10–7:22 AM Central**; newest transfer **Sep 3**, AK deed book **20648**, DM shows the same cutoff

So it is county-wide, not Ankeny and not our parser. No other public file fills the gap. The
user **emailed Randy Ripperger on 2026-10-06** (Rip@assess.co.polk.ia.us, 515-286-3158) —
don't re-report it; wait for the reply. When the exports resume, the discovery watermark picks
up the backlog with no manual catch-up needed.

The stale notice used to pair the inventory's newest transfer with the *sales* file's
Last-Modified ("last refreshed Aug 18" beside a Sep 3 sale). Fixed: the inventory's
Last-Modified is now stored as `config/church.sourceInventoryLastModified` and the notice
reports the newest refresh across both (`sourceStatusFrom` in `email.ts`).
