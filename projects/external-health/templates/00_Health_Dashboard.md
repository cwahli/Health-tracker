# Health Dashboard — Personal Health Coach

> Single glanceable state board for the Personal Health Coach workspace (`~/projects/external-health-coach`).
> Modeled after the 5-section operational dashboard standard from Corporation Tax (`Tax/AGENTS.md`).

---

## §1. Data Gate Triage (Do-Now)

**Status:** 🔴 **OPEN (8 items pending)** · Analysis pass (`/health analyze`) refused until closed or waived.

| Item | Status | Finding / Discrepancy | Resolution Path |
|---|---|---|---|
| **H-1** | 🔴 Open | Profile demographics mismatch: App has defaults (28yo, 178cm, 74kg) vs Sheet (163cm, 62kg) vs Brief (Male, born 1983-06-15, Chinese ethnicity). | Apply Brief & Sheet values to D1 app profile (`/health triage H-1`). |
| **H-2** | 🔴 Open | Duplicate rows across 9 dates in app (2020-11-04, 2024-03-27, 2024-04-02, 2024-04-03, 2024-10-23, 2025-06-25, 2025-06-26, 2026-06-03, 2026-06-05). | Deduplicate identical imported entries. |
| **H-3** | 🔴 Open | 2 empty app rows: 2026-07-30, 2026-08-01. | Prune empty date rows in D1. |
| **H-4** | 🔴 Open | 4 rows carrying another date’s results: 2020-04-10 (→ 2020-11-04), 2024-04-01 (→ 2024-04-02), 2026-03-06 (→ 2024-04-03 / 2026-06-03), 2026-05-05 (→ multiple). | Realign row timestamps to lab draw dates. |
| **H-5** | 🔴 Open | Value disagreement: Weight on 2023-11-17 (app 61.9 vs sheet 61). | Reconcile to sheet value (sheet is authoritative). |
| **H-6** | 🔴 Open | 36 sheet values missing in app (e.g. 2024-03-27 vitals, 2024-04-02 CBC differential, 2024-04-03 liver/HIV). | Batch ingest missing sheet values to D1. |
| **H-7** | 🔴 Open | Unexplained app rows: HbA1c 40 on 2026-07-08 and 2026-09-06 (sheet has value on 2026-06-05). | Reconcile post-June telemetry. |
| **H-8** | 🔴 Open | App holds results after sheet’s newest date (2026-06-09): July–Sept 2026 rows. | Acknowledge as unverified app telemetry or waive. |

---

## §2. Live Deadlines & Lab Timelines

* **Latest Authoritative Blood Draw:** `2026-06-09`
* **Elapsed Since Last Panel:** `114 days`
* **Annual Review Cliff:** `2027-06-09` (`251 days remaining`)
* **Medical Insights Cadence:** 30-day renewal cycle (Document 4 renews monthly via `/health research`).
* **Next Lab Window:** Indicative repeat for lipids & renal function due in ~90 days.

---

## §3. Dietary & Lifestyle Baseline

* **Demographic Profile:** Male, Born 15 June 1983 (Age 43), Chinese ethnicity.
* **Anthropometrics:** Height 163 cm, Weight 62 kg, BMI 23.49 kg/m² (at East Asian overweight threshold ≥23.0).
* **Physical Activity (GPPAQ from Sheet):**
  - Workplace: Predominantly sitting / sedentary.
  - Walking: 1–3 hours/week (fast pace).
  - Cycling / Gardening: None recorded.
* **Alcohol & Lifestyle:**
  - Weekly consumption: ~5 U/week.
  - AUDIT-C score: 8 (hazardous drinking band recorded).
* **Dietary Focus Areas for Analyst:**
  - Saturated fat intake vs LDL elevation (3.4 → 4.3 mmol/L).
  - Sodium intake vs resting blood pressure (109/53 mmHg baseline).
  - Alcohol intake vs upper-normal ALT (41 U/L).

---

## §4. Doctor Audit Ledger

* **Audit Standard:** Every claim requires `<marker> <value> (<date>)` or a verified fetched citation.
* **Current Review State:** Clean gate required before final pass; strikes hold publishing.
* **Veto Rules in Effect:**
  - Unsubstantiated reassurance ("diet looks good") ➔ `STRIKE` (withholds all analysis sections).
  - Unmeasured biomarker (e.g. Vitamin D, hs-CRP) ➔ `UNPROVEN` (honest gap, not a strike).
  - Malformed or unreadable review ➔ Fails closed.

---

## §5. 4 Living Google Docs Manifest

* **Google Drive Parent Folder:** `External-Personal-Health-Coach` (`1EqUkUPZmF4RAejJdMwxdZ8zvgRpMoL7T`)
* **Current Publishing Mode:** **DRAFT** (Data sections rendered; 11 analysis sections withheld pending gate closure).

| # | Document Name | Google Doc ID | Direct Link | Current State |
|---|---|---|---|---|
| **1** | Health Snapshot | `1TflAjj_8TSHizIrVKSgZKfr-VlDR36S14Q8E8pEFqa8` | [Open Doc 1](https://docs.google.com/document/d/1TflAjj_8TSHizIrVKSgZKfr-VlDR36S14Q8E8pEFqa8/edit) | Draft (Data rendered) |
| **2** | Conditions & Actions | `1vkRNFmXX906kBfpHta46bg3fCCeLIqpcCyDenjnU2pc` | [Open Doc 2](https://docs.google.com/document/d/1vkRNFmXX906kBfpHta46bg3fCCeLIqpcCyDenjnU2pc/edit) | 4 analysis sections withheld |
| **3** | Test Plan | `13yK0FbxG7L0EkcGtPv1nWkRlJWNiJx1Jyne-vyshsTY` | [Open Doc 3](https://docs.google.com/document/d/13yK0FbxG7L0EkcGtPv1nWkRlJWNiJx1Jyne-vyshsTY/edit) | 3 analysis sections withheld |
| **4** | Medical Insights | `14nhy08ntFRADl4rCYVCBsng2QdnMl3GqD8sWnzgJsy8` | [Open Doc 4](https://docs.google.com/document/d/14nhy08ntFRADl4rCYVCBsng2QdnMl3GqD8sWnzgJsy8/edit) | 4 uncited sections withheld |

---

*Last Synchronized:* 2026-10-01 · Generated for Personal Health Coach Council
