#!/usr/bin/env python3
"""Generic JSON -> sticky/sortable HTML table page (no LLM, free, instant).

This is the agent-facing table pipeline: populate a small JSON file, get a
mobile/TG-friendly grid with click-to-sort headers via table_template.py.

Input schema:
    {
      "title": "Page title",
      "preamble": ["markdown lines under the title"],
      "toggle": true,            # optional: grid sections become tabs in a
                                 # sticky top-right bar (pure radio + CSS,
                                 # no script). First tab selected.
      "tables": [
        {"heading": "Section", "tab": "Tickets",  # optional: tab caption.
         # A table with "tab" joins the sticky tab strip and skips its h2.
         "intro": ["optional markdown"],
         "columns": ["A", "B"], "align": ["l", "r"],
         "first_width": "10ch",  # optional: narrow the sticky first column
                                 # (default 150px) to the given CSS width.
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
import re
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
    for ti, t in enumerate(d.get("tables") or []):
        if t.get("heading") and not t.get("tab"):
            parts += [f"## {t['heading']}", ""]
        if t.get("tab"):
            parts += [f"<!-- tabview:{ti} -->", ""]
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
    out_path = render_text(build_md(d), out, d.get("title"))
    tables = d.get("tables") or []
    widths = [t.get("first_width") for t in tables]
    if any(widths) or d.get("toggle"):
        html = out_path.read_text(encoding="utf-8")
        if any(widths):
            html = _apply_first_widths(html, widths)
        if d.get("toggle"):
            html = _apply_toggle(html, [t.get("tab") for t in tables])
        out_path.write_text(html, encoding="utf-8")
    print(f"wrote {out}")


_TOGGLE_CSS = """
  /* View tabs: pure radio + CSS, no script (safe when the viewer blocks JS,
     e.g. Telegram's in-app browser). First tab selected by default. */
  .tabbar > input { position: absolute; opacity: 0; pointer-events: none; }
  .tabbar .masthead {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    background: #0f172a; padding: 10px var(--gutter); margin: 0;
    border-bottom: 1px solid #334155;
  }
  .tabbar .masthead h1 { margin: 0; font-size: 17px; white-space: nowrap; }
  .tabbar .tabs { display: inline-flex; }
  .tabbar .tabs label {
    cursor: pointer; padding: 7px 13px; font-size: 13px; font-weight: 600;
    color: #93c5fd; background: #1e293b; border: 1px solid #334155;
    border-radius: 0; margin-left: -1px; white-space: nowrap;
  }
  .tabbar .tabs label:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
  .tabbar .tabs label:last-child { border-radius: 0 8px 8px 0; }
  .tabbar .view { display: none; }
"""


def _apply_first_widths(html: str, widths: list) -> str:
    """Tag each grid vw-<i> and narrow the sticky first column where asked."""
    counter = {"i": 0}

    def tag(match: re.Match) -> str:
        i = counter["i"]
        counter["i"] += 1
        return match.group(0).replace('class="sticky-table"',
                                      f'class="sticky-table vw-{i}"', 1)

    html = re.sub(r'<div class="sticky-table">', tag, html)
    rules = []
    for i, w in enumerate(widths):
        if w:
            rules.append(
                f"  .sticky-table.vw-{i} th:first-child,"
                f" .sticky-table.vw-{i} td:first-child"
                f" {{ width: {w}; min-width: {w}; max-width: {w};"
                f" padding-left: 6px; padding-right: 6px; }}")
    if rules:
        html = html.replace("</style>", "\n".join([""] + rules) + "\n</style>", 1)
    return html


def _apply_toggle(html: str, labels: list) -> str:
    """Sticky masthead (page title + one joined tab strip) over the tabbed
    grids. Sections are delimited by <!-- tabview:<i> --> markers emitted by
    build_md; each runs to the next marker, the next <h2>, or the page end.
    Pure radio + CSS, no script. Non-grid sections (Notes) stay below,
    always visible. `labels` carries one tab caption per grid, in order.
    """
    parts = re.split(r"(<!-- tabview:\d+ -->)", html)
    pre = parts[0]
    title = ""
    m = re.search(r"<h1>.*?</h1>", pre)
    if m:
        title = m.group(0)
        pre = pre.replace(title, "", 1)
    views = []
    tail = []
    for j in range(1, len(parts), 2):
        content = parts[j + 1] if j + 1 < len(parts) else ""
        if '<table class="st-table">' not in content:
            tail.append(parts[j] + content)
            continue
        idx = len(views)
        label = labels[idx] if idx < len(labels) and labels[idx] else f"View {idx + 1}"
        views.append((label, content))
    prefix = "btabs"
    bits = ['<div class="tabbar">']
    for i, (label, _) in enumerate(views):
        chk = " checked" if i == 0 else ""
        bits.append(f'<input type="radio" name="{prefix}"'
                    f' id="{prefix}-vw-{i}"{chk}>')
    bits.append(f'<div class="masthead">{title or "<span></span>"}'
                + '<div class="tabs">' + "".join(
                    f'<label for="{prefix}-vw-{i}">{label}</label>'
                    for i, (label, _) in enumerate(views)) + "</div></div>")
    for i, (_, content) in enumerate(views):
        bits.append(f'<section class="view {prefix}-v-{i}">{content}</section>')
    bits.append("</div>")
    rules = []
    for i in range(len(views)):
        rules.append(f"  #{prefix}-vw-{i}:checked ~ .{prefix}-v-{i}"
                     " { display: block; }")
        rules.append(f'  #{prefix}-vw-{i}:checked ~ .masthead'
                     f' label[for="{prefix}-vw-{i}"]'
                     " { background: #1d4ed8; color: #fff;"
                     " border-color: #1e40af; }")
    html = pre + "\n".join(bits) + "".join(tail)
    return html.replace("</style>",
                        _TOGGLE_CSS + "\n".join([""] + rules) + "\n</style>", 1)


if __name__ == "__main__":
    main()
