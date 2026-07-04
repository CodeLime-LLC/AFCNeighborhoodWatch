# AFCNeighborhoodWatch

## Deploy — CodeLime-LLC org pipeline (added 2026-07-04)
Lives in the **CodeLime-LLC** org. **Deploy to Firebase Hosting from phone or Mac:**
```bash
gh workflow run firebase-hosting.yml -R CodeLime-LLC/AFCNeighborhoodWatch
```
Auto-deploys on push to `main` (free Ubuntu runner). Auth = org-level `FIREBASE_TOKEN`
(shared) → no per-repo secrets; project `afc-neighborhood-watch` comes from `.firebaserc`. Public `VITE_*`
web config is committed as `.env.production` so CI needs nothing extra.
