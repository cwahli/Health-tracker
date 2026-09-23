---
name: telegram-tables
description: Use whenever the answer contains a table (nutrients, comparisons, prices, schedules). Telegram cannot render Markdown tables, so pipe tables must be converted or they arrive as unaligned plain text.
---

# Telegram tables (the client cannot render `|` pipes)

Telegram has **no native table rendering**. A Markdown pipe table sent as plain
text arrives exactly as the VM2 screenshot showed: unaligned, hard to read.
Never emit raw `| col |` pipes outside a code fence.

## Narrow tables (≤3 columns, fits a phone screen): padded monospace fence

Pad every column with spaces so rows align in a monospace font, and wrap the
whole table in a fenced block. The send path converts fences to Telegram
`<pre>` blocks, which render aligned on all clients:

```
```text
Nutrient      Amount     Notes
Energy        ~300 kcal  bread + filling
Protein       ~8 g       chicken floss
Total fat     ~13 g      mayo/floss oil
```
```

Rules: pad headers AND rows to the same widths; keep total width ≤ ~30
characters so it fits a phone bubble without sideways scroll; right-align
numbers where it helps; no language tag needed (use `text` — a real language
tag adds a copy button, which is wrong for a read-only table).

## Wide tables (>3 columns or >30 chars): JSON pipeline → HTML grid → `MEDIA:`

Do NOT hand-write HTML. Populate a small JSON file and build it — the agent
writes data only (token-cheap positional arrays), the builder renders the
mobile/TG-friendly grid (sticky header + first column, click-to-sort, readable
with scripts blocked):

```bash
python3 qa-evidence/build-table.py /tmp/nutrients.json /tmp/nutrients.html
ls -la /tmp/nutrients.html
```

Input schema (`title`, `preamble[]`, `tables[{heading, columns[], align[],
rows[[]], intro[]/outro[]}]`, `notes[]`; align letters `l`/`r`/`c`; every row
must match its `columns` length). Full schema + example in
`qa-evidence/build-table.py`. For the model bake-off specifically, edit
`qa-evidence/model-comparison.json` and run
`python3 qa-evidence/build-model-comparison.py` instead.

Then deliver:

```
MEDIA:/tmp/nutrients.html
Full breakdown table — opens in chat, sortable columns.
```

The `.html` arrives as a file that opens in Telegram's in-app browser. Requires
`markdown-it-py` on the build host (VPS has it). Never shrink a wide table by
dropping columns silently; if you must trim, say which columns you dropped.

## Honesty rule for estimated tables

A table looks authoritative even when the numbers are guesses. When values are
estimated (e.g. no Nutrition Facts panel visible): put `~` on every estimated
cell, state the basis in one line above the table (`typical values for ~85 g …,
not label data`), and offer the follow-up that would give exact numbers
(`photograph the back label and I'll read the exact values`).

## When to use a table at all

Use one when the user asks for a breakdown/comparison, or when prose would bury
3+ parallel numbers. Otherwise prefer 3–5 short lines — a table for two numbers
is clutter.
