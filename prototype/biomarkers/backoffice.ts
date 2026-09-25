import {
  biomarkerDefinitions,
  getBiomarkerStatus,
  getBiomarkerStatusLabel,
  getMappedBiomarkerKey,
  normalizeBiomarkerName,
} from "../../src/utils/biomarkers.ts";
import type {
  BiomarkerTemplate,
  CatalogSnapshot,
  CaseFile,
  ClassifiedRow,
  IntakeRow,
  LogPoint,
  MatchKind,
  ProfileFixture,
} from "./schema.ts";

export function isCatalogKey(key: string): boolean {
  if (!key) return false;
  return biomarkerDefinitions.some((d) => d.key === key);
}

function populationRangeText(def: (typeof biomarkerDefinitions)[number]): string {
  const crs = def.customRanges as any[] | undefined;
  if (!Array.isArray(crs) || !crs.length) return "";
  return crs
    .map((cr) => {
      const conds = cr?.range?.conditions;
      if (!Array.isArray(conds)) return "";
      const body = conds
        .map((c: any) => `${c.alias || ""}: ${c.operator || ""} ${c.value}`.trim())
        .join("; ");
      return body ? `[All patients] ${body}` : "";
    })
    .filter(Boolean)
    .join(" | ");
}

export function catalogSnapshot(key: string): CatalogSnapshot | null {
  const def = biomarkerDefinitions.find((d) => d.key === key);
  if (!def) return null;
  return {
    key: def.key,
    name: def.name,
    unit: def.unit,
    normalRange: def.normalRange,
    description: def.descriptions?.en || def.name,
    riskCategories: [...(def.riskCategories || [])],
    aliases: [...(def.aliases || [])],
    customRangePopulation: populationRangeText(def),
    notUsed: false,
  };
}

export function logTrend(logs: LogPoint[]): string | null {
  if (!logs || logs.length < 2) return null;
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const prev = sorted[sorted.length - 2];
  const cur = sorted[sorted.length - 1];
  if (prev.value === cur.value) return `stable ${cur.value}`;
  return `${prev.value} → ${cur.value}`;
}

export function isOptimalLabel(label: string): boolean {
  return /^(optimal|normal|healthy)$/i.test((label || "").trim());
}

function matchKind(printed: string, mappedKey: string): MatchKind {
  const def = biomarkerDefinitions.find((d) => d.key === mappedKey);
  if (!def) return "none";
  const slug = printed.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (def.key === slug || def.key.replace(/_/g, "") === slug.replace(/_/g, "")) return "key";
  return "alias";
}

export function assembleTemplate(
  row: IntakeRow,
  opts: {
    match: MatchKind;
    writeTarget: "observation" | "pending";
    catalog: CatalogSnapshot | null;
    mappedKey: string;
    history: LogPoint[];
    profile?: ProfileFixture;
  }
): BiomarkerTemplate {
  const logs: LogPoint[] = [
    ...opts.history.filter((h) => !(h.date === row.date && h.value === row.value)),
    { date: row.date, value: row.value, unit: row.unit },
  ];
  let status = "";
  if (opts.catalog) {
    const def = biomarkerDefinitions.find((d) => d.key === opts.catalog!.key);
    const st = getBiomarkerStatus(opts.catalog.key, row.value, def?.normalRange, def, opts.profile);
    status = getBiomarkerStatusLabel(opts.catalog.key, st, def, row.value, opts.profile);
  }
  return {
    id: row.id,
    printed: row.printed,
    match: opts.match,
    writeTarget: opts.writeTarget,
    biomarkerName: opts.catalog?.name || row.printed,
    key: opts.catalog?.key || null,
    alias: opts.catalog?.aliases || [],
    normalRange: opts.catalog?.normalRange || "",
    unit: opts.catalog?.unit || row.unit,
    description: opts.catalog?.description || "",
    riskCategories: opts.catalog?.riskCategories || [],
    notUsed: opts.catalog?.notUsed || false,
    customRangePopulation: opts.catalog?.customRangePopulation || "",
    customRangeOverlay: null,
    medicalInsight: "",
    historicalLogs: logs,
    currentEvaluationStatus: status,
    newCatalogDraft: null,
  };
}

export function classifyRow(
  row: IntakeRow,
  historyByKey: Record<string, LogPoint[]> = {},
  profile?: ProfileFixture
): ClassifiedRow {
  const mapped = getMappedBiomarkerKey(row.printed, normalizeBiomarkerName(row.printed) || row.printed);
  const known = isCatalogKey(mapped);
  const catalog = known ? catalogSnapshot(mapped) : null;
  const match = known ? matchKind(row.printed, mapped) : "none";
  const writeTarget = known ? "observation" : "pending";
  const histKey = catalog?.key || mapped;
  return {
    id: row.id,
    printed: row.printed,
    value: row.value,
    unit: row.unit,
    date: row.date,
    mappedKey: mapped,
    match,
    writeTarget,
    catalog,
    template: assembleTemplate(row, {
      match,
      writeTarget,
      catalog,
      mappedKey: mapped,
      history: historyByKey[histKey] || historyByKey[row.printed] || [],
      profile,
    }),
  };
}

export function classifyRows(
  rows: IntakeRow[],
  historyByKey: Record<string, LogPoint[]> = {},
  profile?: ProfileFixture
): ClassifiedRow[] {
  return rows.map((r) => classifyRow(r, historyByKey, profile));
}

export function caseHistory(caseFile: CaseFile): Record<string, LogPoint[]> {
  return caseFile.history || {};
}

export function batchRows<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
