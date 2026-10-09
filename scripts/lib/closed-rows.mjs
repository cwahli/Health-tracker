/**
 * A Current-work row marked COMPLETE is closed.
 * The plan files that row links must not still introduce it as open work.
 */

const FORBIDDEN = [
  { name: 'only open card', re: /only open card/i },
  { name: 'pick up the next open card', re: /pick up the next open card/i },
  { name: 'row is OPEN', re: /\bis OPEN\b/ },
  { name: 'do not mark the row done', re: /Do not mark [A-Z0-9.-]+ done/ },
  { name: 'is the next open card', re: /is the next open card/i },
];

export function currentWorkSection(markdown) {
  const text = String(markdown);
  const start = text.search(/^## Current work\b/m);
  if (start < 0) return '';
  const rest = text.slice(start);
  const nl = rest.indexOf('\n');
  const next = rest.slice(nl + 1).search(/\n## /);
  return next < 0 ? rest : rest.slice(0, nl + 1 + next);
}

export function closedRowsFromRoadmap(markdown) {
  return completeItems(currentWorkSection(markdown)).map((item) => item.id);
}

export function completeItems(section) {
  const items = [];
  for (const line of String(section).split('\n')) {
    const m = line.match(/\*\*(.+?)\s+(?:COMPLETE|closed)\b/);
    if (!m) continue;
    const id = m[1].replace(/\s+/g, ' ').trim();
    const links = [];
    for (const link of line.matchAll(/\(\.\/([^)]+\.md)\)/g)) {
      links.push(`plan/${link[1]}`);
    }
    items.push({ id, links });
  }
  return items;
}

export function preambleOf(text) {
  const body = String(text);
  const m = body.match(/\n## /);
  return m ? body.slice(0, m.index) : body;
}

export function preambleHits(preamble) {
  return FORBIDDEN.filter((row) => row.re.test(preamble)).map((row) => row.name);
}

export function card9HeadingHits(text) {
  return String(text)
    .split('\n')
    .filter((line) => /^#{2,3} Card 9\b/.test(line) && !/CLOSED|COMPLETE/.test(line));
}

/** Body under a Card 9 heading that already says CLOSED or COMPLETE. */
export function closedCardSectionHits(text) {
  const hits = [];
  const lines = String(text).split('\n');
  let collecting = false;
  const buf = [];
  const flush = () => {
    if (/is the next open card/i.test(buf.join('\n'))) hits.push('is the next open card');
    buf.length = 0;
  };
  for (const line of lines) {
    if (/^#{2,3} Card 9\b/.test(line)) {
      if (collecting) flush();
      collecting = /CLOSED|COMPLETE/.test(line);
      continue;
    }
    if (collecting && /^#{1,3} /.test(line)) {
      flush();
      collecting = false;
    } else if (collecting) buf.push(line);
  }
  if (collecting) flush();
  return hits;
}

/**
 * @param {{ roadmap: string, files: Record<string, string> }} input
 * @returns {string[]} problems, empty when a COMPLETE row stays closed
 */
export function contradictions({ roadmap, files }) {
  const problems = [];
  for (const item of completeItems(currentWorkSection(roadmap))) {
    for (const rel of item.links) {
      const body = files[rel];
      if (body == null) {
        problems.push(`${item.id}: linked ${rel} is missing`);
        continue;
      }
      for (const hit of preambleHits(preambleOf(body))) {
        problems.push(`${rel}: ${item.id} is COMPLETE and the plan header still says "${hit}"`);
      }
      for (const heading of card9HeadingHits(body)) {
        problems.push(`${rel}: Card 9 heading does not say CLOSED or COMPLETE: ${heading}`);
      }
      for (const hit of closedCardSectionHits(body)) {
        problems.push(`${rel}: ${item.id} is COMPLETE and the card section still says "${hit}"`);
      }
    }
  }
  return problems;
}
