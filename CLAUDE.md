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
