#!/usr/bin/env -S npx tsx
/**
 * repair-bug-ticket-numbers — one number per card, and the reason in the log.
 *
 * Run after pulling the fix for the 2026-09-30 duplicate-numbering incident,
 * and safe to run any time: with no duplicates it writes nothing and says so.
 * TypeScript on purpose: it imports the store's own loader, so this cannot
 * drift from what the API does.
 *
 * The plan is DRY RUN by default. Numbers are cited in issues, journals, chat
 * and the roadmap, so renumbering a live card is a deliberate act:
 *
 *   npx tsx scripts/repair-bug-ticket-numbers.ts            # print the plan
 *   npx tsx scripts/repair-bug-ticket-numbers.ts --apply    # write it
 *
 * Rules (src/utils/bugNumberParity.ts, unit-tested):
 *   - the OLDEST holder of a duplicated number keeps it, so every citation
 *     already in the wild still resolves to the same card;
 *   - the other holders take the next free integers, in created_at order;
 *   - numbers are never reused, so a freed number stays retired.
 *
 * Exit 0: clean, or planned/applied. Exit 1: the store still holds duplicates
 * after the pass. Exit 2: D1 unreachable or unconfigured.
 */

import { claimPublicNumbers, loadIssueTags, describeRenumber } from '../serverBugNumbers';
import { duplicateNumbers, publicNOf } from '../src/utils/bugNumberParity';

const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');

const before = await loadIssueTags();
if (!before.ok) {
  console.error(`repair-bug-ticket-numbers: cannot read issue_tags: ${before.error}`);
  process.exit(2);
}

const dupes = duplicateNumbers(before.rows);
const cards = before.rows.length;
const numbers = new Set(before.rows.map(publicNOf).filter((n) => n > 0));

if (json) {
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'plan',
    cards,
    distinct_numbers: numbers.size,
    duplicate_numbers: [...dupes.keys()].sort((a, b) => a - b),
    holders: Object.fromEntries([...dupes.entries()].map(([n, rows]) => [n, rows.map((r) => r.id)])),
  }, null, 2));
} else {
  console.log(`repair-bug-ticket-numbers: ${cards} card(s), ${numbers.size} distinct number(s)`);
  if (dupes.size === 0) {
    console.log('repair-bug-ticket-numbers: clean — every card has its own number, nothing to do.');
    process.exit(0);
  }
  console.log(`repair-bug-ticket-numbers: ${dupes.size} duplicated number(s):`);
  for (const n of [...dupes.keys()].sort((a, b) => a - b)) {
    console.log(`  #${n} held by ${dupes.get(n).length} cards: ${dupes.get(n).map((r) => r.id).join(', ')}`);
  }
}

const report = await claimPublicNumbers({ dryRun: !apply });
if (!report.ok) {
  console.error(`repair-bug-ticket-numbers: numbering pass failed: ${report.error}`);
  process.exit(2);
}

if (!apply) {
  if (report.repaired.length === 0 && report.claimed.length === 0) {
    console.log('repair-bug-ticket-numbers: nothing to plan.');
  } else {
    console.log('repair-bug-ticket-numbers: PLAN (dry run — pass --apply to write)');
    for (const m of report.repaired) console.log(`  ${m.id}: #${m.from} -> #${m.to}`);
    for (const c of report.claimed) console.log(`  ${c.id}: (unnumbered) -> #${c.to}`);
  }
  process.exit(0);
}

console.log(describeRenumber({ moves: report.repaired, kept: 0, duplicates: 0 }));
const after = await loadIssueTags();
if (!after.ok) {
  console.error(`repair-bug-ticket-numbers: verification read failed: ${after.error}`);
  process.exit(2);
}
const stillDupe = duplicateNumbers(after.rows);
const afterNumbers = new Set(after.rows.map(publicNOf).filter((n) => n > 0));
if (stillDupe.size > 0) {
  console.error(
    `repair-bug-ticket-numbers: STILL DUPLICATED after the pass: ` +
      [...stillDupe.keys()].sort((a, b) => a - b).map((n) => `#${n} x${stillDupe.get(n).length}`).join(', '),
  );
  process.exit(1);
}
console.log(
  `repair-bug-ticket-numbers: OK — ${after.rows.length} card(s), ${afterNumbers.size} distinct number(s), no duplicates.`,
);
