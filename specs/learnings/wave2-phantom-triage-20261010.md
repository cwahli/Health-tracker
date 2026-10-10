# Wave-2 phantom triage — six sheet rows with no canonical card (2026-10-10)

Branch `agent/wave2-phantoms`. Sheet `10oPI9AsHaKpb9xRR8XcTm6JyH1gYyykUFBNqeqg2SM0`, tab `current`, rows 31–36.
All six keys return `{"error":"not found"}` from `bugctl show`/`packet`; the live
`bugctl list` holds 14 cards (tag_muw*/mv*, Oct 6–10 re-file generation), none of these tags.
Sheet edits applied 18:57 - 10 oct (UK): state → `closed_noise`, unresolvable proof
pointers cleared (folders cited on-row, left curated), What's-left appended (never rewritten),
Status left Pending/Assigned (never review, never Done), last_activity refreshed to UK shape.
No human stamps were present on any of the six rows; none were touched.
No code changed, no bugctl writes, no Drive moves/deletes.

## Stew-01 — card:tag_mugpteuh_hd1bjy (was Pending/packed, proof "escalate")

- Origin: 25 Sep STEWARD E2E disposable archive fixture. `specs/bug-journal/6.jsonl`
  carries create+pack+review+edit+rewrite+handoff+archive inside 8 minutes, archived 08:52 same day.
- Verdict: closed as noise. The packed defect is vacuous ("disposable fixture starts"
  describes a fixture, not a product defect). Nothing to file, nothing to repro.
- Proof: "escalate" names no Drive folder (verified: no such folder under Work done;
  per-key lookup empty) — cell cleared as unresolvable.
- Human check: row stays for audit; parity sensor still flags the missing key, which is expected.

## Bug-59 — card:tag_mufm81ca_fbnn9j (was Pending/packed, no proof)

- Origin: 25 Sep transient Vision Scout outage ("Gemini unavailable (503)").
  Journal `1.jsonl` carries ONLY a review op — no create, no pack — so the sheet's
  "packed" state was never backed by evidence and is downgraded as invalid.
- Verdict: closed as noise. A model-backend 503 is not a product defect; nothing to
  repro 15 days later, no proof ever filed (cell already empty, left empty).
- Human check: row stays for audit; parity sensor still flags the missing key, which is expected.

## Bug-58 — card:tag_mumoqh5v_cu5q9r (was Assigned/new, proof shared folder name)

- Origin: 29 Sep inbox-leftover batch, canonical #9 ("Chocolate Croissants + Vegetarian wrap").
  Twin #15 duped to it 2 Oct (commit 32370270). Never packed, repro "needed" never run,
  debug_url NULL, photo_urls [] — see `inbox-1-cluster-evidence.png` (Drive folder
  `cards-17-15-14-13-11-duplicates`, id `1nU1AKFyy3OY_7dnSzvu-q6TzL3fTvXNr`).
- Verdict: closed as noise (phantom superseded). Live successors carry the same complaint:
  #48 `tag_muwytonh_j60ckc` + #50 `tag_muwytoo8_plh9mi` (both in_fix).
- Proof: cell cleared — a shared folder name is not per-key proof and never resolves in
  /review; the folder itself is left curated (move-not-delete).
- Human check: follow #48/#50; this row stays for audit.

## Bug-57 — card:tag_mumoqhfz_ja5bxd (was Assigned/new, proof shared folder name)

- Origin: 29 Sep inbox-leftover batch, canonical #10 ("Sweet Chilli Chicken Wrap").
  Twin #11 duped to it 2 Oct (commit 32370270). Same no-pack/no-repro shape as Bug-58.
- Verdict: closed as noise (phantom superseded). Live successors: #47 `tag_muwytod2_4itv1p`
  (packed, queue blocked on failed dispatch) + #49 `tag_muwytog8_dygq8e` (in_fix).
- Proof: cell cleared, folder left curated (same folder as Bug-58).
- Human check: follow #47/#49; this row stays for audit.

## Bug-56 — card:tag_mumoqi41_j3gw72 (was Assigned/in_fix, proof shared folder name)

- Origin: 29 Sep inbox-leftover batch, canonical #12 ("Fruit Salad + Croissant + 3 more").
  Twin #13 duped to it 2 Oct (commit 32370270). Same no-pack/no-repro shape; the sheet's
  "in_fix" was never backed by a canonical in_fix card and is downgraded.
- Verdict: closed as noise (phantom superseded). Live successors: #1 `tag_muwytnut_vco6hq`
  + #46 `tag_muwytny4_f7bdrn` (both in_fix).
- Proof: cell cleared, folder left curated (same folder as Bug-58).
- Human check: follow #1/#46; this row stays for audit.

## Bug-55 — card:tag_mumoqhth_v49fx2 (was Assigned/new, proof shared folder name)

- Origin: 29 Sep inbox-leftover batch, canonical #16 ("Incorrect nutrition labdl").
  Twin #17 duped to it 2 Oct. The investigated defect was REAL (golden case 329881c4:
  cached all_green=true while enabled outcome user_0_Sainsbury_oat_is_about_3 had
  pass=false) BUT it was already fixed by PR #490 (deployed e68acc7, read-time reconcile
  with green_conflict flag; proof `green-1-deployed-reconciles.png` in Drive folder
  `card-16-golden-false-green`, id `1dYR1IXwH-1Q_wDDbdFmohod-qqG5TYkh`).
- Verdict: closed as noise (defect already fixed elsewhere; phantom tag dead). Re-filing
  would duplicate resolved work, so no new card is filed and no code is touched
  (golden/meal-audit scope belongs to the sibling agent; the fix is already deployed).
  Nutrient remainder lives in successors: #2/#3 (both done, OPENING_WRONG/OPENING_DRIFT
  packs) and #54 `tag_mv23u9zz_0ggxi7` (live re-file, same job_id `job_1786701466257_np41t5gpa`).
- Proof: cell cleared (shared folder, not per-key); evidence folders
  (`inbox-leftover-real-defect-evidence` `1YffdueYMd72AVYWlcpUcUnUjfcTyFdGy` and
  `card-16-golden-false-green`) cited on-row and left curated.
- Human check: follow #2/#3/#54; this row stays for audit.

## Sensor posture after triage

- `assert-sheet-proof.mjs`: 24 pass / 4 fail — none of the failures are rows 31–36
  (rows 4, 5, 8, 30 belong to other owners and pre-date this triage).
- `assert-sheet-canonical-parity.mjs`: the six rows fail ONLY with "missing from bugctl",
  which remains factually true (keys deleted from issue_tags; rows retained for audit).
  No state-mismatch or done-claim failures on these rows. Meal-35/36/37 failures are
  other agents' scope, untouched.
- The parity sensor's missing-canon branch fails regardless of state vocabulary
  (checked=true even for off-vocab states); the sensor was deliberately NOT edited —
  silencing it would hide the audit trail, and sensor changes need their own pipeline.
