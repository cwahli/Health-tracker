# Observer: sheet-cleanup pilot via the review queue (2026-10-09)

Role: observer of the `/review` approval flow while staging the pm-sheet dedupe
through it. No sheet deletes were performed. One pilot ticket staged.

## What was staged

- `current!A45:Y45` — `Sheet-05` / `task:sheet-dedupe-pilot`, `Status=review`,
  `state=open`. Policy-approval ticket: approving it unlocks per-key review
  items, it deletes nothing itself.
- Proof: `Work done/task:sheet-dedupe-pilot/sheet-dedupe-pilot.png`
  (rows-vs-unique-keys chart: current 43/43, ongoing 8206/86, archive 913/118,
  overlaps 41/29/54). Folder id `1K2ebgnA4_XNXg4NWXVZIguDKoWw8fx38`.

## Queue health observed (pre-existing items)

- `Bug-2` (`card:tag_muwyto2i_lv3uyw`) and `Bug-3` (`card:tag_muwyto87_lb78bc`)
  both `Status=review` with live proof folders and PNGs. Queue path works.
- Cross-contamination: the Bug-2 folder also holds `Bug-53-fleet-bots.png`
  and `Bug-53-fleet-tickets.png`. Nothing checks an upload's subject against
  the folder key, so a misfiled proof silently joins another ticket's review.

## Friction noted (proposals, not changes)

1. **Proof/key mismatch is silent.** `listProofImages` lists by folder name;
   a wrong-key upload is indistinguishable from proof. Proposal: sensor that
   flags images whose bytes/name suggest another key, or require the uploader
   to confirm the key at upload time.
2. **`last_activity` is free text** (`21:32 - 9 oct (UK)`). The code comment
   says refreshing it "keeps the queue order honest", but sheet order is the
   queue order — text timestamps can't sort. Proposal: ISO datetime column
   alongside the display string.
3. **`Status` has no sheet-side validation** (`Assigned`/`Pending`/`review`
   coexist). `isReviewStatus` is tolerant, which hides typos instead of
   surfacing them. Proposal: dropdown validation on `current!F:F`.
4. **Approve is all-or-nothing** (archive + delete). Policy tickets like this
   pilot only need "accepted" without an archive move. Proposal: a third
   verdict (accept, stays in place with `state` update) or a `kind=policy`
   convention the archiver skips.
5. **`ongoing_projects`/`archive_done` are append-only logs wearing a table's
   clothes** (header-as-data row, ~100x key duplication). Collapsing them is
   a history rewrite, so each collapse batch should itself be a `review` item
   with a diff screenshot, same as this pilot.

## Next (awaits human verdict in /review on Sheet-05)

- Approve → stage the first per-key batch (5 duplicate groups, diff shots).
- Comment/rework → revise policy per the note, no further staging.
