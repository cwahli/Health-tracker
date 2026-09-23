#!/usr/bin/env python3
"""Generic JSON -> sticky/sortable HTML table page (no LLM, free, instant).

This is the agent-facing table pipeline: populate a small JSON file, get a
mobile/TG-friendly grid with click-to-sort headers via table_template.py.

Input schema:
    {
      "title": "Page title",
      "preamble": ["markdown lines under the title"],
      "tables": [
        {"heading": "Section", "intro": ["optional markdown"],
         "columns": ["A", "B"], "align": ["l", "r"],
         "rows": [["x", "1"]], "outro": ["optional markdown"]}
      ],
      "notes": ["optional markdown lines under a Notes section"]
    }
Rows are positional arrays matching `columns`. align letters: l (default),
r (numbers), c (centered).

Usage:
    python3 qa-evidence/build-table.py in.json [out.html]
    # out defaults to in-stem + .html next to the input
Share: emit MEDIA:/abs/path/to/out.html (opens in the TG in-app browser).

Requires: markdown-it-py (VPS has it; else pip install markdown-it-py).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from table_template import render_text

_SEP = {"l": "---", "r": "---:", "c": ":---:"}


def _table(columns, align, rows):
    align = align or ["l"] * len(columns)
    out = ["| " + " | ".join(columns) + " |",
           "|" + "|".join(_SEP.get(a, "---") for a in align) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def build_md(d):
    parts = [f"# {d.get('title', 'Table')}", ""]
    parts += [*(d.get("preamble") or []), ""]
    for t in d.get("tables") or []:
        if t.get("heading"):
            parts += [f"## {t['heading']}", ""]
        parts += [*(t.get("intro") or []), ""]
        parts += [_table(t["columns"], t.get("align"), t["rows"]), ""]
        parts += [*(t.get("outro") or []), ""]
    if d.get("notes"):
        parts += ["## Notes", "", *d["notes"], ""]
    return "\n".join(parts).rstrip() + "\n"


def main():
    if len(sys.argv) < 2:
        print("usage: python3 qa-evidence/build-table.py in.json [out.html]")
        raise SystemExit(2)
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".html")
    d = json.loads(src.read_text(encoding="utf-8"))
    render_text(build_md(d), out, d.get("title"))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
