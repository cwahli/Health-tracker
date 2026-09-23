#!/usr/bin/env python3
"""Generate model-comparison.html from model-comparison.json.

Source of truth: qa-evidence/model-comparison.json (edit that, not the output).
Run: python3 qa-evidence/build-model-comparison.py

Deterministic and LLM-free: adding a model = editing one row line in the JSON.
No Markdown file is produced — the JSON is the agent-facing source, the HTML is
the human-facing view.
"""
import json
from pathlib import Path

from table_template import render_text

HERE = Path(__file__).resolve().parent
DATA = HERE / "model-comparison.json"
HTML = HERE / "model-comparison.html"

_SEP = {"l": "---", "r": "---:", "c": ":---:"}


def _table(columns, align, rows):
    out = ["| " + " | ".join(columns) + " |",
           "|" + "|".join(_SEP[a] for a in align) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def build_md(d):
    parts = [f"# {d['title']}", "", *d["preamble"], "", "---", ""]
    for key in ("ranking", "free"):
        s = d[key]
        parts += [f"## {s['heading']}", ""]
        for p in s.get("intro", []):
            parts += [p, ""]
        parts += [_table(s["columns"], s["align"], s["rows"]), ""]
        for p in s.get("outro", []):
            parts += [p, ""]
        parts += ["---", ""]
    parts += [f"## {d['notes_heading']}", "", *d["notes"], "", "---", ""]
    parts += [f"## {d['sources_heading']}", "", *d["sources"], "", "---", ""]
    parts += [f"## {d['howto_heading']}", "", *d["howto"], "", "---", ""]
    ch = d["changelog"]
    parts += [f"## {ch['heading']}", "", _table(ch["columns"], ch["align"], ch["rows"]), ""]
    return "\n".join(parts).rstrip() + "\n"


if __name__ == "__main__":
    d = json.loads(DATA.read_text(encoding="utf-8"))
    render_text(build_md(d), HTML, d["title"])
    print(f"wrote {HTML}")
