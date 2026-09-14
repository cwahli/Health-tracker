import { GoogleGenAI, Type } from "@google/genai";
import type { IntakeRow } from "./schema.js";

export async function parseLabImages(
  ai: GoogleGenAI,
  imagesBase64: string[] // Array of base64 strings with or without data URI prefix
): Promise<IntakeRow[]> {
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

  const parts: any[] = [
    "Extract all lab results from these medical records. Pay close attention to dates - some panels might have been taken on different dates (e.g. 03-Jun vs 05-Jun). Use YYYY-MM-DD for dates. Keep the exact printed name (e.g. 'HbA1c levl'). For ranges, extract the printed range exactly as shown."
  ];

  for (const img of imagesBase64) {
    let base64Data = img;
    let mimeType = "image/jpeg";
    if (img.startsWith("data:")) {
      const parts = img.split(",");
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      base64Data = parts[1];
    }
    parts.push({
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: parts,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema as any,
      temperature: 0.1
    }
  });

  const raw = response.text;
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  
  return (parsed.rows || []).map((r: any, i: number) => ({
    ...r,
    id: `img_${i + 1}`,
  }));
}
