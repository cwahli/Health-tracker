import { GoogleGenAI, Type } from "@google/genai";
import { fillTemplateInstruction } from "./instruction.js";
import type { ClassifiedRow, FillRow, ProfileFixture } from "./schema.js";

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

const dictionaryCorrectionShape = {
  type: Type.OBJECT,
  properties: {
    field: { type: Type.STRING, description: "Field with error, e.g. normalRange or unit" },
    correctedValue: { type: Type.STRING, description: "Corrected value for dictionary" },
    reason: { type: Type.STRING, description: "Clinical rationale for the dictionary edit" },
  },
  required: ["field", "correctedValue", "reason"],
};

const logShape = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, description: "Standardized YYYY-MM-DD" },
    value: { type: Type.NUMBER },
    unit: { type: Type.STRING },
    comment: { type: Type.STRING, nullable: true },
  },
  required: ["date", "value", "unit"],
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
          optimalValue: {
            type: Type.STRING,
            description: "Concise target string (e.g. '80 umol/L'). Max 30 chars.",
            nullable: true,
          },
          editReason: {
            type: Type.STRING,
            description: "If modifying or correcting existing user values or insight, concise explanation why. Otherwise empty string.",
            nullable: true,
          },
          dictionaryCorrection: {
            ...dictionaryCorrectionShape,
            nullable: true,
          },
          logs: {
            type: Type.ARRAY,
            items: logShape,
          },
        },
        required: ["id", "medicalInsight", "optimalValue", "editReason", "logs"],
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
          medicalInsight: { type: Type.STRING },
          customRangeOverlay: { type: Type.STRING, nullable: true },
          optimalValue: {
            type: Type.STRING,
            description: "Concise target string (e.g. '1.0 ug/L'). Max 30 chars.",
            nullable: true,
          },
          editReason: { type: Type.STRING, nullable: true },
          logs: {
            type: Type.ARRAY,
            items: logShape,
          },
          match: { type: Type.STRING, enum: ["none"] },
          writeTarget: { type: Type.STRING, enum: ["pending"] },
          key: { type: Type.STRING, nullable: true },
          newCatalogDraft: draftShape,
        },
        required: ["id", "medicalInsight", "optimalValue", "editReason", "logs", "match", "writeTarget", "key", "newCatalogDraft"],
      },
    },
  },
  required: ["rows"],
};

export function hitPayload(rows: ClassifiedRow[]) {
  return rows.map((r) => {
    const historicalSorted = (r.template.historicalLogs || [])
      .filter((h) => !(h.date === r.date && h.value === r.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    const prev = historicalSorted[historicalSorted.length - 1];
    const historicalTimeline = historicalSorted.length > 0
      ? historicalSorted.map((h) => `${h.date}: ${h.value} ${h.unit || r.unit}`).join(" → ")
      : undefined;
    const effectiveRange = r.template.assignedRange || r.printedRange || r.template.normalRange || "";
    return {
      id: r.id,
      name: r.template.biomarkerName,
      value: r.value,
      unit: r.unit,
      date: r.date,
      range: effectiveRange,
      optimalValue: r.template.optimalValue ?? null,
      existingInsight: r.template.existingInsight ?? null,
      existingCustomRange: r.template.existingCustomRange ?? null,
      dictionary: {
        normalRange: r.template.normalRange,
        unit: r.template.unit,
        description: r.template.description,
      },
      ...(prev ? { previous: `${prev.value} ${prev.unit || r.unit}` } : {}),
      ...(historicalTimeline ? { historicalTimeline } : {}),
    };
  });
}

export function missPayload(rows: ClassifiedRow[]) {
  return rows.map((r) => ({
    id: r.id,
    name: r.printed,
    value: r.value,
    unit: r.unit,
    date: r.date,
    range: r.printedRange || "",
  }));
}

export function buildTurnUserMessage(
  userMessage: string,
  batch: ClassifiedRow[],
  kind: "hit" | "miss"
): { user: string; payload: unknown } {
  const payload = kind === "hit" ? hitPayload(batch) : missPayload(batch);
  const user = [
    `<user_upload>\n${userMessage}\n</user_upload>`,
    `Biomarkers to review (${kind === "hit" ? "hits - in catalog" : "misses - uncataloged, draft catalog entry"}):\n${JSON.stringify({ biomarkers: payload }, null, 2)}`,
  ].join("\n\n");
  return { user, payload };
}

export async function fillBatch(
  ai: GoogleGenAI,
  userMessage: string,
  batch: ClassifiedRow[],
  _turn: number,
  _remainingIds: string[],
  kind: "hit" | "miss",
  profile?: ProfileFixture
): Promise<{ rows: FillRow[]; raw: string; ms: number; user: string; payload: unknown }> {
  const { user, payload } = buildTurnUserMessage(userMessage, batch, kind);
  const patientProfileStr = profile
    ? `${profile.age}-year-old ${profile.ethnicity || ""} ${profile.gender}, Unit Preference: ${profile.unitPreference || "SI"}`.replace(/\s+/g, " ").trim()
    : "43-year-old Chinese male, Unit Preference: SI";
  const started = Date.now();
  let response: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{ text: user }],
        config: {
          systemInstruction: fillTemplateInstruction(patientProfileStr, (profile as any)?.language),
          responseMimeType: "application/json",
          responseSchema: (kind === "hit" ? hitResponseSchema : missResponseSchema) as any,
          temperature: 0.1,
        },
      });
      break;
    } catch (err: any) {
      if (attempt === 3) throw err;
      console.warn(`[fillBatch] Attempt ${attempt} failed (${err?.message || err}), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const raw = response.text || "{}";
  const parsed = JSON.parse(raw) as { rows?: FillRow[] };
  return { rows: parsed.rows || [], raw, ms: Date.now() - started, user, payload };
}
