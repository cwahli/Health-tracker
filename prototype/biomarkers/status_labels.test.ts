import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { classifyRows } from "./backoffice.ts";
import type { CaseFile, ExpectedFile, ProfileFixture } from "./schema.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(here, rel), "utf8")) as T;
}
const c2 = loadJson<CaseFile>("fixtures/cases/C2.json");
const expected = loadJson<ExpectedFile>("fixtures/cases/C2.expected.json");
const profile = loadJson<ProfileFixture>("fixtures/profile.json");

describe("C2 computed status labels", () => {
  const classified = classifyRows(
    (c2 as CaseFile).rows,
    (c2 as CaseFile).history || {},
    profile as ProfileFixture
  );

  it("does not inject Critical on chronic C2 hits", () => {
    for (const r of classified.filter((x) => x.writeTarget === "observation")) {
      expect(r.template.currentEvaluationStatus.toLowerCase()).not.toContain("critical");
    }
  });

  it("labels total cholesterol 6.5 Very High and eGFR 80 Mildly Decreased (CKD G2)", () => {
    const tc = classified.find((r) => r.template.key === "total_cholesterol");
    const egfr = classified.find((r) => r.template.key === "egfr");
    expect(tc?.template.currentEvaluationStatus).toBe("Very High");
    expect(egfr?.template.currentEvaluationStatus).toBe("Mildly Decreased (CKD G2)");
  });

  it("matches C2 expectStatus gold on classified hits", () => {
    for (const exp of expected.rows) {
      if (!exp.expectStatus) continue;
      const row = classified.find((r) => r.printed.toLowerCase() === exp.printed.toLowerCase());
      expect(row?.template.currentEvaluationStatus, exp.printed).toBe(exp.expectStatus);
    }
  });
});
