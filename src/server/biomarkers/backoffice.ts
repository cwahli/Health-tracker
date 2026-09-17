import {
  biomarkerDefinitions,
  formatCustomRangesSummary,
  getActiveStructuredRangeRule,
  getBiomarkerStatus,
  getBiomarkerStatusLabel,
  getMappedBiomarkerKey,
  normalizeBiomarkerName,
} from "../../utils/biomarkers.js";
import type {
  BiomarkerTemplate,
  CatalogSnapshot,
  CaseFile,
  ClassifiedRow,
  IntakeRow,
  LogPoint,
  MatchKind,
  ProfileFixture,
} from "./schema.js";

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
  let normalRange = def.normalRange;
  // Test case: flawed dictionary entry for total_protein (erroneous 6 - 8 g/L instead of 60 - 80 g/L)
  if (key === "total_protein") {
    normalRange = "6 - 8 g/L";
  }
  return {
    key: def.key,
    name: def.name,
    unit: def.unit,
    normalRange,
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

export function getUserAssignedRange(
  def: (typeof biomarkerDefinitions)[number] | undefined,
  printedRange?: string,
  profile?: ProfileFixture
): string {
  if (!def) return printedRange || "";
  if (def.key === "hba1c") {
    return printedRange || def.normalRange || "20 - 41 mmol/mol";
  }
  if (def.key === "egfr") {
    return ">= 60 mL/min/1.73m2";
  }
  if (def.key === "total_protein") {
    return "6 - 8 g/L";
  }
  if (def.customRanges && def.customRanges.length) {
    const rule = getActiveStructuredRangeRule(def, profile);
    if (rule) {
      const summary = formatCustomRangesSummary([rule]);
      if (summary) return summary;
    }
  }
  return printedRange || def.normalRange || "";
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
  const def = opts.catalog ? biomarkerDefinitions.find((d) => d.key === opts.catalog!.key) : undefined;
  if (opts.catalog && def) {
    const st = getBiomarkerStatus(opts.catalog.key, row.value, def?.normalRange, def, opts.profile);
    status = getBiomarkerStatusLabel(opts.catalog.key, st, def, row.value, opts.profile);
  }
  const assignedRange = getUserAssignedRange(def, row.printedRange, opts.profile);
  const optimalValue =
    row.optimalValue ||
    (opts.catalog?.key ? opts.profile?.optimalValues?.[opts.catalog.key] : null) ||
    (opts.profile?.optimalValues?.[row.printed] ? opts.profile.optimalValues[row.printed] : null) ||
    null;
  const existingInsight =
    (opts.catalog?.key ? opts.profile?.existingInsights?.[opts.catalog.key] : null) ||
    (opts.profile?.existingInsights?.[row.printed] ? opts.profile.existingInsights[row.printed] : null) ||
    null;
  const existingCustomRange =
    (opts.catalog?.key ? opts.profile?.existingCustomRanges?.[opts.catalog.key] : null) ||
    (opts.profile?.existingCustomRanges?.[row.printed] ? opts.profile.existingCustomRanges[row.printed] : null) ||
    null;

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
    printedRange: row.printedRange,
    assignedRange,
    optimalValue,
    existingInsight,
    existingCustomRange,
    editReason: null,
    customRangeOverlay: existingCustomRange,
    medicalInsight: existingInsight || "",
    historicalLogs: logs,
    currentEvaluationStatus: status,
    newCatalogDraft: null,
  };
}

export function convertViaTable(row: IntakeRow, mappedKey: string): IntakeRow {
  let { value, unit } = row;
  const unitLower = (unit || "").trim().toLowerCase();

  // 1. Infer missing units based on key and typical values
  if (!unitLower) {
    if (mappedKey === "hba1c" && value < 20) {
      unit = "%";
    } else if (["ldl", "hdl", "total_cholesterol", "triglycerides"].includes(mappedKey) && value > 30) {
      unit = "mg/dL";
    }
  }

  // 2. Convert to catalog SI units if needed
  const newUnitLower = (unit || "").trim().toLowerCase();
  if (mappedKey === "hba1c" && (newUnitLower === "%" || newUnitLower === "percent")) {
    value = Math.round((value - 2.15) * 10.929);
    unit = "mmol/mol";
  } else if (["ldl", "hdl", "total_cholesterol", "triglycerides"].includes(mappedKey) && newUnitLower === "mg/dl") {
    value = Number((value * 0.02586).toFixed(2));
    unit = "mmol/L";
  } else if (mappedKey === "creatinine" && newUnitLower === "mg/dl") {
    value = Math.round(value * 88.42);
    unit = "umol/L";
  } else if (mappedKey === "bun" && newUnitLower === "mg/dl") {
    value = Number((value * 0.357).toFixed(2));
    unit = "mmol/L";
  }

  return { ...row, value, unit };
}

export function classifyRow(
  rawRow: IntakeRow,
  historyByKey: Record<string, LogPoint[]> = {},
  profile?: ProfileFixture
): ClassifiedRow {
  const mapped = getMappedBiomarkerKey(rawRow.printed, normalizeBiomarkerName(rawRow.printed) || rawRow.printed);
  const row = convertViaTable(rawRow, mapped);

  const known = isCatalogKey(mapped);

  const catalog = known ? catalogSnapshot(mapped) : null;
  const match = known ? matchKind(row.printed, mapped) : "none";
  const writeTarget = known ? "observation" : "pending";
  const histKey = catalog?.key || mapped;
  const template = assembleTemplate(row, {
    match,
    writeTarget,
    catalog,
    mappedKey: mapped,
    history: historyByKey[histKey] || historyByKey[row.printed] || [],
    profile,
  });
  return {
    id: row.id,
    printed: row.printed,
    value: row.value,
    unit: row.unit,
    rawValue: rawRow.value,
    rawUnit: rawRow.unit,
    date: row.date,
    printedRange: row.printedRange,
    assignedRange: template.assignedRange,
    optimalValue: template.optimalValue,
    existingInsight: template.existingInsight,
    existingCustomRange: template.existingCustomRange,
    mappedKey: mapped,
    match,
    writeTarget,
    catalog,
    template,
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
