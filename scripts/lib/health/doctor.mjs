/**
 * doctor.mjs — the checker for the Doctor seat's report.
 *
 * The Doctor (`projects/external-health/roles/doctor.md`) re-reads the analyst's
 * claims and traces each one back to a receipt. That is a model judgement, and a
 * model judgement is exactly what cannot be trusted to police itself: asked for
 * "a report", a language model will produce a confident one in the requested
 * shape even when it read nothing. So the shape is checked here, mechanically,
 * before the report lands in the workspace — the same fail-closed move
 * `validateAnalysisSections` makes for the payload the publisher reads.
 *
 * Four refusals, each one a failure this seat exists to prevent:
 *
 *   1. **No coverage header.** A report that does not say how many claims it
 *      reviewed, what it could see, what it could not, what the gate was and
 *      which payload it read has no measurable claim of its own. A count is
 *      checked, not a vibe: `Coverage: 12 claim(s) reviewed` must match the
 *      number of blocks the report actually carries.
 *   2. **A finding with no receipt.** Every block must carry `Receipt:` with
 *      something in it. A verdict — PASS or STRIKE — that names no marker, no
 *      value and no date is an opinion about an opinion.
 *   3. **A PASS whose only evidence is an absence.** "Not measured", "no data",
 *      "nothing contradicted it": an absence cannot support a claim, it is
 *      itself a finding (soul law 4). The verdict for it is UNPROVEN. This is
 *      the failure mode the seat exists for, and it is the hardest one to
 *      notice by eye because reassurance reads as diligence.
 *   4. **A PASS on an open item.** A claim whose row is one of the open
 *      fix-list items is unproven until the item closes, no matter what the
 *      sheet says today — the item is open precisely because the app and the
 *      sheet disagree about it.
 *
 * The checker knows three facts about the world, and all three come from the
 * workspace, never from the report: whether the payload under review is
 * `absent`, `refused` by the publisher, or `accepted`; and which fix-list items
 * are open. `0 claim(s) reviewed` is therefore only legal when there is nothing
 * to review, and a report over a present payload must review at least one claim.
 *
 * Pure: no filesystem, no clock, no model. The runner owns the writes.
 */

/** The six labels every claim block carries, in the order the seat writes them. */
export const CLAIM_LABELS = ['Claim', 'Receipt', 'Status', 'Changes', 'Recommendation', 'Who'];

/**
 * The phrase bank that marks a receipt as an absence rather than evidence.
 *
 * Kept deliberately small and quoted in the seat file, so a model writing an
 * honest UNPROVEN can use these words on purpose and a model reaching for a
 * comfortable PASS has no way to phrase around them by accident.
 */
export const ABSENCE_PHRASES = /\b(?:none|no data|not measured|unmeasured|not present|absent|missing|unknown|n\/a|not available|no receipt|no value|nothing|never (?:measured|recorded|taken))\b/i;

/** A dated receipt: a claim that rests on something that happened on a day. */
const RECEIPT_DATE = /\(\d{4}-\d{2}-\d{2}\)/;

/** Statuses, with the optional open-item id the seat appends when it rests on one. */
const STATUS = /^(PASS|STRIKE|UNPROVEN)\b\s*(.*)$/i;

const stripMarks = (line) => String(line || '').replace(/\*/g, '');

/** The labelled lines of a block, first occurrence winning. */
function labelledLines(lines) {
  const out = new Map();
  for (const raw of lines) {
    const m = stripMarks(raw).match(/^\s*([A-Z][a-z]+)\s*:\s*(.*?)\s*$/);
    if (!m || !CLAIM_LABELS.includes(m[1]) || out.has(m[1])) continue;
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** Parse the numbered `## <n>. <claim>` blocks. */
function claimBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^##\s+(\d+)[.)]\s*(.+?)\s*$/);
    if (m) {
      current = { index: Number(m[1]), title: m[2], lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const b of blocks) {
    b.fields = labelledLines(b.lines);
    b.text = b.lines.join('\n');
  }
  return blocks;
}

const fail = (error) => ({ ok: false, error, report: null });

/**
 * Judge a report.
 *
 * `analysis` is the payload's state as the workspace actually holds it —
 * `present` maps to `'accepted' | 'refused' | 'absent'` — and `gate` is the
 * verdict `gateFromArtifact` gives the verify artifact. Both are passed in by
 * the caller from the same bytes the seat was handed, so the report cannot
 * define its own ground truth.
 */
export function validateDoctorReport(text, { analysis = 'absent', gate = { open: [] } } = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) return fail('the report is empty');

  const lines = raw.split(/\r?\n/);
  const first = stripMarks(lines.find((l) => l.trim()) || '').trim();
  if (!/^#\s*Doctor'?s report\b/i.test(first)) {
    return fail("no report heading — the first line must be `# Doctor's report — <YYYY-MM-DD>`");
  }
  if (!/\d{4}-\d{2}-\d{2}/.test(first)) {
    return fail('the report heading carries no date — `# Doctor\'s report — <YYYY-MM-DD>`');
  }

  const firstBlock = lines.findIndex((l) => /^##\s+\d+/.test(l));
  const head = (firstBlock === -1 ? lines : lines.slice(0, firstBlock)).map(stripMarks);
  const field = (name) => {
    const hit = head.find((l) => new RegExp(`^\\s*${name}\\s*:`, 'i').test(l)) || '';
    return hit.replace(new RegExp(`^\\s*${name}\\s*:\\s*`, 'i'), '').trim();
  };

  const coverage = field('Coverage');
  if (!coverage) {
    return fail('no coverage header — every report opens with `Coverage: <n> claim(s) reviewed · sections seen: …`');
  }
  const countMatch = coverage.match(/(\d+)\s+claim/i);
  if (!countMatch) {
    return fail('the coverage line carries no count — `Coverage: <n> claim(s) reviewed` is a number, not a vibe');
  }
  const reviewed = Number(countMatch[1]);
  for (const name of ['Not seen', 'Gate', 'Payload']) {
    if (!field(name)) return fail(`the coverage header is missing \`${name}:\``);
  }
  const gateLine = field('Gate');
  if (!/^(OPEN|CLOSED)\b/i.test(gateLine)) {
    return fail(`\`Gate:\` must say OPEN (<item ids>) or CLOSED — got \`${gateLine.slice(0, 40)}\``);
  }

  const blocks = claimBlocks(raw);
  if (analysis === 'accepted') {
    if (reviewed < 1) {
      return fail('the payload is present and accepted but the coverage line reviews 0 claim(s) — a report that checks nothing is not a review');
    }
    if (reviewed !== blocks.length) {
      return fail(`the coverage line says ${reviewed} claim(s) reviewed but the report carries ${blocks.length} block(s)`);
    }
  } else {
    if (reviewed !== 0) {
      return fail(`the coverage line claims ${reviewed} claim(s) reviewed but there is no readable payload to review — the count is 0`);
    }
    if (blocks.length) {
      return fail(`the report carries ${blocks.length} claim block(s) with no readable payload — there is nothing to check`);
    }
    if (!/analysis|health-analysis/i.test(field('Not seen'))) {
      return fail('0 claim(s) reviewed, so `Not seen:` must name the payload that could not be read');
    }
  }

  const openItems = (gate.open || []).map(String);
  const claims = [];
  for (const block of blocks) {
    for (const label of CLAIM_LABELS) {
      if (!block.fields.has(label) || !block.fields.get(label)) {
        return fail(`claim ${block.index} has no \`${label}:\` line — every block carries all six labels, filled in`);
      }
    }
    const receipt = block.fields.get('Receipt');
    if (!receipt) return fail(`claim ${block.index} carries no receipt — a finding with no receipt is refused`);
    const match = block.fields.get('Status').match(STATUS);
    if (!match) {
      return fail(`claim ${block.index} carries no verdict — Status must be PASS, STRIKE or UNPROVEN (H-n)`);
    }
    const status = match[1].toUpperCase();
    if (status === 'PASS') {
      if (ABSENCE_PHRASES.test(receipt)) {
        return fail(`claim ${block.index} PASSes on an absence — "${receipt.slice(0, 70)}" supports nothing; an absence is a finding, and the verdict is UNPROVEN`);
      }
      if (!RECEIPT_DATE.test(receipt)) {
        return fail(`claim ${block.index} PASSes without a date — a pass needs a marker, a value and a date: <marker> <value> (<date>)`);
      }
      const hit = openItems.find((id) => new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(block.text));
      if (hit) {
        return fail(`claim ${block.index} PASSes on open item ${hit} — while that item is open the verdict is UNPROVEN (${hit})`);
      }
    }
    claims.push({
      index: block.index,
      title: block.title,
      claim: block.fields.get('Claim'),
      receipt,
      status,
      item: (match[2] || '').trim(),
      changes: block.fields.get('Changes'),
      recommendation: block.fields.get('Recommendation'),
      who: block.fields.get('Who'),
    });
  }

  const counts = {
    pass: claims.filter((c) => c.status === 'PASS').length,
    strike: claims.filter((c) => c.status === 'STRIKE').length,
    unproven: claims.filter((c) => c.status === 'UNPROVEN').length,
  };
  return {
    ok: true,
    error: '',
    report: {
      title: first,
      coverage: {
        reviewed,
        seen: field('Coverage').split(/sections seen\s*:/i)[1]?.trim() || '',
        notSeen: field('Not seen'),
        gate: gateLine,
        payload: field('Payload'),
        raw: coverage,
      },
      claims,
      counts,
    },
  };
}

/** The bytes that go to disk: a report ends with exactly one newline. */
export function renderDoctorReport(text) {
  return `${String(text ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}
