/**
 * values.mjs — how one lab value is compared with another.
 *
 * This is its own module because both sides of the diff need it: the sheet
 * parser has to keep a composite result (`109 / 53 mmHg` is a blood pressure,
 * not a 109), and the reconciler has to compare it with whatever the app stored
 * (`109/53`). Putting the rule in either one would make the other import it in a
 * circle.
 */

/** Every number in a value, in order: `109 / 53 mmHg` -> [109, 53]. */
export function numericGroups(value) {
  return (String(value ?? '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

/**
 * Equality that survives the sheet's spelling and the app's.
 *
 * Three cases, in order: both sides are numbers (40 vs "40.0" — one HbA1c); both
 * sides list the same numbers (blood pressure is `109 / 53 mmHg` in the report
 * and `109/53` in the app, and a plain string compare calls that a conflict);
 * otherwise case-insensitive text (`NEGATIVE` vs `Negative`).
 */
export function valuesEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9;
  const ga = numericGroups(a);
  const gb = numericGroups(b);
  if (ga.length && ga.length === gb.length && ga.every((n, i) => Math.abs(n - gb[i]) < 1e-9)) return true;
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

/**
 * The value a sheet row carries, normalised for comparison.
 *
 * The default is the LEADING number, and that is deliberate: `22.7 kg/m2` is a
 * BMI of 22.7 (the `2` belongs to the unit), and `3 /12` is an AUDIT-C score of 3
 * (the 12 is the scale). A marker whose result genuinely is two numbers — blood
 * pressure is the only one in this sheet — declares it in `SHEET_MAP` with
 * `composite: true`, and then the whole result is kept so `valuesEqual` can
 * compare it against whatever spelling the app stored.
 *
 * Anything with no leading number stays the raw text, so a qualitative result is
 * never turned into a number it is not.
 */
export function normalizeSheetValue(resultRaw, { composite = false } = {}) {
  const raw = String(resultRaw ?? '').trim();
  if (!raw) return '';
  if (composite) return raw.replace(/\s+/g, ' ');
  const lead = raw.match(/^-?\d+(?:\.\d+)?/);
  return lead ? Number(lead[0]) : raw;
}
