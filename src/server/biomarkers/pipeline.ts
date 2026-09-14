import { classifyRows, batchRows } from "./backoffice.js";
import { parseLabImages } from "./vision_parser.js";
import { fillBatch } from "./call_agent.js";
import type { ProfileFixture, FillRow } from "./schema.js";
import { GoogleGenAI, Type } from "@google/genai";

export async function runBiomarkerPipeline(
  ai: GoogleGenAI,
  message: string,
  imagesBase64: string[],
  history: Record<string, any>,
  profile: ProfileFixture,
  onProgress?: (msg: string) => void,
  targetModel: string = "gemini-3.5-flash-lite"
): Promise<FillRow[]> {
  let rows: any[] = [];
  
  if (imagesBase64 && imagesBase64.length > 0) {
    if (onProgress) onProgress(`Extracting from ${imagesBase64.length} images...`);
    const ocrRows = await parseLabImages(ai, imagesBase64);
    rows = ocrRows;
  }
  
  // NOTE: In the prototype, if there are no images, caseFile.rows was used. 
  // For text only, we still need to classify. But wait, where do text rows come from?
  // We need an extractor for text if there are no images. 
  // Let's implement text extraction.
  if (rows.length === 0 && message && message.trim()) {
      if (onProgress) onProgress(`Extracting from text...`);
      const schema = {
        type: Type.OBJECT,
        properties: {
          rows: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                printed: { type: Type.STRING },
                value: { type: Type.NUMBER },
                unit: { type: Type.STRING },
                date: { type: Type.STRING },
                printedRange: { type: Type.STRING }
              },
              required: ["printed", "value", "unit", "date"]
            }
          }
        },
        required: ["rows"]
      };
      
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: [
            "Extract all lab results from this text. Pay close attention to dates. Use YYYY-MM-DD for dates. Keep the exact printed name (e.g. 'HbA1c'). For ranges, extract the printed range exactly as shown. If a value is qualitative (e.g. 'Positive'), you can leave value as null or 0 and just note it, but prefer numeric where possible.",
            `Text: ${message}`
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema as any,
          temperature: 0.1
        }
      });
      const raw = response.text;
      if (raw) {
          const parsed = JSON.parse(raw);
          rows = (parsed.rows || []).map((r: any, i: number) => ({ ...r, id: `r${(i + 1).toString().padStart(2, '0')}` }));
      }
  }

  const classified = classifyRows(rows, history || {}, profile);
  
  const hits = classified.filter((r: any) => r.writeTarget === "observation");
  const misses = classified.filter((r: any) => r.writeTarget === "pending");
  
  if (onProgress) onProgress(`Classified: ${hits.length} catalog hits, ${misses.length} misses.`);

  const insightBatches = batchRows(hits, 20);
  const draftBatches = batchRows(misses, 12);
  
  const finalRows: FillRow[] = [];
  
  let turn = 0;
  
  const runKind = async (kind: "hit" | "miss", batches: any[][]) => {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const later = batches.slice(i + 1).flat().map((r: any) => r.id);
        turn += 1;
        if (onProgress) onProgress(`Running agent for ${kind} batch ${i+1}/${batches.length}...`);
        const out = await fillBatch(ai, message, batch, turn, later, kind, profile);
        for (const outRow of out.rows) {
             const classRow = classified.find((r: any) => r.id === outRow.id);
             if (classRow) {
                 finalRows.push({
                     ...outRow,
                     match: classRow.match as any,
                     key: classRow.mappedKey,
                     writeTarget: classRow.writeTarget as any,
                     printed: classRow.printed,
                     value: classRow.value,
                     unit: classRow.unit,
                     date: classRow.date,
                     printedRange: classRow.printedRange,
                     assignedRange: classRow.template.assignedRange
                 });
             }
        }
      }
  };
  
  if (insightBatches.length > 0) await runKind("hit", insightBatches);
  if (draftBatches.length > 0) await runKind("miss", draftBatches);

  return finalRows;
}
