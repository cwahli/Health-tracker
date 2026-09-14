# Result summary

This folder is **empty of LATEST.*** until `scripts/assert-master-scorecard.mjs` exits 0.

A green summary is valid only when:

1. `LATEST.json` `contract` law `overall_named_gates` is PASS.
2. `seal` matches SHA-256 of that JSON with `seal` removed.
3. `identity.instructionHash` matches the current instruction files.

Do not create `LATEST.md` by hand. A file that says ALL GREEN without a matching seal is not a pass.
