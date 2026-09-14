# GCP Cloud Run (Option A Free Plan) & Firebase Spark Migration

**Status:** ACTIVE PLANNING  
**Owner:** chiwah.liu@gmail.com  
**Cost Target:** 100% Free Plan ($0/month)  
**Strategy:** Dual-deployment in parallel with Render (zero downtime, zero scorecard disruption)

---

## 1. Goal

1. **Eliminate Render Cold-Start Delay:** Render's free tier sleeps after 15 minutes of inactivity and displays a 50+ second loading screen. Deploy GCP Cloud Run in parallel to provide ~1.5s cold starts with **zero loading screens**.
2. **Option A (100% Free Plan):** Cloud Run configured with `min-instances = 0` (scales to zero when idle), staying strictly within GCP's 2,000,000 requests/month free tier.
3. **Migrate Firebase to Target Account:** Move Firebase from the read-only AI Studio sandbox (`kempt-charmer-0r5vm`) to a fresh project under `chiwah.liu@gmail.com` on the **Free Spark Plan** ($0/month).

---

## 2. Architecture & Invariants

```
                         ┌─► GitHub Push (main) ─┐
                         │                       │
                         ▼                       ▼
                   [ Render CI ]          [ GCP Cloud Run ]
                         │               (Option A: min=0)
                         ▼                       ▼
           health-tracker...onrender.com   health-tracker-...a.run.app
                         │                       │
                         └───────► Supabase ◄────┘
                              (Shared Database)
```

* **No Scorecard Breakage:** Render origin (`https://health-tracker-backend-64gt.onrender.com`) stays active so all existing master scorecard gates and CI tests remain green.
* **Port Compatibility:** Cloud Run container port configured to **3000**, matching `server.ts` and `Dockerfile`.
* **Zero Local Docker Requirement:** Cloud Run builds directly from GitHub `main` using the existing multi-stage `Dockerfile`.

---

## 3. Execution Steps

### Step 1: Firebase Console Setup (Target: chiwah.liu@gmail.com)
* Create a new project on the **Spark Plan** (e.g. `health-tracker-prod`).
* Enable **Authentication** (Google Sign-In, Email/Password).
* Enable **Firestore Database** (Production mode).
* Register Web App and obtain: `projectId`, `apiKey`, `authDomain`, `appId`.
* Update `firebase-applet-config.json` with new keys.

### Step 2: GCP Cloud Run Deployment (Option A)
* Use the GCP project created with Firebase.
* Enable `run.googleapis.com`, `cloudbuild.googleapis.com`, and `artifactregistry.googleapis.com`.
* Create Cloud Run Service:
  - Source: Continuous deployment from GitHub `cwahli/Health-tracker`, branch `main`.
  - Build Type: Dockerfile (`/Dockerfile`).
  - Container Port: `3000`.
  - Min instances: `0` (100% Free Plan).
  - Max instances: `3`.
  - Ingress: Allow all (public).
  - Auth: Allow unauthenticated.
* Set Environment Variables:
  - `NODE_ENV=production`
  - `PORT=3000`
  - `INTERNAL_BASE_URL=http://127.0.0.1:3000`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ANON_KEY`
  - `GEMINI_API_KEY`

### Step 3: Validation & Gradual Cutover
* Verify `GET /api/status` returns 200 and git commit.
* Test after 30 minutes of idle time to verify ~1.5s wake-up without splash screen.
* Once verified, migrate custom domain DNS to Cloud Run and update scorecard origin.
