import { GoogleGenAI, Type } from "@google/genai";
import { isOptimalLabel, logTrend } from "./backoffice.ts";
import { fillTemplateInstruction } from "./instruction.ts";
import { AGENT_WRITABLE_ON_HIT } from "./template.ts";
import type { ClassifiedRow, FillRow, ProfileFixture } from "./schema.ts";

const draftShape = {
  type: Type.OBJECT,
  properties: {
    suggestedKey: { type: Type.STRING },
    name: { type: Type.STRING },
    unit: { type: Type.STRING },
    aliases: { type: Type.ARRAY, items: { type: Type.STRING } },
    normalRange: { type: Type.STRING },
    description: { type: Type.STRING },
    riskCategories: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["suggestedKey", "name", "unit", "aliases", "normalRange", "description", "riskCategories"],
};

export const hitResponseSchema = {
  type: Type.OBJECT,
  properties: {
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          medicalInsight: { type: Type.STRING },
          customRangeOverlay: { type: Type.STRING, nullable: true },
        },
        required: ["id", "medicalInsight"],
      },
    },
  },
  required: ["rows"],
};

export const missResponseSchema = {
  type: Type.OBJECT,
  properties: {
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          match: { type: Type.STRING, enum: ["none"] },
          writeTarget: { type: Type.STRING, enum: ["pending"] },
          key: { type: Type.STRING, nullable: true },
          newCatalogDraft: draftShape,
        },
        required: ["id", "match", "writeTarget", "key", "newCatalogDraft"],
      },
    },
  },
  required: ["rows"],
};

function hitPayload(rows: ClassifiedRow[], profile?: ProfileFixture) {
  return rows.map((r) => {
    const status = r.template.currentEvaluationStatus;
    const optimal = isOptimalLabel(status);
    const trend = logTrend(r.template.historicalLogs);
    return {
      id: r.id,
      match: r.match,
      write: [...AGENT_WRITABLE_ON_HIT],
      dictionary: {
        biomarkerName: r.template.biomarkerName,
        key: r.template.key,
        alias: r.template.alias,
        normalRange: r.template.normalRange,
        unit: r.template.unit,
        description: r.template.description,
        riskCategories: r.template.riskCategories,
        customRange: r.template.customRangePopulation,
      },
      observation: { date: r.date, value: r.value, unit: r.unit },
      historicalLogs: r.template.historicalLogs,
      status,
      trend,
      profile: profile
        ? { age: profile.age, gender: profile.gender, ethnicity: profile.ethnicity }
        : undefined,
      insightRule: optimal
        ? "one sentence citing status; no physiology essay"
        : "≤2 sentences: cite status, age/sex/ethnicity, and trend if present",
    };
  });
}

function missPayload(rows: ClassifiedRow[]) {
  return rows.map((r) => ({
    id: r.id,
    printed: r.printed,
    value: r.value,
    unit: r.unit,
    date: r.date,
    match: "none",
    writeTargetHint: "pending",
  }));
}

export async function fillBatch(
  ai: GoogleGenAI,
  userMessage: string,
  batch: ClassifiedRow[],
  turn: number,
  remainingIds: string[],
  kind: "hit" | "miss",
  profile?: ProfileFixture
): Promise<{ rows: FillRow[]; raw: string; ms: number }> {
  const payload = kind === "hit" ? hitPayload(batch, profile) : missPayload(batch);
  const user = [
    userMessage,
    `Agent turn ${turn} (${kind}). Fill ONLY ids: ${batch.map((r) => r.id).join(", ")}.`,
    remainingIds.length ? `Still queued: ${remainingIds.join(", ")}.` : "Last batch.",
    kind === "hit"
      ? "Hits: medicalInsight only (+ overlay null unless range should move). Cite injected status. Optimal = one sentence. Else status + profile + trend. Never Critical."
      : "Misses: pending + newCatalogDraft. key null.",
    JSON.stringify({ batch: payload }, null, 2),
  ].join("\n\n");

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: [{ text: user }],
    config: {
      systemInstruction: fillTemplateInstruction,
      responseMimeType: "application/json",
      responseSchema: (kind === "hit" ? hitResponseSchema : missResponseSchema) as any,
      temperature: 0.1,
    },
  });
  const raw = response.text || "{}";
  const parsed = JSON.parse(raw) as { rows?: FillRow[] };
  return { rows: parsed.rows || [], raw, ms: Date.now() - started };
}
