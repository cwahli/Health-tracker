import { isCatalogKey, isOptimalLabel } from "./backoffice.ts";
import type { ClassifiedRow, ExpectedFile, FillRow, ProfileFixture } from "./schema.ts";

function sentenceCount(text: string): number {
  const t = text
    .replace(/\d+\.\d+/g, "0")
    .replace(/mL\/min\/1\.73m2/gi, "u")
    .trim();
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.replace(/[.!?]/g, "").trim().length > 0);
  return Math.max(parts.length, t ? 1 : 0);
}

function citesProfile(insight: string, profile?: ProfileFixture): boolean {
  if (!profile) return true;
  const t = insight.toLowerCase();
  const bits = [String(profile.age || ""), (profile.gender || "").toLowerCase(), (profile.ethnicity || "").toLowerCase()].filter(
    (b) => b.length > 1
  );
  return bits.some((b) => t.includes(b));
}

export interface ScoreFail {
  id: string;
  printed: string;
  check: string;
  detail: string;
}

export function scoreC2(opts: {
  classified: ClassifiedRow[];
  filled: FillRow[];
  expected: ExpectedFile;
  turns: number;
  remaining: string[];
  requireInsight?: boolean;
  profile?: ProfileFixture;
}): { pass: boolean; fails: ScoreFail[]; known: number; unknown: number; turns: number } {
  const fails: ScoreFail[] = [];
  const byPrinted = new Map(opts.filled.map((r) => [r.printed.toLowerCase(), r]));
  const classByPrinted = new Map(opts.classified.map((r) => [r.printed.toLowerCase(), r]));

  if (opts.remaining.length) {
    fails.push({
      id: "remaining",
      printed: "",
      check: "remaining_drained",
      detail: `leftover ids: ${opts.remaining.join(", ")}`,
    });
  }

  if (opts.filled.length !== opts.expected.expectRowCount) {
    fails.push({
      id: "count",
      printed: "",
      check: "row_count",
      detail: `filled ${opts.filled.length} expected ${opts.expected.expectRowCount}`,
    });
  }

  for (const exp of opts.expected.rows) {
    const got = byPrinted.get(exp.printed.toLowerCase());
    const cls = classByPrinted.get(exp.printed.toLowerCase());
    if (!got) {
      fails.push({
        id: cls?.id || "?",
        printed: exp.printed,
        check: "missing_row",
        detail: "not in agent output after continuation",
      });
      continue;
    }
    if (got.value !== exp.value) {
      fails.push({ id: got.id, printed: exp.printed, check: "value", detail: `${got.value} != ${exp.value}` });
    }
    if (got.writeTarget !== exp.writeTarget) {
      fails.push({
        id: got.id,
        printed: exp.printed,
        check: "writeTarget",
        detail: `${got.writeTarget} != ${exp.writeTarget}`,
      });
    }
    if (exp.writeTarget === "observation") {
      if (got.key !== exp.key) {
        fails.push({ id: got.id, printed: exp.printed, check: "key", detail: `${got.key} != ${exp.key}` });
      }
      if (got.match === "none") {
        fails.push({ id: got.id, printed: exp.printed, check: "match", detail: "hit marked none" });
      }
      if (got.newCatalogDraft) {
        fails.push({ id: got.id, printed: exp.printed, check: "no_draft_on_hit", detail: "pending draft on catalog hit" });
      }
      const cls = classByPrinted.get(exp.printed.toLowerCase());
      const status = cls?.template.currentEvaluationStatus || "";
      if (exp.expectStatus && status && status !== exp.expectStatus) {
        fails.push({
          id: got.id,
          printed: exp.printed,
          check: "status_label",
          detail: `computed "${status}" != expected "${exp.expectStatus}"`,
        });
      }
      if (status && /critical/i.test(status) && cls?.template.key !== "bmi") {
        fails.push({
          id: got.id,
          printed: exp.printed,
          check: "status_not_critical",
          detail: `injected status is "${status}"`,
        });
      }
      if (opts.requireInsight && cls) {
        const insight = (got.medicalInsight || cls.template.medicalInsight || "").trim();
        if (!insight) {
          fails.push({ id: got.id, printed: exp.printed, check: "medicalInsight", detail: "hit missing personalised insight" });
        } else {
          if (status && !insight.toLowerCase().includes(status.toLowerCase())) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_cites_status",
              detail: `insight did not cite injected status "${status}"`,
            });
          }
          if (/critical/i.test(insight)) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_no_critical",
              detail: "insight used Critical on a chronic marker",
            });
          }
          const nSent = sentenceCount(insight);
          if (isOptimalLabel(status) && nSent > 1) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_optimal_short",
              detail: `Optimal insight has ${nSent} sentences; want 1`,
            });
          } else if (!isOptimalLabel(status) && nSent > 2) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_length",
              detail: `non-Optimal insight has ${nSent} sentences; want ≤2`,
            });
          }
          if (!isOptimalLabel(status) && !citesProfile(insight, opts.profile)) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_cites_profile",
              detail: "non-Optimal insight did not cite age/sex/ethnicity",
            });
          }
          const prev = cls.template.historicalLogs
            .filter((h) => !(h.date === cls.date && h.value === cls.value))
            .sort((a, b) => a.date.localeCompare(b.date))
            .pop();
          if (prev && prev.value !== cls.value && !insight.includes(String(prev.value))) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_cites_trend",
              detail: `did not mention previous value ${prev.value}`,
            });
          }
          if (cls.template.key === "hba1c" && /above the standard reference range\s*\(\s*20\s*-\s*41/i.test(insight)) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "hba1c_range_lie",
              detail: "40 is inside 20-41; Elevated comes from brackets >=39",
            });
          }
        }
      }
      if (got.key && !isCatalogKey(got.key)) {
        fails.push({ id: got.id, printed: exp.printed, check: "catalog_key", detail: `not in biomarkerDefinitions: ${got.key}` });
      }
    } else {
      if (got.match !== "none") {
        fails.push({ id: got.id, printed: exp.printed, check: "match", detail: `unknown marked ${got.match}` });
      }
      if (got.key && isCatalogKey(got.key)) {
        fails.push({
          id: got.id,
          printed: exp.printed,
          check: "unknown_not_existing_key",
          detail: `bound to catalog key ${got.key}`,
        });
      }
      if (!got.newCatalogDraft) {
        fails.push({ id: got.id, printed: exp.printed, check: "newCatalogDraft", detail: "missing draft" });
      }
    }
  }

  const known = opts.classified.filter((r) => r.writeTarget === "observation").length;
  const unknown = opts.classified.filter((r) => r.writeTarget === "pending").length;
  return { pass: fails.length === 0, fails, known, unknown, turns: opts.turns };
}
