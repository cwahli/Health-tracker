# Colab Bot: Mobile-First Telegram Dev Agent & Colab Compute Host

**Status:** UPDATED SPECIFICATION (Milestones CB-1 through CB-5)  
**Host & Compute Engine:** Google Colab GPU (L4/A100 using 200 Compute Units)  
**Remote Control:** Mobile Telegram Client $\leftrightarrow$ `@Collab_bot`  
**Execution Environment inside Colab:** OpenCode CLI, Local Qwen 3.8 (GPU), Playwright Headless  
**Local Phone Role (Termux):** Hosts `agy` (Antigravity CLI) due to datacenter IP limits  
**Source of Truth:** GitHub (`origin/main`)  

---

## 1. Core Principles & Environment Separation

1. **Colab is the Compute Engine (Using Your 200 Units)**:
   * Colab is where the heavy lifting occurs: it clones the repository, hosts the AI models, and executes the dev and test loop.
   * **OpenCode CLI** runs *inside* Colab.
   * **Open-weights frontier models (Qwen 3.8 / Qwen 3.8 Flash)** run *inside* Colab using its GPU VRAM.
   * **Playwright E2E tests** run *inside* Colab where ample RAM and CPU exist.
2. **Why `agy` (Antigravity CLI) Does NOT Run in Colab**:
   * Google blocks Antigravity CLI on datacenter/cloud IPs (`User location is not supported`).
   * `agy` runs exclusively on your **Android phone (Termux)** using your mobile/residential IP.
3. **Why Closed APIs Do NOT Need Colab**:
   * Standard cloud APIs (like Gemini Pro or closed Qwen-Max) require zero GPU compute. Using Colab just to make an HTTP request would waste your 200 compute units. APIs bypass Colab entirely.
4. **What `/switch` Specifically Does**:
   * `/switch` controls the active coding engine **running inside Colab**: toggling between **OpenCode** (with `muse-spark-1.3 contributor`) and **Qwen 3.8** (running locally on Colab's GPU).

---

## 2. System Architecture

```text
 ┌────────────────────────────────────────────────────────┐
 │              Mobile Phone (Telegram App)               │
 │ Commands: /switch, /fix, /test, /status, /colab_stop   │
 └───────────────────────────┬────────────────────────────┘
                             │ Telegram Bot API
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │             Google Colab Compute Worker                │
 │         (L4 / A100 GPU • 200 Compute Units)            │
 │                                                        │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │ Engine Router (/switch inside Colab)             │  │
 │  │ • Mode A: OpenCode CLI (muse-spark-1.3)          │  │
 │  │ • Mode B: Qwen 3.8 (vLLM on Colab GPU)           │  │
 │  │ • Mode C: Qwen 3.8-Flash (Fast open model)       │  │
 │  └──────────────────────────┬───────────────────────┘  │
 │                             ▼                          │
 │  ┌──────────────────────────────────────────────────┐  │
 │  │ Autonomous Dev Execution Loop:                   │  │
 │  │ 1. git pull origin main                          │  │
 │  │ 2. Apply code fix using active Colab engine      │  │
 │  │ 3. Run npx tsc --noEmit                          │  │
 │  │ 4. Run Playwright E2E tests headlessly           │  │
 │  │ 5. git push origin main                          │  │
 │  │ 6. Send live progress + report back to Telegram  │  │
 │  └──────────────────────────────────────────────────┘  │
 │                                                        │
 │  Watchdog: Auto-unassign if idle > 20 min              │
 └───────────────────────────┬────────────────────────────┘
                             │
                             ▼
                   GitHub (origin/main)
              (Deploys live via webhook)
```

---

## 3. The Colab Engines Matrix (What Runs in Colab)

| Engine Key | What Runs in Colab | Resources Consumed | Best Fit |
|---|---|---|---|
| **`/switch opencode`** (or `/switch muse-spark-1.3`) | Colab invokes `opencode run -m muse-spark-1.3-contributor-free` | CPU / OpenCode contributor credits | Repository-aware refactoring, multi-file codebase edits using OpenCode's contributor model. |
| **`/switch qwen-3.8`** | Colab invokes `vLLM` running **Qwen 3.8-27B** (AWQ 4-bit) in GPU VRAM | Colab GPU (~4 units/hr on L4) | High-reasoning open-weights coding without external token limits or contributor rate limits. |
| **`/switch qwen-flash`** | Colab invokes lightweight Qwen 3.8 variant on GPU | Colab GPU | High-speed atomic bug fixes, UI styling, single-function changes. |

---

## 4. The Telegram Command Interface (Mobile Control)

### Engine Switching (Inside Colab)
- **`/switch`**: View currently active engine inside Colab, GPU VRAM usage, and available choices.
- **`/switch muse-spark-1.3`**: Tells Colab to use OpenCode with `muse-spark-1.3 contributor`.
- **`/switch qwen-3.8`**: Tells Colab to route tasks through Qwen 3.8 running on Colab's GPU.
- **`/switch qwen-flash`**: Tells Colab to route through Qwen 3.8 Flash.
- **`/switch status`**: Summarizes the active Colab runner, uptime, and last completed task.

### Development & Execution
- **`/fix <bug or task description>`**:
  Colab runs the full automated cycle:
  1. `git fetch && git pull origin main`
  2. Runs active engine (`muse-spark-1.3` or `qwen-3.8`) on the codebase.
  3. Runs `npx tsc --noEmit` to verify type safety.
  4. Runs `npx playwright test` to verify zero regression.
  5. Commits and executes `git push origin main`.
  6. Sends summary with commit hash and Playwright results to Telegram.
- **`/test [filter]`**:
  Runs Playwright tests headlessly inside Colab and returns pass/fail counts and error traces to Telegram.
- **`/status`**:
  Reports Colab GPU status, git branch, and porcelain status.
- **`/colab stop`**:
  Manually instructs Colab to call `runtime.unassign()` to shut down the GPU immediately.

---

## 5. End-to-End Dev Execution Loop (Inside Colab)

```text
You send from phone: "/fix BUG-20260923-01: Round Omega-3 to 1 decimal place on WeeklyNutritionCard"
    │
    ▼
[Colab Compute Worker]
1. Telegram typing indicator (...) activated on phone.
2. Colab executes: `git fetch && git pull --ff-only origin main`.
3. Engine Execution:
   • IF Mode is `muse-spark-1.3`:
     Colab runs: `opencode run -m muse-spark-1.3-contributor-free --dir /content/Health-tracker "<task>"`
   • IF Mode is `qwen-3.8`:
     Colab queries local vLLM endpoint `http://localhost:8000/v1` with scoped file context.
4. Verification Gate (Run on Colab compute):
   • Gate 1: `npx tsc --noEmit`
   • Gate 2: `bash scripts/run-playwright-headless.sh`
5. Decision:
   ├── IF ALL TESTS PASS:
   │   • `git add -u`
   │   • `git commit -m "fix(nutrition): round omega-3 display (BUG-20260923-01)"`
   │   • `git push origin main`
   │   • Telegram: "✅ [Colab Bot] Fix committed & pushed to main (a8f10c)! Playwright: 12 passed. Deployed via webhook."
   │
   └── IF TESTS FAIL:
       • `git checkout .` (workspace auto-reverted).
       • Telegram: "❌ [Colab Bot] Playwright test failed. Changes reverted. Diagnostics: <log>"
```

---

## 6. Safeguarding Your 200 Colab Compute Units

1. **Auto-Unassign Watchdog (20-Minute Inactivity Timer)**:
   * Colab continuously tracks the timestamp of the last executed Telegram command.
   * If **20 minutes** pass without receiving a new command from Telegram, Colab posts a final notice to Telegram:
     `⏱️ [Colab Watchdog] 20m idle reached. Auto-unassigning runtime to preserve your 200 compute units.`
   * Then immediately executes:
     ```python
     from google.colab import runtime
     runtime.unassign()
     ```
2. **One-Tap Phone Activation**:
   * You open the notebook link in mobile Chrome, tap **Run All**, and close the browser.
   * Colab sends a Telegram alert once it is online:
     `🚀 [Colab] Worker is ONLINE on L4 GPU! Active model: muse-spark-1.3. Send /fix or /switch to begin.`

---

## 7. Milestone Roadmap

### Milestone CB-1: Colab Telegram Worker & Registry Integration
- **Deliverables:**
  1. Add `collab` bot definition to [`bots/registry.json`](file:///root/Health-tracker/bots/registry.json).
  2. Implement Colab-side Telegram listener handling `/status`, `/help`, `/cancel`.
  3. Validate secure execution restricted to authorized Telegram user ID (`6218257274`).

### Milestone CB-2: Internal Model Router & `/switch` Inside Colab
- **Deliverables:**
  1. Implement internal switcher toggling between OpenCode CLI and local Qwen 3.8.
  2. Enable `/switch muse-spark-1.3` (calls `opencode run -m muse-spark-1.3-contributor-free`).
  3. Enable `/switch qwen-3.8` (calls local GPU vLLM Qwen 3.8).
  4. Enable `/switch status` reporting active engine and GPU VRAM.

### Milestone CB-3: Headless Colab Notebook with 200-Unit Watchdog
- **Deliverables:**
  1. [`notebooks/colab_qwen38_vllm.ipynb`](file:///root/Health-tracker/notebooks/colab_qwen38_vllm.ipynb) and [`notebooks/colab_worker.py`](file:///root/Health-tracker/notebooks/colab_worker.py).
  2. Clones `Health-tracker`, installs OpenCode, downloads Qwen 3.8 AWQ weights onto GPU.
  3. Implements 20-minute idle watchdog calling `runtime.unassign()`.
  4. Telegram start and shutdown notification webhooks.

### Milestone CB-4: Automated Verification Pipeline (Playwright + TypeScript)
- **Deliverables:**
  1. Headless test runner [`scripts/run-playwright-headless.sh`](file:///root/Health-tracker/scripts/run-playwright-headless.sh).
  2. Integrated test gates: `tsc --noEmit` followed by Playwright suite.
  3. Failure diagnostics with screenshot attachments sent to Telegram.

### Milestone CB-5: End-to-End Mobile Dev Loop (`/fix` $\to$ Git Push)
- **Deliverables:**
  1. Wire complete `/fix` command to pull `origin/main`, code, test, and push.
  2. Implement Telegram typing pulse (`...`) throughout the run.
  3. Live mobile test of atomic bug fix executed entirely from Telegram on your phone.

---

## 8. Invariants (What NEVER to Do)

1. **NEVER run `agy` inside Colab**: Google cloud IP blocking prevents `agy` on Colab; keep `agy` on Android Termux.
2. **NEVER route closed APIs through Colab**: Direct APIs (Gemini Pro, Qwen-Max) bypass Colab completely so compute units are not wasted.
3. **NEVER allow Colab to idle**: Always enforce the 20-minute auto-unassign watchdog so the 200 units remain protected.
4. **NEVER push without Playwright green**: Every commit generated by OpenCode or Qwen 3.8 must pass `tsc` and Playwright tests before `git push origin main`.
