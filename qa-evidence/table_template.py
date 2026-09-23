#!/usr/bin/env python3
"""Reusable sticky/sortable HTML table template for Health-tracker reports.

Renders any GitHub-flavoured Markdown file into a single self-contained HTML page
where every table behaves like a proper data grid:

  - Full-bleed: flush to the left/right screen edges, no side margin.
  - The first column (the label column) is sticky-left and ~150px wide.
  - The header row sticks to the top of the table's own scroll area, so headings
    stay visible while you scroll the grid.
  - The grid scrolls inside its own box (both axes); the page never scrolls
    sideways and the headings/paragraphs stay put.
  - Clicking a column header sorts by it (asc/desc toggle, numeric-aware:
    handles $, commas, %, a trailing "x", and K/M/B suffixes). Sorting is a pure
    enhancement — layout and column alignment are correct even if scripts are
    blocked.

One table, one scroller: the header and the body are a SINGLE `<table>`, so
columns can never drift out of alignment and no JavaScript is needed for layout.
(The previous design split each table into a pinned header table plus a separate
body table, then used JS to lock their widths and mirror horizontal scroll; that
misaligned whenever the viewer blocked scripts — e.g. Telegram's in-app browser —
which is exactly the bug this rewrite fixes.)

Render any report whose tables put the label in the first column:

    python3 qa-evidence/build-report.py qa-evidence/my-report.md

Or import it:

    from table_template import render
    render("in.md", "out.html", title="My report")
"""
from __future__ import annotations

import re
from pathlib import Path

from markdown_it import MarkdownIt

CSS = """
  :root { --gutter: clamp(16px, 4vw, 40px); }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: clamp(16px, 4vw, 40px) 0;
    background: #0f172a; color: #e2e8f0;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; line-height: 1.55;
  }
  .wrap { max-width: none; margin: 0; }
  h1 { color: #f8fafc; font-size: clamp(20px, 4vw, 28px); margin: 0 var(--gutter) 6px; }
  h2 { color: #93c5fd; font-size: clamp(17px, 3.4vw, 21px); margin: 34px var(--gutter) 10px;
       border-bottom: 1px solid #334155; padding-bottom: 6px; }
  h3 { color: #bfdbfe; font-size: clamp(15px, 3vw, 17px); margin: 22px var(--gutter) 8px; }
  p, ul, ol { margin-left: var(--gutter); margin-right: var(--gutter);
              max-width: 1100px; font-size: clamp(13px, 2.7vw, 14.5px); }
  a { color: #7dd3fc; }
  strong { color: #f1f5f9; }
  code { font-family: "SF Mono", Consolas, monospace; background: #1e293b;
         color: #7dd3fc; padding: 2px 6px; border-radius: 5px; font-size: 12.5px;
         overflow-wrap: anywhere; word-break: break-word; }
  hr { border: none; border-top: 1px solid #334155; margin: 30px var(--gutter); }

  /* Sticky-header data grid: ONE table inside ONE scroll container.
     Alignment is structural (header and body are the same table), so it can
     never drift — not even when a viewer blocks scripts. The old two-table
     design needed JS to lock widths and mirror scroll, and misaligned the
     moment JS did not run (e.g. Telegram's in-app browser). */
  .sticky-table { margin: 14px 0; }
  .st-scroll { max-height: 80vh; overflow: auto; -webkit-overflow-scrolling: touch;
               border: 1px solid #334155; }
  .st-table { border-collapse: separate; border-spacing: 0; background: #1e293b; }

  th, td { padding: 11px 14px; text-align: left; font-size: 13.5px;
           border-bottom: 1px solid #334155; vertical-align: top; overflow-wrap: break-word; }
  /* Headings never clip: size the column to the full header label. */
  thead th { position: sticky; top: 0; z-index: 6; background: #1d4ed8; color: #fff;
             font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em;
             white-space: nowrap; border-bottom: 2px solid #1e40af;
             cursor: pointer; user-select: none; }
  thead th:hover { background: #2563eb; }
  thead th[data-sort-dir="asc"]::after  { content: " \\25B2"; font-size: 9px; }
  thead th[data-sort-dir="desc"]::after { content: " \\25BC"; font-size: 9px; }

  /* Sticky first column (~150px), in both the header and the body rows. */
  th:first-child, td:first-child {
    position: sticky; left: 0; z-index: 3;
    width: 150px; min-width: 150px; max-width: 150px;
    white-space: normal; overflow-wrap: anywhere; background: #1e293b;
    box-shadow: 2px 0 0 0 #334155;
  }
  thead th:first-child { z-index: 7; background: #1d4ed8; }
  tbody tr:nth-child(even) { background: #182234; }
  tbody tr:nth-child(even) td:first-child { background: #182234; }
  tbody tr:last-child td { border-bottom: none; }
  /* Long free-text note column wraps instead of stretching the grid. */
  td:last-child { min-width: 220px; max-width: 340px; white-space: normal; }
  /* Code/identifiers wrap INSIDE their cell instead of spilling into the next
     column (the sticky first column is only 150px, so long IDs must break). */
  td code, th code { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
"""

JS = """
(function () {
  // Tolerates markdown bold/backticks, "~"/"≈"/"≥" prefixes, "(est.)" suffixes,
  // $ , % x, and K/M/B suffixes, so numeric columns sort numerically.
  function parseNum(raw) {
    var s = (raw || "").trim().replace(/[*`]/g, "")
      .replace(/\\(est\\.?\\)|\\(estimated\\)/ig, "").trim();
    s = s.replace(/^[~≈≥>]\\s*/, "").replace(/[$,\\s]/g, "").replace(/%$/, "").replace(/x$/i, "");
    var m = s.match(/^(-?\\d+(?:\\.\\d+)?)([KkMmBb])?$/);
    if (!m) return NaN;
    var n = parseFloat(m[1]);
    if (m[2]) n *= { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
    return n;
  }
  function isMissing(raw) {
    var s = (raw || "").trim().toLowerCase();
    return s === "" || s === "—" || s === "–" || s === "-" || s === "n/a" || s === "na" || s === "tbd" || s === "?";
  }
  // null = known-missing, NaN = non-numeric text, number = numeric
  function cellNum(raw) {
    if (isMissing(raw)) return null;
    var n = parseNum(raw);
    return isNaN(n) ? NaN : n;
  }

  // Layout needs no script: sticky thead + sticky first column are pure CSS,
  // and the header/body share one table so columns are always aligned.
  // This script only adds click-to-sort, and is safe to be blocked.
  document.querySelectorAll(".sticky-table").forEach(function (grid) {
    var table = grid.querySelector("table");
    if (!table || !table.tHead || !table.tBodies.length) return;
    var headCells = table.tHead.rows[0].cells;
    var bodyRows = table.tBodies[0].rows;
    if (!headCells.length || !bodyRows.length) return;

    Array.prototype.forEach.call(headCells, function (th, idx) {
      th.title = "Click to sort by this column";
      th.addEventListener("click", function () {
        var dir = th.getAttribute("data-sort-dir") === "asc" ? -1 : 1;
        Array.prototype.forEach.call(headCells, function (o) { o.removeAttribute("data-sort-dir"); });
        th.setAttribute("data-sort-dir", dir === 1 ? "asc" : "desc");
        var rows = Array.prototype.slice.call(bodyRows);
        // Numeric column: every cell is a number or a missing marker (no free text).
        var numeric = rows.every(function (r) {
          var v = cellNum(r.cells[idx] ? r.cells[idx].textContent : "");
          return v === null || !isNaN(v);
        });
        var key = function (r) {
          var t = r.cells[idx] ? r.cells[idx].textContent.trim() : "";
          if (numeric) return cellNum(t);   // number, or null when missing
          return t.toLowerCase();
        };
        rows.sort(function (a, b) {
          var ka = key(a), kb = key(b);
          if (ka === null && kb === null) return 0;
          if (ka === null) return 1;        // missing values always sort last
          if (kb === null) return -1;
          return ka < kb ? -1 * dir : ka > kb ? 1 * dir : 0;
        });
        rows.forEach(function (r) { table.tBodies[0].appendChild(r); });
      });
    });
  });
})();
"""

_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
  <div class="wrap">
{body}
  </div>
<script>{js}</script>
</body>
</html>
"""


def _wrap_tables(html: str) -> str:
    """Wrap each <table> in a single scroll container (one table, no splitting)."""
    def repl(match: re.Match) -> str:
        table = match.group(0)
        if "<thead>" not in table or "<tbody>" not in table:
            return table
        table = table.replace("<table>", '<table class="st-table">', 1)
        return f'<div class="sticky-table"><div class="st-scroll">{table}</div></div>'

    return re.sub(r"<table>.*?</table>", repl, html, flags=re.S)


def render_text(md_text: str, out: str | Path, title: str | None = None) -> Path:
    """Render Markdown text straight to the HTML grid (no intermediate .md file)."""
    out = Path(out)
    if title is None:
        for line in md_text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        title = title or out.stem.replace("-", " ").title()
    body = _wrap_tables(MarkdownIt("gfm-like").render(md_text))
    out.write_text(_TEMPLATE.format(title=title, css=CSS, js=JS, body=body), encoding="utf-8")
    return out


def render(src: str | Path, out: str | Path | None = None, title: str | None = None) -> Path:
    src = Path(src)
    out = Path(out) if out else src.with_suffix(".html")
    return render_text(src.read_text(encoding="utf-8"), out, title)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("usage: python3 table_template.py <input.md> [output.html] [title]")
        raise SystemExit(2)
    print("wrote", render(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None,
                         sys.argv[3] if len(sys.argv) > 3 else None))
