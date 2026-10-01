/**
 * sheet.mjs — the authoritative lab sheet, and pulling it out of the Brief folder.
 *
 * WHY THE MAPPING LIVES IN THE REPO
 * ---------------------------------
 * The app keys a marker `hemoglobin`; the lab report calls it "Haemoglobin
 * estimation". Every reconciliation depends on that translation, and while the
 * fix-list loop lived in an ad-hoc folder outside the repo, the translation was
 * untracked: the next run started from nothing. It is here so a diff of the diff
 * is reviewable, and `mapSheetTest` is exported so a sensor can pin the names
 * that matter (a marker the lab renames must not silently become "unknown" and
 * drop out of the coverage count).
 *
 * The sheet's own shape is unusual and worth stating once: each row's FIRST cell
 * contains a whole quoted CSV line — `"date","test","result","range","comment"` —
 * because a previous export step stuffed a table into a column. Parsing therefore
 * unwraps one CSV layer and parses the inside, which is why `parseSheetCsv` looks
 * like it parses twice.
 *
 * Nothing in this module writes to Drive. `ingestBriefFolder` reads the Brief
 * folder and banks what it finds on disk, because the ingest has to be repeatable
 * and reviewable; publishing documents is a separate, later step.
 */
import path from 'node:path';
import {
  loadHostEnv,
  identityFromEnv,
  accessToken,
  listChildren,
  getFile,
  MIME,
  USER_AGENT,
  SCOPES,
} from '../google-store.mjs';
import { normalizeSheetValue } from './values.mjs';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/** One CSV line into fields. Handles doubled quotes, which the sheet uses. */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  const text = String(line ?? '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** `09-Jun-2026` -> `2026-06-09`. Anything else is not a date we accept. */
export function isoDate(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return '';
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1]}` : '';
}

/**
 * The unit that trails a sheet result.
 *
 * Only the value is removed. `23.49 kg/m2` keeps `kg/m2`, and
 * `80 mL/min/1.73m2` keeps the factor in the unit. A global strip of every
 * number turns both into `kg/m` and `mL/min/m`. An AUDIT-C `3 /12` drops the
 * scale, so the score stays unitless. Blood pressure is the composite: both
 * numbers are the value, and `mmHg` is the unit.
 */
export function unitFromResult(resultRaw, { composite = false } = {}) {
  const raw = String(resultRaw ?? '').trim();
  if (!raw) return '';
  if (composite) return raw.replace(/^-?\d+(?:\.\d+)?\s*\/\s*-?\d+(?:\.\d+)?/, '').trim();
  return raw.replace(/^-?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/, '').trim();
}

/** A leading number, or null. Units are whatever trails it. */
export function parseNumber(raw) {
  const m = String(raw ?? '').trim().match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** `NEGATIVE` / `NORMAL` out of a comment, for the qualitative rows. */
export function extractQual(comment, fallback = '') {
  const c = String(comment ?? '');
  const m = c.match(/\b(NEGATIVE|POSITIVE|Negative|Positive|EQUIVOCAL)\b/);
  if (m) return m[1].toUpperCase();
  if (/\b(Normal|normal)\b/.test(c)) return 'NORMAL';
  return fallback;
}

/**
 * Lab report test name -> app marker key.
 *
 * `skip: true` marks panel headers and procedural lines ("Renal profile",
 * "Sample site") that carry no value of their own. `gap: true` marks a row the
 * app has no catalog field for — the GPPAQ activity questions — which stay
 * visible as gaps instead of being quietly dropped.
 */
export const SHEET_MAP = {
  // (see the AUDIT-C spellings below for why an unmapped test is counted, not dropped)
  'Sample site': { skip: true },
  'CHLAMYDIA/GC PCR': { skip: true },
  'Renal profile': { skip: true },
  'Liver function test': { skip: true },
  'Bone profile': { skip: true },
  'Full blood count - FBC': { skip: true },
  'Point of care testing': { skip: true },
  'Serum lipids': { skip: true },
  'HbA1c levl - IFCC standardised': { key: 'hba1c' },
  'Se prostate specific Ag level': { key: 'prostate_specific_antigen' },
  'Serum sodium': { key: 'serum_sodium' },
  'Serum potassium': { key: 'serum_potassium' },
  'Serum creatinine': { key: 'creatinine' },
  'eGFRcreat (CKD-EPI)/1.73 m*2': { key: 'egfr' },
  'Serum albumin': { key: 'serum_albumin' },
  'Serum ALT level': { key: 'alt' },
  'Serum alkaline phosphatase': { key: 'alkaline_phosphatase' },
  'AST serum level': { key: 'ast' },
  'Serum total bilirubin level': { key: 'total_bilirubin' },
  'Serum total protein': { key: 'total_protein' },
  'Serum globulin': { key: 'serum_globulin' },
  'Serum calcium': { key: 'serum_calcium' },
  'Serum adjusted calcium conc': { key: 'serum_adjusted_calcium' },
  'Serum inorganic phosphate': { key: 'serum_inorganic_phosphate' },
  'Total white cell count': { key: 'wbc' },
  'Red blood cell (RBC) count': { key: 'rbc' },
  'Haemoglobin estimation': { key: 'hemoglobin' },
  Haemotocrit: { key: 'hematocrit' },
  Haematocrit: { key: 'hematocrit' },
  'Mean corpuscular volume (MCV)': { key: 'mean_corpuscular_volume' },
  'Mean corpusc. haemoglobin(MCH)': { key: 'mean_corpuscular_hemoglobin' },
  'Mean corpusc. Hb. conc. (MCHC)': { key: 'mean_corpuscular_hemoglobin_concentration' },
  'Red blood cell distribut width': { key: 'rdw' },
  'Platelet count': { key: 'platelets' },
  'Mean platelet volume': { key: 'mpv' },
  'Platelet distribution width': { key: 'platelet_distribution_width' },
  'Neutrophil count': { key: 'neutrophil_count' },
  'Lymphocyte count': { key: 'lymphocyte_count' },
  'Monocyte count': { key: 'monocyte_count' },
  'Eosinophil count': { key: 'eosinophil_count' },
  'Basophil count': { key: 'basophil_count' },
  'Nucleated red blood cell count': { key: 'nucleated_red_blood_cell_count' },
  'QRISK2 cardiovascular disease 10 year risk score': { key: 'qrisk2' },
  'Serum cholesterol': { key: 'total_cholesterol' },
  'Serum HDL cholesterol level': { key: 'hdl' },
  'Serum triglycerides': { key: 'triglycerides' },
  'Se non HDL cholesterol level': { key: 'non_hdl_cholesterol' },
  'Serum cholesterol/HDL ratio': { key: 'cholesterol_hdl_ratio' },
  'Calculated LDL cholesterol lev': { key: 'ldl' },
  'AUDIT-C (Alcohol Use Disorders Identification Test - Consumption) score': { key: 'audit_c_total_score' },
  'Body mass index': { key: 'bmi' },
  'Body weight': { key: 'weight' },
  'Standing height': { key: 'height' },
  'Ideal body weight': { key: 'ideal_body_weight' },
  'HUB HIV-1 AND 2 ANTIBODY / ANTIGEN': { key: 'hiv_1_2_antibody_antigen', qual: true },
  'Chlamydia DNA detection': { key: 'chlamydia_dna_detection', qual: true },
  'N. gonorrhoeae nucl acid detn': { key: 'n_gonorrhoeae_nucl_acid_detn', qual: true },
  'SARS-CoV-2 (severe acute respiratory syndrome coronavirus 2) RNA (ribonucleic acid) detection result negative': { key: 'sars_cov_2_rna_detection', qual: true },
  'Alcohol consumption': { key: 'alcohol_consumption' },
  'Alcohol use disorders identification test score': { key: 'audit_total_score' },
  'AUDIT score-freq of guilt or remorse after drinking in last year': { key: 'audit_guilt_remorse_score' },
  'AUDIT score - freq unable to remember previous night in last yr': { key: 'audit_memory_loss_score' },
  'AUDIT score - others concerned about drinking/suggest cut down': { key: 'audit_others_concerned_score' },
  'AUDIT score-freq drunk 6+units (fem)/8+units (male) last yr': { key: 'audit_binge_drinking_score' },
  // Two spellings of the same three questions exist in this sheet (the 2024
  // report prefixes them with "-C"). A spelling the map does not know is not a
  // harmless miss: the row disappears from the coverage numbers entirely, which
  // is why unmapped rows are counted and reported rather than dropped.
  'AUDIT-C score-freq drunk 6+units (fem)/8+units (male) last yr': { key: 'audit_binge_drinking_score' },
  'AUDIT-C score - units of alcohol drunk on a typical day': { key: 'audit_typical_consumption' },
  'AUDIT-C score - frequency of drinking alcohol': { key: 'audit_score_frequency_drinking' },
  'AUDIT score - units of alcohol drunk on a typical day': { key: 'audit_typical_consumption' },
  'AUDIT score - frequency of drinking alcohol': { key: 'audit_score_frequency_drinking' },
  'QDiabetes risk calculator score': { key: 'qdiabetes' },
  'FAST (Fast Alcohol Screening Test) score': { key: 'fast_alcohol_score' },
  // The one composite result in this sheet: the whole `109 / 53 mmHg` is the
  // value, and the app stores it as `109/53`.
  'Blood Pressure': { key: 'blood_pressure', composite: true },
  'Pulse rate': { key: 'pulse_rate' },
};

/** Human labels for the app keys, used in every report and bot reply. */
export const MARKER_LABELS = {
  hba1c: 'HbA1c', prostate_specific_antigen: 'PSA', serum_sodium: 'Sodium', serum_potassium: 'Potassium',
  creatinine: 'Creatinine', egfr: 'eGFR', serum_albumin: 'Albumin', alt: 'ALT', alkaline_phosphatase: 'ALP',
  ast: 'AST', total_bilirubin: 'Bilirubin', total_protein: 'Total protein', serum_globulin: 'Globulin',
  serum_calcium: 'Calcium', serum_adjusted_calcium: 'Adjusted calcium', serum_inorganic_phosphate: 'Phosphate',
  wbc: 'WBC', rbc: 'RBC', hemoglobin: 'Haemoglobin', hematocrit: 'Haematocrit', mean_corpuscular_volume: 'MCV',
  mean_corpuscular_hemoglobin: 'MCH', mean_corpuscular_hemoglobin_concentration: 'MCHC', rdw: 'RDW',
  platelets: 'Platelets', mpv: 'MPV', platelet_distribution_width: 'PDW', neutrophil_count: 'Neutrophils',
  lymphocyte_count: 'Lymphocytes', monocyte_count: 'Monocytes', eosinophil_count: 'Eosinophils',
  basophil_count: 'Basophils', nucleated_red_blood_cell_count: 'NRBC', qrisk2: 'QRISK2',
  total_cholesterol: 'Total cholesterol', hdl: 'HDL', triglycerides: 'Triglycerides',
  non_hdl_cholesterol: 'Non-HDL', cholesterol_hdl_ratio: 'Chol/HDL ratio', ldl: 'LDL',
  audit_c_total_score: 'AUDIT-C', bmi: 'BMI', weight: 'Weight', height: 'Height', ideal_body_weight: 'Ideal weight',
  hiv_1_2_antibody_antigen: 'HIV 1/2', chlamydia_dna_detection: 'Chlamydia', n_gonorrhoeae_nucl_acid_detn: 'Gonorrhoea',
  sars_cov_2_rna_detection: 'SARS-CoV-2', alcohol_consumption: 'Alcohol (U/wk)', audit_total_score: 'AUDIT total',
  audit_guilt_remorse_score: 'AUDIT guilt', audit_memory_loss_score: 'AUDIT memory',
  audit_others_concerned_score: 'AUDIT others', audit_binge_drinking_score: 'AUDIT binge',
  audit_typical_consumption: 'AUDIT typical', audit_score_frequency_drinking: 'AUDIT frequency',
  qdiabetes: 'QDiabetes', fast_alcohol_score: 'FAST', blood_pressure: 'Blood pressure', pulse_rate: 'Pulse',
  steps: 'Steps',
};

/** The app marker key a lab test name maps to, or how it is not usable. */
export function mapSheetTest(test) {
  const name = String(test ?? '').trim();
  if (Object.prototype.hasOwnProperty.call(SHEET_MAP, name)) return SHEET_MAP[name];
  if (/^GPPAQ/.test(name)) return { key: 'gppaq_activity', gap: true };
  return { unknown: true };
}

/** One sheet row's raw fields into a record with a mapped key and parsed value. */
export function sheetRecord(fields) {
  const [dateRaw, test, result, range, comment] = fields;
  const map = mapSheetTest(test);
  const rec = {
    date: isoDate(dateRaw),
    dateRaw: String(dateRaw ?? '').trim(),
    test: String(test ?? '').trim(),
    resultRaw: String(result ?? '').trim(),
    range: String(range ?? '').trim(),
    comment: String(comment ?? '').trim(),
    map,
  };
  if (!map.skip && !map.unknown) {
    if (map.qual) rec.value = extractQual(rec.comment, rec.test.toLowerCase().includes('negative') ? 'NEGATIVE' : '');
    else rec.value = normalizeSheetValue(rec.resultRaw, { composite: map.composite === true });
    rec.unit = unitFromResult(rec.resultRaw, { composite: map.composite === true });
  }
  return rec;
}

/**
 * The sheet's CSV export: each line is a CSV row whose first field holds the
 * inner `"date","test","result","range","comment"` line.
 */
export function parseSheetCsv(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    const outer = parseCsvLine(line);
    const inner = parseCsvLine(outer[0]);
    if (inner.length < 2) continue;
    if (inner[0].trim() === 'Date') continue;
    if (!inner[0].trim() && !inner[1].trim()) continue;
    const rec = sheetRecord(inner);
    if (!rec.date && !rec.test) continue;
    rows.push(rec);
  }
  return rows;
}

/**
 * The banked multi-tab dump `{ source, data: { tab: rows } }` — the shape
 * `ingestBriefFolder` writes and the shape this project reads back.
 */
export function parseSheetDump(text, { tab = '' } = {}) {
  const dump = JSON.parse(String(text ?? '{}'));
  const tabs = dump?.data && typeof dump.data === 'object' ? dump.data : {};
  const names = Object.keys(tabs);
  const wanted = tab || names.find((n) => /medical|test|result/i.test(n)) || names[0] || '';
  const rawRows = Array.isArray(tabs[wanted]) ? tabs[wanted] : [];
  return {
    source: dump?.source || {},
    tab: wanted,
    tabs: names,
    rows: rawRows.map((r) => sheetRecord(parseCsvLine(String(r?.[0] ?? '')))).filter((r) => r.date && r.test),
  };
}

/** Newest banked source file in a directory, preferring dumps over CSVs. */
export function newestSourceFile(dir, { readdir, exists }) {
  let entries = [];
  try { entries = readdir(dir) || []; } catch { return null; }
  const candidates = entries
    .filter((f) => /\.(json|csv)$/i.test(f))
    .sort();
  if (!candidates.length) return null;
  const dumps = candidates.filter((f) => /\.json$/i.test(f));
  const pick = (dumps.length ? dumps : candidates).slice(-1)[0];
  return exists(path.join(dir, pick)) ? path.join(dir, pick) : null;
}

/**
 * Read the banked dump and return the sheet's rows, in the given tab.
 * A `.csv` is accepted too, so a hand-exported copy is usable on day one.
 */
export function readBankedSheet(file, { tab = '' } = {}, fsLike) {
  const text = fsLike.readFileSync(file, 'utf8');
  if (/\.csv$/i.test(file)) return { source: { file }, tab: 'csv', tabs: [], rows: parseSheetCsv(text) };
  const dump = parseSheetDump(text, { tab });
  if (!dump.rows.length) dump.rows = parseSheetCsv(text);
  return { ...dump, file };
}

// ---------------------------------------------------------------- Brief folder

const stamp = (at = new Date()) => at.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const slugify = (name) => String(name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

/**
 * Every tab of a Google Sheet, as the dump shape this project reads back.
 * Drive's `export?mimeType=text/csv` only ever returns the FIRST tab, which is
 * how a three-tab workbook silently loses two thirds of its data.
 */
export async function readSpreadsheetTabs(fileId, token, { fetchImpl = fetch } = {}) {
  const metaRes = await fetchImpl(`${SHEETS}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('properties.title,sheets.properties.title')}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  const meta = await metaRes.json().catch(() => null);
  if (!metaRes.ok || !meta?.sheets) {
    const detail = meta?.error?.message || `HTTP ${metaRes.status}`;
    return { ok: false, error: `spreadsheet metadata failed: ${detail}` };
  }
  const tabs = meta.sheets.map((s) => s?.properties?.title).filter(Boolean);
  const data = {};
  for (const tab of tabs) {
    const url = `${SHEETS}/${encodeURIComponent(fileId)}/values/${encodeURIComponent(`${tab}!A1:Z1000`)}?majorDimension=ROWS`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: `tab "${tab}" failed: ${detail}` };
    }
    data[tab] = body?.values || [];
  }
  return { ok: true, title: meta?.properties?.title || '', tabs, data };
}

/**
 * Read the Brief folder and bank what is in it.
 *
 * Reads only: listings, spreadsheet values, and the text export of a Doc.
 * Writes only under `outDir` (the project workspace), so the same ingest can be
 * re-run and diffed, and a failed fetch leaves the previous snapshot in place.
 */
export async function ingestBriefFolder({
  folderId,
  outDir,
  token,
  fetchImpl = fetch,
  now = new Date(),
  writeFile,
  mkdir,
} = {}) {
  if (!folderId) return { ok: false, error: 'no Brief folder configured' };
  if (!token) return { ok: false, error: 'no Google credential for the ingest' };
  const listing = await listChildren(folderId, token);
  if (!listing.ok) return { ok: false, error: `listing the Brief folder failed: ${listing.error || 'HTTP error'}` };

  const files = listing.files || [];
  const at = stamp(now);
  const written = [];
  const skipped = [];
  mkdir(outDir);

  for (const file of files) {
    const isSheet = file.mimeType === MIME.sheet;
    const isDoc = file.mimeType === MIME.doc;
    try {
      if (isSheet) {
        const dump = await readSpreadsheetTabs(file.id, token, { fetchImpl });
        if (!dump.ok) { skipped.push({ id: file.id, name: file.name, reason: dump.error }); continue; }
        const name = `${slugify(file.name)}_${at}.json`;
        writeFile(
          path.join(outDir, name),
          JSON.stringify({
            source: { docId: file.id, title: dump.title || file.name, tabs: dump.tabs, modifiedTime: file.modifiedTime || '', fetchedAt: now.toISOString() },
            data: dump.data,
          }, null, 1),
        );
        written.push({ id: file.id, name: file.name, file: name, kind: 'sheet', tabs: dump.tabs.length });
      } else if (isDoc) {
        const target = `${DRIVE}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent('text/plain')}`;
        const res = await fetchImpl(target, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } });
        if (!res.ok) { skipped.push({ id: file.id, name: file.name, reason: `export failed: HTTP ${res.status}` }); continue; }
        const name = `${slugify(file.name)}_${at}.txt`;
        writeFile(path.join(outDir, name), await res.text());
        written.push({ id: file.id, name: file.name, file: name, kind: 'doc' });
      } else {
        // A folder (or an upload): recorded but not fetched — this ingest is
        // about documents and sheets, and guessing at binaries is how a folder
        // fills up with truncated PDFs.
        const detail = await getFile(file.id, token);
        skipped.push({
          id: file.id,
          name: file.name,
          reason: file.mimeType === MIME.folder
            ? 'subfolder — not descended into'
            : `unsupported type ${detail.file?.mimeType || file.mimeType || 'unknown'}`,
        });
      }
    } catch (err) {
      skipped.push({ id: file.id, name: file.name, reason: err.message });
    }
  }

  const manifest = {
    at: now.toISOString(),
    folderId,
    written,
    skipped,
    sources: ['google drive (read-only)'],
  };
  writeFile(path.join(outDir, `ingest_${at}.json`), JSON.stringify(manifest, null, 1));
  return { ok: true, manifest };
}

/**
 * The Google credential for the ingest, loaded the way every fleet surface loads
 * it.
 *
 * `accessToken` answers `{ ok, token, cached, kind }` — the token is a field, not
 * the return value. Reading it as a string is how a perfectly good credential
 * becomes `Bearer [object Object]` and a 401, so the shape is checked here.
 */
export async function briefCredential({ botId = '', env = process.env, home } = {}) {
  const loaded = loadHostEnv(botId, env, home ? { home } : {});
  const who = identityFromEnv(loaded.env);
  if (!who.ok) return { ok: false, error: `no Google credential: ${who.reason}`, env: loaded.env, sources: loaded.sources };
  let granted;
  try {
    granted = await accessToken(who, { scopes: Object.values(SCOPES) });
  } catch (err) {
    return { ok: false, error: `could not mint a token: ${err.message}`, env: loaded.env, sources: loaded.sources };
  }
  if (!granted?.ok || !granted.token) {
    const hint = granted?.hint ? ` — ${granted.hint}` : '';
    return { ok: false, error: `could not mint a token: ${granted?.error || 'token grant failed'}${hint}`, env: loaded.env, sources: loaded.sources };
  }
  return { ok: true, token: granted.token, identity: who, sources: loaded.sources };
}
