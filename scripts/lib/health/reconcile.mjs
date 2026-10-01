/**
 * reconcile.mjs — what the app stored vs what the lab sheet says, and the
 * fix-list items that track whether each problem is still there.
 *
 * WHY THE ITEMS ARE CODE, NOT A PARAGRAPH
 * ---------------------------------------
 * The v0 fix list was a markdown table a human read. That works once and rots:
 * nothing tells you whether item 4 has been fixed, and the next pass re-audits
 * by eye. Here every item is a predicate over the same report the verify command
 * prints, so `/health verify` answers "closed / open" per item, and the sensor in
 * `scripts/assert-external-health.test.mjs` drives a fixture through
 * "wrong data → fix applied → item flips to closed". A predicate that can never
 * flip is a bug, and that sensor is what catches it.
 *
 * Everything in this file is pure: it takes the sheet rows and the app rows, it
 * returns a report. No network, no filesystem, no clock.
 */
import { MARKER_LABELS } from './sheet.mjs';
import { valuesEqual, numericGroups } from './values.mjs';

// Re-exported so a caller has one import for "the diff and how it compares".
export { valuesEqual, numericGroups };

const label = (key) => MARKER_LABELS[key] || key;
export { label as markerLabel };

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * The app's stored rows, as a queryable state.
 *
 * `byId` keeps each row's own marker blob because the useful question is not
 * "which value is wrong" but "which ROW is filed under the wrong day" — one
 * mis-dated row carries twenty-odd values, and twenty-odd line items is how a
 * fix list stops being read.
 */
export function extractAppState(rows = []) {
  const normalize = (row) => {
    let markers = {};
    try {
      const parsed = JSON.parse(String(row?.biomarkers ?? '{}'));
      if (parsed && typeof parsed === 'object') markers = parsed;
    } catch { markers = {}; }
    return { id: row.id, date: row.date, markers, count: Object.keys(markers).length, note: row?.note || '' };
  };
  const list = rows.map(normalize);
  const entries = [];
  for (const row of list) {
    for (const [key, value] of Object.entries(row.markers)) {
      entries.push({ key, value, date: row.date, rowId: row.id, note: row.note });
    }
  }
  const byDate = {};
  for (const row of list) (byDate[row.date] = byDate[row.date] || []).push(row);

  const duplicateDates = Object.entries(byDate)
    .filter(([, rowsOnDate]) => rowsOnDate.length > 1)
    .map(([date, rowsOnDate]) => ({ date, rows: rowsOnDate.length, ids: rowsOnDate.map((r) => r.id) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const duplicateGroups = duplicateDates.map(({ date }) => {
    const groups = [];
    for (const row of byDate[date]) {
      const signature = JSON.stringify(Object.entries(row.markers).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
      const hit = groups.find((g) => g.signature === signature);
      if (hit) hit.ids.push(row.id);
      else groups.push({ signature, ids: [row.id], count: row.count, markers: row.markers });
    }
    return { date, groups };
  });

  const emptyRows = list.filter((r) => r.count === 0).map((r) => ({ date: r.date, id: r.id }));

  return { entries, rows: list, byId: Object.fromEntries(list.map((r) => [r.id, r])), byDate, duplicateDates, duplicateGroups, emptyRows, rowCount: list.length };
}

/**
 * The diff. Sheet rows go in, verdicts come out, one verdict per sheet value.
 *
 * The matching is deliberately nearest-date greedy rather than a key on the
 * date: the defect being hunted is a row whose DATE is wrong, so "the value is
 * here, three weeks off" has to be visible as a date mismatch instead of
 * disappearing into a missing/extra pair.
 */
export function reconcile({ sheetRows = [], appState } = {}) {
  const state = appState || extractAppState([]);
  const sheet = sheetRows.filter((r) => r && r.date && r.test);
  // Array.prototype.sort inside the loops below is on copies; the marker labels
  // come from the sheet module so the two cannot drift.

  const summary = { match: 0, dateMismatch: 0, valueMismatch: 0, missing: 0, gap: 0, appOnly: 0, appOnlyUnreviewed: 0 };
  const byKey = {};
  const ensure = (key) => (byKey[key] = byKey[key] || { sheet: [], app: [], verdicts: [] });

  for (const rec of sheet) {
    if (rec.map?.skip || rec.map?.unknown) continue;
    const key = rec.map.key;
    ensure(key);
    byKey[key].sheet.push({
      date: rec.date, dateRaw: rec.dateRaw, value: rec.value, unit: rec.unit,
      raw: rec.resultRaw, range: rec.range, gap: Boolean(rec.map.gap), test: rec.test,
    });
  }
  for (const entry of state.entries) {
    ensure(entry.key);
    byKey[entry.key].app.push(entry);
  }

  for (const [key, bucket] of Object.entries(byKey)) {
    // The sheet repeats some lines verbatim; a duplicate source line is one value.
    const seen = new Set();
    bucket.sheet = bucket.sheet.filter((s) => {
      if (s.value === null || s.value === '' || s.gap) return true;
      const signature = `${s.date}|${s.value}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });

    const valued = bucket.sheet.filter((s) => !s.gap && s.value !== null && s.value !== '');
    const appItems = bucket.app.map((a, i) => ({ ...a, i }));

    const pairs = [];
    for (let si = 0; si < valued.length; si += 1) {
      for (const a of appItems) {
        if (valuesEqual(a.value, valued[si].value)) pairs.push({ si, ai: a.i, d: Math.abs(daysBetween(valued[si].date, a.date)) });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    const usedSheet = new Set();
    const usedApp = new Set();
    const assign = new Map();
    for (const pair of pairs) {
      if (usedSheet.has(pair.si) || usedApp.has(pair.ai)) continue;
      usedSheet.add(pair.si);
      usedApp.add(pair.ai);
      assign.set(pair.si, pair.ai);
    }

    for (let si = 0; si < valued.length; si += 1) {
      const s = valued[si];
      const ai = assign.get(si);
      if (ai !== undefined) {
        const a = appItems[ai];
        if (s.date === a.date) {
          bucket.verdicts.push({ key, verdict: 'MATCH', date: s.date, value: s.value, unit: s.unit, appValue: a.value, rowId: a.rowId });
          summary.match += 1;
        } else {
          bucket.verdicts.push({ key, verdict: 'DATE_MISMATCH', date: s.date, value: s.value, unit: s.unit, appDate: a.date, appValue: a.value, rowId: a.rowId, offDays: daysBetween(s.date, a.date) });
          summary.dateMismatch += 1;
        }
        continue;
      }
      const sameDate = appItems.find((a) => a.date === s.date && !usedApp.has(a.i));
      if (sameDate) {
        usedApp.add(sameDate.i);
        bucket.verdicts.push({ key, verdict: 'VALUE_MISMATCH', date: s.date, value: s.value, unit: s.unit, appValue: sameDate.value, rowId: sameDate.rowId });
        summary.valueMismatch += 1;
        continue;
      }
      const nearest = appItems
        .filter((a) => !usedApp.has(a.i))
        .map((a) => ({ a, d: Math.abs(daysBetween(s.date, a.date)) }))
        .sort((x, y) => x.d - y.d)[0];
      bucket.verdicts.push({
        key, verdict: 'MISSING', date: s.date, value: s.value, unit: s.unit,
        appNearest: nearest ? { date: nearest.a.date, value: nearest.a.value, offDays: nearest.d, rowId: nearest.a.rowId } : null,
      });
      summary.missing += 1;
    }

    for (const s of bucket.sheet) {
      if (!s.gap) continue;
      bucket.verdicts.push({ key, verdict: 'GAP', date: s.date, value: s.value, unit: s.unit, test: s.test });
      summary.gap += 1;
    }

    // Where else the sheet carries each value — a value found under another
    // date is a wrong-day filing, not an unexplained row.
    const sheetDatesByValue = new Map();
    for (const s of bucket.sheet) {
      if (s.gap || s.value === null || s.value === '') continue;
      const signature = String(s.value).trim().toLowerCase();
      sheetDatesByValue.set(signature, [...(sheetDatesByValue.get(signature) || []), s.date]);
    }

    for (const a of appItems) {
      if (usedApp.has(a.i)) continue;
      const signature = String(a.value ?? '').trim().toLowerCase();
      const sourceDates = sheetDatesByValue.get(signature) || [];
      const twin = sourceDates.find((d) => appItems.some((o) => o.i !== a.i && o.date === d && String(o.value ?? '').trim().toLowerCase() === signature)) || null;
      bucket.verdicts.push({
        key, verdict: 'APP_ONLY', date: a.date, appValue: a.value, rowId: a.rowId,
        sourceDates, copyOfDate: twin,
        device: key === 'steps',
      });
    }
  }

  // One app row holding values whose sheet dates differ = a mis-filed row.
  const clusters = {};
  for (const bucket of Object.values(byKey)) {
    for (const v of bucket.verdicts) {
      if (v.verdict !== 'DATE_MISMATCH') continue;
      clusters[v.rowId] = clusters[v.rowId] || { rowId: v.rowId, appDate: v.appDate, bySourceDate: {}, values: 0, keys: [] };
      const c = clusters[v.rowId];
      c.bySourceDate[v.date] = (c.bySourceDate[v.date] || 0) + 1;
      c.values += 1;
      c.keys.push({ key: v.key, value: v.value, sourceDate: v.date, offDays: v.offDays });
    }
  }

  // An app-only value is not a mystery when the row it sits in is already known
  // to hold another date's results: that row's fix (H-4) is where it is handled,
  // and repeating it here makes one defect look like twenty. `explainedBy`
  // records which of the three stories it belongs to, so the report can say so
  // instead of listing the same value twice.
  const clusterRows = new Set(Object.keys(clusters));
  summary.appOnly = 0;
  summary.appOnlyUnreviewed = 0;
  for (const bucket of Object.values(byKey)) {
    for (const v of bucket.verdicts) {
      if (v.verdict !== 'APP_ONLY') continue;
      if (v.device) { v.explainedBy = 'device'; continue; }
      if (v.copyOfDate) v.explainedBy = 'copy';
      else if (clusterRows.has(v.rowId)) v.explainedBy = 'row-date';
      else v.explainedBy = 'unexplained';
      summary.appOnly += 1;
      if (v.explainedBy === 'unexplained') summary.appOnlyUnreviewed += 1;
    }
  }

  // A sheet test this map does not know is invisible to every number above, so
  // it is counted and named instead of skipped quietly. The lab adding a test is
  // the normal case; the failure mode is the reconciliation under-reporting it.
  const unmapped = {};
  for (const rec of sheet) {
    if (!rec.map?.unknown) continue;
    unmapped[rec.test] = (unmapped[rec.test] || 0) + 1;
  }

  const sheetDates = [...new Set(sheet.map((r) => r.date))].sort();
  const appLabDates = [...new Set(state.rows.filter((r) => r.count > 0).map((r) => r.date))].sort();
  const newestSheetDate = sheetDates.slice(-1)[0] || '';
  const newerInApp = appLabDates.filter((d) => d > newestSheetDate);

  return {
    summary,
    byKey,
    clusters: Object.fromEntries(Object.entries(clusters).sort((a, b) => (a[1].appDate < b[1].appDate ? -1 : 1))),
    structural: {
      duplicateDates: state.duplicateDates,
      duplicateGroups: state.duplicateGroups,
      emptyRows: state.emptyRows,
      rowCount: state.rowCount,
    },
    sheet: { rows: sheet.length, dates: sheetDates, newestDate: newestSheetDate, tab: '', unmapped: Object.entries(unmapped).map(([test, count]) => ({ test, count })) },
    app: { dates: appLabDates, newestDate: appLabDates.slice(-1)[0] || '', newerThanSheet: newerInApp },
  };
}

/** Every verdict of one kind, flattened, with its marker key attached. */
export function verdictsOf(report, kind) {
  return Object.entries(report.byKey).flatMap(([key, bucket]) =>
    bucket.verdicts.filter((v) => v.verdict === kind).map((v) => ({ key, ...v })));
}

/**
 * The app rows a human still has to explain: no sheet line, no twin copy, and
 * not part of a row whose date is already wrong (H-4 owns that one).
 */
export function unreviewedAppRows(report) {
  return verdictsOf(report, 'APP_ONLY').filter((v) => (v.explainedBy || (v.device ? 'device' : v.copyOfDate ? 'copy' : 'unexplained')) === 'unexplained');
}

/**
 * The fix list, as checks.
 *
 * Each item is the v0 list's row, phrased as the property that must become true.
 * `waived` is the user's only way out of an item they do not want to fix — it
 * leaves the item in the report as waived rather than closed, so the docs can
 * say "known gap" instead of pretending the data is clean.
 */
export const FIX_LIST = [
  {
    id: 'H-1',
    title: 'Profile demographics match the sheet',
    check: ({ profile = {}, report } = {}) => {
      // The sheet measures height and weight itself, which is the only receipt
      // in the project for them. A tolerance is right here: 62.4 vs 62 kg is a
      // measurement, 178 vs 163 cm is a placeholder nobody measured.
      const latestSheet = (key) => {
        const vals = (report?.byKey?.[key]?.sheet || [])
          .filter((s) => !s.gap && s.value !== null && s.value !== '')
          .map((s) => ({ date: s.date, value: Number(s.value) }))
          .filter((s) => Number.isFinite(s.value))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        return vals.slice(-1)[0] || null;
      };
      const problems = [];
      const height = Number(profile.height);
      const weight = Number(profile.weight);
      const sheetHeight = latestSheet('height');
      const sheetWeight = latestSheet('weight');
      if (!Number.isFinite(height)) problems.push('no height on the profile');
      else if (sheetHeight && Math.abs(height - sheetHeight.value) > 3) {
        problems.push(`height ${profile.height} cm vs the sheet's ${sheetHeight.value} cm (${sheetHeight.date})`);
      }
      if (!Number.isFinite(weight)) problems.push('no weight on the profile');
      else if (sheetWeight && Math.abs(weight - sheetWeight.value) > 5) {
        problems.push(`weight ${profile.weight} kg vs the sheet's ${sheetWeight.value} kg (${sheetWeight.date})`);
      }
      // No date of birth anywhere in the stored profile means the age it shows
      // is whatever the application defaults to, which is not a fact about the user.
      const dob = profile.dateOfBirth || profile.dob || profile.birthDate || '';
      if (!String(dob).trim()) problems.push(`no date of birth recorded${profile.age ? ` (age ${profile.age} is an application default)` : ''}`);
      return {
        open: problems.length > 0,
        detail: problems.length
          ? problems.join('; ')
          : `height ${height} cm, weight ${weight} kg${dob ? `, born ${dob}` : ''}`,
      };
    },
  },
  {
    id: 'H-2',
    title: 'One app row per date (no duplicate rows)',
    check: ({ report } = {}) => {
      const dates = report?.structural?.duplicateDates || [];
      return {
        open: dates.length > 0,
        detail: dates.length
          ? `${dates.length} date(s) carry more than one row: ${dates.map((d) => `${d.date} (${d.rows})`).join(', ')}`
          : 'every date has a single row',
      };
    },
  },
  {
    id: 'H-3',
    title: 'No empty app rows',
    check: ({ report } = {}) => {
      const rows = report?.structural?.emptyRows || [];
      return { open: rows.length > 0, detail: rows.length ? `${rows.length} empty row(s): ${rows.map((r) => r.date).join(', ')}` : 'no empty rows' };
    },
  },
  {
    id: 'H-4',
    title: 'No app row carries another date’s results',
    check: ({ report } = {}) => {
      const clusters = Object.values(report?.clusters || {});
      return {
        open: clusters.length > 0,
        detail: clusters.length
          ? clusters.map((c) => `${c.appDate} → ${Object.keys(c.bySourceDate).sort().join(' / ')} (${c.values} values)`).join('; ')
          : 'every value sits on the date the sheet gives it',
      };
    },
  },
  {
    id: 'H-5',
    title: 'No value disagrees with the sheet on the same date',
    check: ({ report } = {}) => {
      const rows = verdictsOf(report || { byKey: {} }, 'VALUE_MISMATCH');
      return {
        open: rows.length > 0,
        detail: rows.length ? rows.map((v) => `${label(v.key)} on ${v.date}: app ${JSON.stringify(v.appValue)} vs sheet ${JSON.stringify(v.value)}`).join('; ') : 'no same-date conflicts',
      };
    },
  },
  {
    id: 'H-6',
    title: 'Every sheet value is present in the app',
    check: ({ report } = {}) => {
      const missing = Number(report?.summary?.missing) || 0;
      return { open: missing > 0, detail: missing ? `${missing} sheet value(s) have no counterpart in the app (see the add list)` : 'the app carries every sheet value' };
    },
  },
  {
    id: 'H-7',
    title: 'No unexplained app rows',
    check: ({ report } = {}) => {
      const rows = unreviewedAppRows(report || { byKey: {} });
      return {
        open: rows.length > 0,
        detail: rows.length ? rows.map((v) => `${label(v.key)} ${JSON.stringify(v.appValue)} on ${v.date}`).join('; ') : 'every app row is accounted for',
      };
    },
  },
  {
    id: 'H-8',
    title: 'No app results newer than the sheet',
    check: ({ report } = {}) => {
      const dates = report?.app?.newerThanSheet || [];
      return {
        open: dates.length > 0,
        detail: dates.length ? `the app holds results after the sheet’s newest date (${report.sheet.newestDate}): ${dates.join(', ')}` : `nothing newer than ${report?.sheet?.newestDate || '(none)'}`,
      };
    },
  },
];

/** Every item's state, in order, with waived items kept visible. */
export function evaluateFixList({ report, profile = {}, waived = [] } = {}) {
  const waivedIds = new Set(waived);
  const items = FIX_LIST.map((item) => {
    let outcome;
    try {
      outcome = item.check({ report, profile });
    } catch (err) {
      outcome = { open: true, detail: `check failed: ${err.message}` };
    }
    const state = waivedIds.has(item.id) ? 'waived' : outcome.open ? 'open' : 'closed';
    return { id: item.id, title: item.title, state, detail: outcome.detail };
  });
  const open = items.filter((i) => i.state === 'open');
  return {
    items,
    open: open.length,
    closed: items.filter((i) => i.state === 'closed').length,
    waived: items.filter((i) => i.state === 'waived').length,
    nextAction: open[0] || null,
  };
}
