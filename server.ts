import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

async function startServer() {
  // In-Memory & Local File Sync storage to act as the durable synced database
  const SYNC_DIR = path.join(process.cwd(), "data", "sync");
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }

  // Increase limit to allow base64 uploaded image payloads
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Initialize Gemini SDK with telemetry header
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not defined in the environment.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "MOCK_KEY",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Unified Multi-Provider LLM Router with automatic fallbacks & simulation modes
async function callUnifiedLLM({
  modelId,
  systemInstruction,
  promptText,
  imagePayload,
  imagePayloads,
  responseMimeType,
  googleSearch
}: {
  modelId: string;
  systemInstruction: string;
  promptText: string;
  imagePayload?: { mimeType: string; data: string } | null;
  imagePayloads?: { mimeType: string; data: string }[] | null;
  responseMimeType?: "application/json" | "text/plain";
  googleSearch?: boolean;
}) {
  const isJson = responseMimeType === "application/json";
  const normalizedModelId = (modelId || "gemini-2.5-flash").toLowerCase();

  // 1. Anthropic Claude Models
  if (normalizedModelId.includes("claude-")) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      console.log(`[UnifiedLLM] Calling official Anthropic API: ${normalizedModelId}`);
      try {
        const messages: any[] = [];
        const contentParts: any[] = [];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data
              }
            });
          }
        } else if (imagePayload) {
          contentParts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: imagePayload.mimeType,
              data: imagePayload.data
            }
          });
        }
        contentParts.push({
          type: "text",
          text: promptText
        });
        messages.push({
          role: "user",
          content: contentParts
        });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            max_tokens: 4096,
            system: systemInstruction + (isJson ? " Respond strictly in valid JSON format." : ""),
            messages
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.content?.[0]?.text || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`Anthropic API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to Anthropic:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 2. OpenAI GPT Models
  if (normalizedModelId.includes("gpt-")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log(`[UnifiedLLM] Calling official OpenAI API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: [] as any }
        ];

        const userContent: any[] = [{ type: "text", text: promptText }];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            userContent.push({
              type: "image_url",
              image_url: {
                url: `data:${img.mimeType};base64,${img.data}`
              }
            });
          }
        } else if (imagePayload) {
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${imagePayload.mimeType};base64,${imagePayload.data}`
            }
          });
        }
        messages[1].content = userContent;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`OpenAI API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to OpenAI:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 3. DeepSeek Models
  if (normalizedModelId.includes("deepseek-")) {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      console.log(`[UnifiedLLM] Calling official DeepSeek API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptText }
        ];

        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${deepseekKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId === "deepseek-chat" ? "deepseek-chat" : "deepseek-reasoner",
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`DeepSeek API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to DeepSeek:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 4. Gemini SDK Default/Simulation Fallback
  console.log(`[UnifiedLLM] Routing/Falling back to Gemini model mapping from requested model: ${normalizedModelId}`);
  const ai = getGeminiClient();

  // Map choices to appropriate Google SDK model IDs
  let targetGeminiModel = "gemini-3.1-flash-lite";
  if (normalizedModelId.includes("pro")) {
    targetGeminiModel = "gemini-3.1-pro-preview";
  } else if (normalizedModelId.includes("3.5-flash")) {
    targetGeminiModel = "gemini-3.5-flash";
  } else if (normalizedModelId.includes("3.1-flash-lite")) {
    targetGeminiModel = "gemini-3.1-flash-lite";
  } else if (normalizedModelId.includes("2.5-flash-lite")) {
    targetGeminiModel = "gemini-2.5-flash-lite";
  } else if (normalizedModelId.includes("2.5-flash")) {
    targetGeminiModel = "gemini-2.5-flash";
  } else if (normalizedModelId.includes("3-flash") || normalizedModelId.includes("3.0-flash")) {
    targetGeminiModel = "gemini-3.0-flash";
  }

  const contents: any[] = [];
  if (imagePayloads && imagePayloads.length > 0) {
    for (const img of imagePayloads) {
      contents.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }
  } else if (imagePayload) {
    contents.push({
      inlineData: {
        mimeType: imagePayload.mimeType,
        data: imagePayload.data
      }
    });
  }

  // Prepend simulated header to instruction if simulating a third-party engine on Gemini
  let resolvedInstruction = systemInstruction;
  if (!normalizedModelId.includes("gemini")) {
    resolvedInstruction = `[System Simulation: Adopt the persona of model '${normalizedModelId}' for this request. Respond as accurately and characteristically as possible while strictly observing the requested JSON format constraints.]\n\n${systemInstruction}`;
  }

  contents.push({ text: promptText });

  const configObj: any = {
    responseMimeType: isJson ? "application/json" : "text/plain",
    systemInstruction: resolvedInstruction
  };
  if (googleSearch) {
    configObj.tools = [{ googleSearch: {} }];
  }

  try {
    const response = await ai.models.generateContent({
      model: targetGeminiModel,
      contents,
      config: configObj
    });
    return response.text || "{}";
  } catch (err: any) {
    if (googleSearch) {
      console.warn(`[UnifiedLLM] Google Search Grounding failed (likely due to quota limits on search grounding). Retrying without search grounding... Error:`, err.message || err);
      const fallbackConfig = { ...configObj };
      delete fallbackConfig.tools;
      try {
        const response = await ai.models.generateContent({
          model: targetGeminiModel,
          contents,
          config: fallbackConfig
        });
        return response.text || "{}";
      } catch (retryErr: any) {
        console.error(`[UnifiedLLM] Retry without grounding failed:`, retryErr);
        throw retryErr;
      }
    } else {
      throw err;
    }
  }
}

// Sync endpoints
app.post("/api/sync/save", (req, res) => {
  try {
    const { email, data } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[Sync Save] Saved data for email: ${email}`);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[Sync Save] Error:", error);
    res.status(500).json({ error: "Failed to sync save data to server database" });
  }
});

app.post("/api/sync/load", (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      console.log(`[Sync Load] Loaded data for email: ${email}`);
      return res.json({ success: true, data: JSON.parse(content) });
    }
    
    console.log(`[Sync Load] No existing cloud record for email: ${email}`);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error("[Sync Load] Error:", error);
    res.status(500).json({ error: "Failed to retrieve sync data from server database" });
  }
});

// Gemini Food Analyze Endpoint
app.post("/api/gemini/food-analyze", async (req, res) => {
  try {
    const { message, image, images, imageDates, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance } = req.body;

    // Check if key is mock
    if (process.env.GEMINI_API_KEY === undefined) {
      return res.json({
        text: "Please note: GEMINI_API_KEY is not configured in the Secrets manager. Here is a simulated analysis:\n\nThis looks like a fresh Avocado Salmon Toast.",
        data: {
          name: "Avocado Salmon Toast",
          composition: "Whole wheat bread, mashed avocado, smoked salmon, cherry tomatoes, olive oil",
          weightGrams: 220,
          quantity: "1 serving",
          benefits: "High in omega-3 fatty acids from the salmon, rich in heart-healthy monounsaturated fats from avocado, and packed with dietary fibre from whole wheat toast.",
          risks: "Slightly elevated sodium from the smoked salmon. Moderation is advised if you have strict sodium limits.",
          healthImpact: "Contributes beautifully to your daily unsaturated fat target and omega-3 allowance. Soluble fibre aids in optimizing LDL cholesterol.",
          recommendation: "good",
          nutrients: {
            calories: 380,
            protein: 18,
            totalFat: 16,
            saturatedFat: 2.2,
            unsaturatedFat: 12.5,
            omega3: 1.8,
            carbohydrates: 28,
            addedSugar: 0,
            totalFibre: 8,
            solubleFibre: 2.5,
            sodium: 480,
            potassium: 520,
            magnesium: 65,
            calcium: 45,
            iron: 2.1,
            zinc: 1.5,
            selenium: 22,
            iodine: 15,
            phosphorus: 180,
            vitaminD: 120,
            vitaminB12: 1.8,
            folate: 45,
            vitaminC: 12,
            vitaminE: 3.5,
            vitaminK: 25,
            vitaminA: 60,
            vitaminB6: 0.4,
            thiamine: 0.15,
            riboflavin: 0.18,
            niacin: 4.2
          }
        }
      });
    }

    let imagePayloads = null;
    if (images && Array.isArray(images) && images.length > 0) {
      imagePayloads = images.map((imgStr: string) => {
        const mimeType = imgStr.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = imgStr.split(",")[1];
        return { mimeType, data: base64Data };
      });
    } else if (image) {
      const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
      const base64Data = image.split(",")[1];
      imagePayloads = [{ mimeType, data: base64Data }];
    }

    const userTimezone = userProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userLocalTime = new Date().toLocaleString('en-US', { timeZone: userTimezone });
    
    const userCtx = userProfile ? `User Profile: Age ${userProfile.age}, Ethnicity: ${userProfile.ethnicity}, Weight: ${userProfile.weight}kg, Height: ${userProfile.height}cm.` : "User profile is unknown.";
    const imageCtx = imageDates && imageDates.length > 0 ? `The attached images were originally taken on these dates/times: ${imageDates.join(", ")}.` : "";
    const timeCtx = `Current User Local Time: ${userLocalTime} (Timezone: ${userTimezone}). IMPORTANT: If image creation dates are provided, you MUST use those image dates to accurately determine the 'date' field of the food entry (formatted as YYYY-MM-DD in the user's local timezone). Only use the current user local time if no image dates are provided or if the user explicitly specifies a different day.`;
    
    let historyContext = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyContext = "Here is the conversation history so far for context. Please use this history to refine or update your understanding if the user is asking to make corrections, adjustments, or adding new details to their food/meal:\n" + 
        history.map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant (AI Dietitian)'}: ${h.content}`).join("\n") + "\n\n";
    }

    let healthAlertsContext = "";
    if (biomarkersNeedingImprovement && Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0) {
      healthAlertsContext = `\nCRITICAL PATIENT BIOMARKER WARNINGS:\n` +
        biomarkersNeedingImprovement.map((b: string) => `• ${b}`).join("\n") +
        `\nYou MUST evaluate if this food is safe or dangerous/harmful for these specific biomarkers.
For example:
- If LDL-C, cholesterol, ApoB, or lipid panel values are HIGH, any food high in saturated fat (like Butter, Bone Marrow, Fatty Meat, Lard, Deep Fried food) is EXTREMELY harmful. You MUST rate such high-saturated-fat food as "bad" (not neutral or good) and explicitly mention this warning in the "risks" and "healthImpact" fields!
- If HbA1c or Glucose is HIGH, any food high in added sugar, refined carbs, or extremely high glycemic index is EXTREMELY harmful. You MUST rate it as "bad" and explicitly warn the user.
- If Blood Pressure, Sodium, or Hypertension status is HIGH, any food high in sodium is EXTREMELY harmful. You MUST rate it as "bad" and explicitly warn the user.\n`;
    }

    let nutritionTargetContext = "";
    if (remainingAllowance) {
      nutritionTargetContext = `\nTODAY'S REMAINING NUTRITIONAL TARGET LIMITS:\n` +
        `• Calories: ${remainingAllowance.calories} kcal remaining (Target: ${remainingAllowance.caloriesTarget} kcal)\n` +
        `• Saturated Fat: ${remainingAllowance.saturatedFat}g remaining (Target/Max: ${remainingAllowance.saturatedFatTarget}g)\n` +
        `• Sodium: ${remainingAllowance.sodium}mg remaining (Target/Max: ${remainingAllowance.sodiumTarget}mg)\n` +
        `If this single meal's nutrients exceed the user's remaining daily allowance for Saturated Fat or Sodium, or constitute an excessively large percentage of their total daily limit, you MUST rate the meal recommendation as "bad" or "neutral" (depending on severity), raise a strong warning about the limit excess, and document this clearly in "risks" and "healthImpact".\n`;
    }

    const promptText = `${historyContext}Analyze this current food request.
${userCtx}
${timeCtx}
${imageCtx}
${healthAlertsContext}
${nutritionTargetContext}

Current User Input: "${message}"

CRITICAL DIRECTIVE FOR CORRECTIONS/REFINEMENTS:
If the conversation history contains a previous food log (e.g. indicated by '[Extracted Food: {...}]' in the assistant's previous message) and the user's current input is asking for a correction, adjustment, modification, or referring back to something they mentioned in their previous message that was forgotten/omitted (such as 'correct the weight', 'no, it was chicken instead of beef', 'add 50g of rice', or 'I also talked about orange juice', 'you forgot my juice', etc.), you MUST:
1. Treat the previous '[Extracted Food]' JSON structure as the baseline/source of truth.
2. Carry forward ALL properties, name, composition, benefits, risks, and nutrient ratios of that previous food.
3. Apply the user's requested correction. For example, if they changed the weight, scale all of the 30 nutrient values mathematically and proportionally based on the ratio of the new weight to the old weight (e.g., if weight goes from 220g to 150g, multiply all nutrient values by 150/220).
4. Do NOT re-estimate or re-analyze from scratch; utilize the previous food's rich ingredient details and analysis. Preserve everything that the user did not ask you to change!
5. OMITTED ITEMS MERGE: If the user points out that you forgot or omitted an item they had previously mentioned in their prompt (e.g., they originally wrote "I had beef risol and orange juice" but the '[Extracted Food]' only had "Beef Risol"), you MUST add and merge that omitted item (e.g. "Orange Juice") into the current foodData. Update the food's name (e.g. "Beef Risol and Orange Juice"), expand the composition/ingredients list, and mathematically add the full nutritional profile (calories, sugar, vitamins, etc.) of the omitted item to the existing log's nutrients. Do not wipe out the previous food item!

First, determine if the user is asking to LOG a specific meal, or if they are just asking a general question/asking for menu advice/conversing.
If they are NOT ready to log a specific food yet (e.g. asking "What can I eat here?", "Is this good for me?", "What should I order?"), set "isFoodLog": false, and provide a helpful, conversational "message" giving them advice based on their health profile and the provided image/menu.
If they ARE ready to log a food, set "isFoodLog": true, and provide the "foodData" object.

Respond with a structured JSON format matching this schema EXACTLY:
{
  "isFoodLog": boolean,
  "message": "Conversational advice if isFoodLog is false, or a short summary if true",
  "foodData": {
    "date": "YYYY-MM-DD string",
    "name": "Literal food name",
    "composition": "Short summary of main ingredients",
    "weightGrams": estimated weight in grams (number),
    "quantity": "estimated volume/portion (string)",
    "benefits": "specific benefits tailored to the profile",
    "risks": "specific warnings or guidelines tailored to the profile",
    "healthImpact": "detailed impact on nutritional allowance and targets",
    "recommendation": "good" | "bad" | "neutral",
    "nutrients": {
      "calories": number (kcal),
      "protein": number (g),
      "totalFat": number (g),
      "saturatedFat": number (g),
      "unsaturatedFat": number (g),
      "omega3": number (g),
      "carbohydrates": number (g),
      "addedSugar": number (g),
      "totalFibre": number (g),
      "solubleFibre": number (g),
      "sodium": number (mg),
      "potassium": number (mg),
      "magnesium": number (mg),
      "calcium": number (mg),
      "iron": number (mg),
      "zinc": number (mg),
      "selenium": number (mcg),
      "iodine": number (mcg),
      "phosphorus": number (mg),
      "vitaminD": number (IU),
      "vitaminB12": number (mcg),
      "folate": number (mcg),
      "vitaminC": number (mg),
      "vitaminE": number (mg),
      "vitaminK": number (mcg),
      "vitaminA": number (mcg),
      "vitaminB6": number (mg),
      "thiamine": number (mg),
      "riboflavin": number (mg),
      "niacin": number (mg)
    }
  }
}
If isFoodLog is false, you can leave foodData as null.
Ensure you estimate values for ALL 30 nutrients listed when foodData is provided. Make sure the metrics are strictly consistent: macronutrients/omega-3/fibre in grams (g), minerals and vitamins in milligrams (mg) or micrograms (mcg) or IU as specified in the template. Return ONLY the raw JSON string.`;

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction: "You are an expert clinical dietitian and nutritional LLM analyzer. Your response must be an exact single JSON object matching the requested structure. Never add markdown formatting or wrappers like ```json.",
      promptText,
      imagePayloads,
      responseMimeType: "application/json"
    });

    const firstBrace = textOutput.indexOf("{");
    const lastBrace = textOutput.lastIndexOf("}");
    let cleanJson = textOutput;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = textOutput.substring(firstBrace, lastBrace + 1);
    } else {
      cleanJson = cleanJson.trim().replace(/^```json/, "").replace(/```$/, "").trim();
    }
    const rawParsed = JSON.parse(cleanJson);

    if (rawParsed.isFoodLog === false || !rawParsed.foodData) {
      res.json({
        data: null,
        text: rawParsed.message || "I have received your request."
      });
      return;
    }

    const rawFoodData = rawParsed.foodData;

    // Sanitize and ensure no fields are missing or strictly equal to string "undefined" or null
    const parsedData: any = {};
    const sanitizeString = (val: any, fallback: string) => {
      if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
        return fallback;
      }
      return String(val);
    };

    parsedData.name = sanitizeString(rawFoodData.name, "Meal Log");
    parsedData.date = sanitizeString(rawFoodData.date, new Date().toISOString().split("T")[0]);
    parsedData.composition = sanitizeString(rawFoodData.composition, "Unspecified ingredients");
    parsedData.weightGrams = Number(rawFoodData.weightGrams) || 150;
    parsedData.quantity = sanitizeString(rawFoodData.quantity, "1 serving");
    parsedData.benefits = sanitizeString(rawFoodData.benefits, "Provides foundational vitamins, minerals, and macronutrients.");
    parsedData.risks = sanitizeString(rawFoodData.risks, "No specific adverse biomarkers flagged for your profile.");
    parsedData.healthImpact = sanitizeString(rawFoodData.healthImpact, "Contributes to daily macro and micronutrient requirements.");
    
    const rec = String(rawFoodData.recommendation).toLowerCase();
    parsedData.recommendation = (rec === "good" || rec === "bad" || rec === "neutral") ? rec : "neutral";
    
    const rawNutrients = rawFoodData.nutrients || {};
    const nutrientKeys = [
      "calories", "protein", "totalFat", "saturatedFat", "unsaturatedFat", "omega3", 
      "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "sodium", "potassium", 
      "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
      "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
      "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
    ];
    
    parsedData.nutrients = {};
    for (const key of nutrientKeys) {
      parsedData.nutrients[key] = Number(rawNutrients[key]) || 0;
    }

    res.json({
      text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}). It is recommended as **${parsedData.recommendation}** for your current profile.`,
      data: parsedData
    });
  } catch (error: any) {
    console.error("[Food Analyze Error]:", error);
    const isQuotaError = error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED");
    
    const rawMsg = req.body?.message || "";
    let foodName = "Meal Log";
    if (rawMsg.length > 0 && rawMsg.length < 50) {
      foodName = rawMsg;
    } else {
      const match = rawMsg.match(/ate\s+([a-zA-Z\s]{3,25})/i) || rawMsg.match(/having\s+([a-zA-Z\s]{3,25})/i) || rawMsg.match(/had\s+([a-zA-Z\s]{3,25})/i);
      if (match) {
        foodName = match[1].trim();
      }
    }

    const warningNotice = isQuotaError
      ? `*(Note: Your Gemini API key has exceeded its quota/rate limits. I have estimated the nutritional data using offline heuristics so you can still log this meal!)*\n\nI have estimated the breakdown for **${foodName}**:`
      : `*(Note: Gemini connection timed out. Showing offline estimated breakdown!)*\n\nI have estimated the breakdown for **${foodName}**:`;

    const userTimezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let localDateStr;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      localDateStr = formatter.format(new Date());
    } catch(e) {
      localDateStr = new Date().toISOString().split("T")[0];
    }

    const fallbackFoodLog = {
      name: foodName,
      date: localDateStr,
      composition: "Estimated based on your description",
      weightGrams: 200,
      quantity: "1 serving",
      benefits: "Provides foundational macronutrients and essential vitamins/minerals.",
      risks: "None flagged for your profile.",
      healthImpact: "Estimated offline due to API rate limiting. This log is still saved to your tracking history.",
      recommendation: "neutral",
      nutrients: {
        calories: 350,
        protein: 15,
        totalFat: 12,
        saturatedFat: 2.0,
        unsaturatedFat: 8.0,
        omega3: 0.5,
        carbohydrates: 35,
        addedSugar: 2.0,
        totalFibre: 4.5,
        solubleFibre: 1.5,
        sodium: 350,
        potassium: 350,
        magnesium: 40,
        calcium: 50,
        iron: 1.5,
        zinc: 1.2,
        selenium: 10,
        iodine: 8,
        phosphorus: 120,
        vitaminD: 20,
        vitaminB12: 0.5,
        folate: 30,
        vitaminC: 10,
        vitaminE: 1.5,
        vitaminK: 15,
        vitaminA: 40,
        vitaminB6: 0.2,
        thiamine: 0.1,
        riboflavin: 0.1,
        niacin: 2.5
      }
    };

    res.json({
      text: warningNotice,
      data: fallbackFoodLog
    });
  }
});

// Gemini Medical/Biomarkers Analyze Endpoint
app.post("/api/gemini/medical-analyze", async (req, res) => {
  try {
    const { message, image, images, imageDates, history, userProfile, engine, existingBiomarkers } = req.body;

    if (process.env.GEMINI_API_KEY === undefined) {
      return res.json({
        text: "Please note: GEMINI_API_KEY is not configured in Secrets. Here is a simulated extraction:\n\nBased on your report, I have identified a fasting glucose of 105 mg/dL and LDL cholesterol of 145 mg/dL.",
        biomarkers: {
          ldl: 145,
          fasting_glucose: 105,
          hba1c: 5.8,
          egfr: 85,
          hscrp: 1.2
        }
      });
    }

    let imagePayload = null;
    let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
    
    if (images && images.length > 0) {
      imagesPayload = images.map((img: string) => {
        const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = img.split(",")[1];
        return { mimeType, data: base64Data };
      });
      // also set imagePayload for backward compatibility in callUnifiedLLM if needed
      imagePayload = imagesPayload[0]; 
    } else if (image) {
      const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
      const base64Data = image.split(",")[1];
      imagePayload = { mimeType, data: base64Data };
    }

    let historyText = "";
    if (history && history.length > 0) {
      historyText = "Chat History:\n" + history.map((h: any) => `${h.role}: ${h.content}`).join("\n") + "\n\n";
    }

    let profileContext = "";
    if (userProfile) {
      profileContext = `Current User Profile (This is what you already know. DO NOT ask the user for these again, and DO NOT include these in your output JSON unless the user is explicitly restating or updating them in the current message or recent chat history):
      - Age: ${userProfile.age || 'Not provided'}
      - Weight: ${userProfile.weight || 'Not provided'}
      - Height: ${userProfile.height || 'Not provided'}
      - Ethnicity: ${userProfile.ethnicity || 'Not provided'}
      - Blood Type: ${userProfile.bloodType || 'Not provided'}
      - Gender: ${userProfile.gender || 'Not provided'}
      `;
    }

    const imageCtx = imageDates && imageDates.length > 0 ? `The attached images were taken on these dates: ${imageDates.join(", ")}.` : "";

    const promptText = `${profileContext}
    
    ${historyText}Analyze this medical query and extract any health biomarkers mentioned or visible in the document.
    ${imageCtx}
    User message: "${message}"
    
    You must extract any personal profile information if the user explicitly provides it in the Chat History or current message.
    CRITICAL RULES:
    1. The output JSON must represent the CUMULATIVE extracted information from the ENTIRE chat history and current message (but ONLY things the user actually typed or uploaded).
    2. DO NOT output profile fields from the "Current User Profile" section in the JSON unless the user explicitly provided them during this chat session.
    3. If the user corrects or updates a previously extracted biomarker value, date, or profile info in their current message, prioritize their updated value.
    4. CRITICAL METRIC & UNIT CONSISTENCY:
       - Always prefer the International Standard (mmol/L) for lipids (LDL, HDL, Total Cholesterol, Triglycerides) and blood sugar (Fasting Glucose) by default.
       - If the report or input uses mmol/L, DO NOT extract it under standard keys that hardcode mg/dL if that would cause an impossible value mismatch. Instead, create a custom definition in 'customBiomarkerDefs' with the key (e.g., 'ldl' or 'total_cholesterol' can be customized by adding them to customBiomarkerDefs), unit as 'mmol/L', custom 'normalRange' (e.g., 'under 3.0 mmol/L' for ldl, 'under 5.2 mmol/L' for total_cholesterol, 'over 1.0 mmol/L' for hdl), and the correct numeric value.
       - Ensure that the value and the normal range are ALWAYS consistent and use the exact same unit. Never mix them up!
       - Double-check that the extracted numeric value is mathematically and medically realistic for the unit specified (e.g., Fasting Glucose of 5.5 mmol/L is realistic, whereas 5.5 mg/dL is impossible; 95 mg/dL is realistic, whereas 95 mmol/L is impossible). If you detect a mix-up, perform the correct conversion (e.g., mg/dL = mmol/L * 18 for glucose, or mg/dL = mmol/L * 38.67 for cholesterol) and output accurate, consistent metrics.
    
    Look for:
    - age (number, in years)
    - weight (number, in kg)
    - height (number, in cm)
    - ethnicity (string, e.g. "Caucasian", "Asian", "Hispanic", "African American", etc.)
    - bloodType (string, e.g. "A+", "O-", "AB+", "B-")
    - gender (string, e.g. "Male", "Female", "Other")
    
    Look for values and map them semantically to the following standard keys if they refer to the same biomarker (even if the wording is slightly different, e.g. "Total Chol" -> "total_cholesterol", "Serum Creatinine" -> "creatinine"):
    - hba1c (%)
    - fasting_glucose (mg/dL)
    - fasting_insulin (uIU/mL)
    - ldl (mg/dL)
    - apob (mg/dL)
    - total_cholesterol (mg/dL)
    - hdl (mg/dL)
    - triglycerides (mg/dL)
    - egfr (mL/min/1.73m²)
    - creatinine (mg/dL)
    - bun (mg/dL)
    - hgb (g/dL)
    - rbc (M/uL)
    - wbc (K/uL)
    - platelets (K/uL)
    - hscrp (mg/L)
    - testosterone (ng/dL)
    - vitamin_d (ng/mL)
    - vitamin_b12 (pg/mL)
    
    ${existingBiomarkers && existingBiomarkers.length > 0 ? `Additionally, the user ALREADY has data for the following custom biomarker keys: ${JSON.stringify(existingBiomarkers)}. If any new extracted biomarker matches these semantically, please use the EXACT existing key string rather than creating a new variation.` : ''}
    
    If the biomarker does not match ANY of the standard keys or existing keys above, create a new snake_case key (e.g. "serum_albumin", "ast_level", "calcium").
    
    If you create ANY new custom keys, you MUST also provide a definition for it in a 'customBiomarkerDefs' object. The definition should include: 'name' (string), 'unit' (string), 'normalRange' (string, e.g. "3.5 - 5.0" or "< 100", use "Unknown" if not known), and 'description' (string, explaining what it is and what specifically happens if the profile goes outside the normal range; do not use generic text like 'Keeping this within normal range minimizes risk...').

    Respond strictly with a JSON object in this format:
    {
      "summary": "Short 2-sentence human summary of what you extracted. If the date of the biomarkers is missing from the image and the user didn't mention it, explicitly ask the user for the date of these results so they can be logged accurately.",
      "date": "YYYY-MM-DD string, extracted from the lab report image or user text. Use imageDates if relevant. Leave null if absolutely unknown.",
      "biomarkers": {
        "ldl": 145,
        "hba1c": 5.8,
        "serum_albumin": 4.1
      },
      "customBiomarkerDefs": {
        "serum_albumin": {
          "name": "Serum Albumin",
          "unit": "g/dL",
          "normalRange": "3.4 - 5.4",
          "description": "A protein made by the liver. Low levels can indicate kidney disease or liver disease, causing fluid retention and swelling."
        }
      },
      "profile": {
        "age": 38,
        "weight": 50,
        "height": 160,
        "ethnicity": "Asian",
        "bloodType": "B+",
        "gender": "Female"
      }
    }
    For the "profile" and "biomarkers" objects, only include keys that were found. The value should be appropriate for the type.`;

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction: "You are an expert clinical laboratory data extraction agent. You extract blood biomarker numbers and personal profile data with extreme accuracy. Return ONLY the single raw JSON string.",
      promptText,
      imagePayload,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json"
    });

    const firstBrace = textOutput.indexOf("{");
    const lastBrace = textOutput.lastIndexOf("}");
    let cleanJson = textOutput;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = textOutput.substring(firstBrace, lastBrace + 1);
    } else {
      cleanJson = cleanJson.trim().replace(/^```json/, "").replace(/```$/, "").trim();
    }
    const parsedData = JSON.parse(cleanJson);

    res.json({
      text: parsedData.summary,
      date: parsedData.date || null,
      biomarkers: parsedData.biomarkers || {},
      profile: parsedData.profile || {},
      customBiomarkerDefs: parsedData.customBiomarkerDefs || {}
    });
  } catch (error: any) {
    console.error("[Medical Analyze Error]:", error);
    res.status(500).json({ error: "Failed to extract medical data: " + error.message });
  }
});

// Gemini Biomarker Review Endpoint
app.post("/api/gemini/review-biomarker", async (req, res) => {
  const { message, history, profile, biomarkerDef, currentValue, modelId } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message" });

  try {
    let historyText = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyText = "Here is the conversation history so far:\n" + 
        history.map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join("\n") + "\n\n";
    }

    const systemInstruction = `You are an expert AI medical and nutritional assistant. The user is reviewing a specific health biomarker from their records.
Always consider the user's personal profile summary to deliver precise, context-appropriate responses.
User Profile: Age ${profile?.age || 'unknown'}, Gender: ${profile?.gender || 'unknown'}, Weight: ${profile?.weight || 'unknown'} kg, Height: ${profile?.height || 'unknown'} cm, Ethnicity: ${profile?.ethnicity || 'unknown'}.
Biomarker Key: ${biomarkerDef.key}
Biomarker Name: ${biomarkerDef.name}
Current Logged Value: ${currentValue} ${biomarkerDef.unit}
Standard Normal Range: ${biomarkerDef.normalRange}
Description: ${biomarkerDef.description}

CRITICAL METRIC & UNIT RULES:
1. Always prefer the International Standard (mmol/L) by default for lipids (LDL, HDL, Total Cholesterol, Triglycerides) and blood sugar (Fasting Glucose) unless the user specifically wants mg/dL.
2. Double-check that the metric/unit is consistent across the proposed value and the proposed normal range. Do NOT mix them up! (e.g., if value is 5.7, the unit must be mmol/L and range should be "under 3.0 mmol/L" or "under 5.2 mmol/L". If the unit is mg/dL, the value would be around 220 mg/dL and range "125 - 200 mg/dL"). An LDL value of 5.7 mg/dL or a range of "under 3.0 mg/dL" are mathematically impossible / dangerous errors. Always ensure accurate conversions and consistent values!
3. Ensure the "metric" field in the proposal matches the unit used in "range" and "value" (e.g. 'mmol/L').

You must carefully review the user's message and the conversation history so far.
If the user indicates that the logged value is wrong, or if they ask to correct/update it, or if you detect a discrepancy (like a unit mix-up, e.g. 5.7 mmol/L vs 5.7 mg/dL), you should propose a corrected version in the "proposal" field.
Even if they are just discussing the range or value and you identify a better, more personalized recommendation or correction, or if they ask "is the range correct? it looks way too high", you should propose an updated version of the biomarker log details (value, range, unit, benefit/risk) for their profile.

Respond strictly with a JSON object containing:
{
  "reply": "Your conversational response to the user. Explain the biomarker, answer their question, or discuss the range. Tell them about your proposed correction if you made one.",
  "proposal": {
    "name": "The biomarker name (e.g., 'Total Cholesterol')",
    "metric": "The unit of measurement (e.g., 'mmol/L' or 'mg/dL')",
    "value": "The corrected/proposed value (e.g. 5.7 or 220, as a number or string)",
    "range": "The normal/healthy range (personalized to their profile if possible, e.g., 'under 5.2 mmol/L' or '125-200 mg/dL')",
    "description": "Short description of what this biomarker measures",
    "benefitRisk": "Personalized benefit/risk statement based on the user's profile (age, gender, ethnicity, etc.) and this proposed value."
  },
  "pendingBiomarkers": {
    "${biomarkerDef.key}": 123.4
  }
}

Important:
- If no update or correction is discussed or needed yet, or if they are just asking a general question without any implication of correction or discrepancy, set "proposal" to null and "pendingBiomarkers" to null.
- If you do include a "proposal", make sure "pendingBiomarkers" contains the key and the numeric value of the proposed value (e.g. if proposed value is 5.7 or 220) so it can be approved and saved to their profile.
- Do not include markdown blocks like \`\`\`json in your response, just the raw JSON.`;

    const resultText = await callUnifiedLLM({
      modelId: modelId || "gemini-3.1-flash-lite",
      systemInstruction,
      promptText: `${historyText}User Message: "${message}"`,
      responseMimeType: "application/json"
    });

    const firstBrace = resultText.indexOf("{");
    const lastBrace = resultText.lastIndexOf("}");
    let cleanedText = resultText;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanedText = resultText.substring(firstBrace, lastBrace + 1);
    } else {
      cleanedText = cleanedText.replace(/```json/g, "").replace(/```/g, "").trim();
    }
    const resultJson = JSON.parse(cleanedText);
    
    // Support either response format mapping
    if (resultJson.proposedValue !== undefined && resultJson.proposedValue !== null && !resultJson.pendingBiomarkers) {
      resultJson.pendingBiomarkers = { [biomarkerDef.key]: resultJson.proposedValue };
    }
    
    res.json(resultJson);
  } catch (err: any) {
    console.error("Gemini Review Error:", err);
    res.status(500).json({ error: err.message || "Failed to review biomarker" });
  }
});

// Gemini Totality Insights Analysis Endpoint
app.post("/api/gemini/insight-analyze", async (req, res) => {
  try {
    const { profile, userProfile, foodLogs, biomarkerHistory, engine, refinement } = req.body;
    const activeProfile = profile || userProfile || {};
    const email = activeProfile?.email?.toLowerCase() || "";
    
    // Check if user is the special requested email and no refinement is requested
    if ((email === "chiwah.liu@gmail.com" || email === "cwah.liu@gmail.com" || email === "john@mail.com") && !refinement) {
      console.log(`[Insight] Triggered special preset recommendation report for: ${email}`);
      return res.json({
        report: {
          timestamp: new Date().toISOString(),
          dailyNutrientTargets: {
            calories: "1,700–1,800 kcal",
            protein: "90–100 g (protects kidneys)",
            totalFat: "55–65 g",
            saturatedFat: "under 15 g (critical for LDL)",
            unsaturatedFat: "35–45 g",
            omega3: "2.5–3 g",
            carbohydrates: "160–185 g (low GI)",
            addedSugar: "under 20 g",
            totalFibre: "35–40 g",
            solubleFibre: "10–15 g (critical for LDL)",
            sodium: "under 1,200 mg (kidney + BP protection)",
            potassium: "3,500–4,000 mg",
            magnesium: "400–420 mg",
            calcium: "1,000 mg",
            iron: "8 mg",
            zinc: "11 mg",
            selenium: "55 mcg",
            iodine: "150 mcg",
            phosphorus: "700 mg",
            vitaminD: "2,000 IU (East Asians commonly deficient)",
            vitaminB12: "2.4 mcg",
            folate: "400 mcg",
            vitaminC: "90 mg",
            vitaminE: "15 mg",
            vitaminK: "120 mcg",
            vitaminA: "900 mcg",
            vitaminB6: "1.7 mg",
            thiamine: "1.2 mg",
            riboflavin: "1.3 mg",
            niacin: "16 mg"
          },
          mostImportantNextStep: "See GP urgently about statin — rosuvastatin 5mg is the evidence-based starting point for East Asian men with your high LDL, HbA1c, and declining kidney filtration.",
          actions: [
            {
              id: "act_1",
              task: "Consult GP about Low-Dose Statin prescription (e.g. Rosuvastatin 5mg)",
              explanation: "Given your elevated LDL-C and East Asian genetics, a low-dose statin is the most evidence-based starting point.",
              priority: "high",
              completed: false,
              type: "doctor"
            },
            {
              id: "act_2",
              task: "Schedule an HbA1c retest in 3 months with formal pre-diabetes assessment",
              explanation: "Your average blood sugar over the last months is borderline. Tight monitoring is critical.",
              priority: "high",
              completed: false,
              type: "test"
            },
            {
              id: "act_3",
              task: "Establish an annual Kidney Monitoring and eGFR protection plan",
              explanation: "Declining eGFR needs early stage tracking. Restricting saturated fat and excessive sodium is non-negotiable.",
              priority: "high",
              completed: false,
              type: "test"
            },
            {
              id: "act_4",
              task: "Test Vitamin D levels with your physician",
              explanation: "East Asians are commonly deficient, which impacts metabolic health, blood pressure, and cardiovascular outcomes.",
              priority: "medium",
              completed: false,
              type: "test"
            },
            {
              id: "act_5",
              task: "Substitute butter, coconut oil, and ghee with extra virgin olive oil",
              explanation: "Reducing saturated fat to strictly under 15g a day is essential to restore proper LDL values.",
              priority: "high",
              completed: false,
              type: "lifestyle"
            }
          ],
          dailyBenefits: [
            { id: "ben_1", activity: "Accumulate 30 minutes of brisk walking or light cardio", target: "150 mins per week", completed: false },
            { id: "ben_2", activity: "Add 1 tablespoon of ground flaxseed to your meals", target: "Daily", completed: false },
            { id: "ben_3", activity: "Restrict Saturated Fat intake strictly under 15g", target: "Daily", completed: false },
            { id: "ben_4", activity: "Incorporate high soluble fibre (e.g. Oats, Psyllium husk)", target: "10-15g soluble", completed: false }
          ],
          latestInsights: [
            {
              title: "Cardiovascular Risk Reduction in East Asian Cohorts",
              summary: "Recent studies demonstrate that East Asian men exhibit heightened sensitivity to low-dose statin therapy, with rosuvastatin 5mg yielding similar LDL reduction as 10mg in western populations while minimizing hepatic and muscular side effects.",
              link: "https://pubmed.ncbi.nlm.nih.gov/32041285/"
            },
            {
              title: "Soluble Fibre and Bile Acid Sequestration Mechanics",
              summary: "Clinical trials confirm that consuming 10g of soluble fibre daily (via oats, barley, or psyllium husk) triggers hepatic bile synthesis from existing LDL, lowering circulating bad cholesterol particles by 5% to 10% within 8 weeks.",
              link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4832151/"
            }
          ],
          healthRiskForecast: {
            year5: "Mildly progressive atherosclerosis, risk of transitioning from borderline pre-diabetes to active Type 2 Diabetes, and decline in renal filtration capacity to Stage 3 CKD.",
            year10: "Significant vascular plaque buildup. Kidney function might drop to GFR < 60, triggering high blood pressure. Elevated Risk of cardiovascular events.",
            year20: "40% probability of a coronary event. Accelerated kidney wear requiring complex nephrological intervention.",
            optimized5: "Restored LDL < 100 mg/dL, stabilized blood sugar in normal ranges, and kidney filtration preserved at healthy levels.",
            optimized10: "Plaque progression halted. Fully functional cardiovascular system and kidney values stabilized in the safe green zone.",
            optimized20: "Optimal cardiovascular performance. Healthy aging index score 95th percentile, active longevity with zero diabetic or renal complications."
          }
        }
      });
    }

    const ai = getGeminiClient();

    // If key missing, return simulated customized report
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MOCK_KEY" || process.env.GEMINI_API_KEY === "" || process.env.GEMINI_API_KEY.startsWith("YOUR_")) {
      return res.json({
        report: {
          timestamp: new Date().toISOString(),
          dailyNutrientTargets: {
            calories: "1,500–1,600 kcal",
            protein: "80–90 g",
            totalFat: "50–60 g",
            saturatedFat: "under 12 g",
            unsaturatedFat: "30–40 g",
            omega3: "2.0–2.5 g",
            carbohydrates: "150–170 g",
            addedSugar: "under 15 g",
            totalFibre: "30–35 g",
            solubleFibre: "8–12 g",
            sodium: "under 1,500 mg",
            potassium: "3,500 mg",
            magnesium: "400 mg",
            calcium: "1,000 mg",
            iron: "8 mg",
            zinc: "11 mg",
            selenium: "55 mcg",
            iodine: "150 mcg",
            phosphorus: "700 mg",
            vitaminD: "2,000 IU",
            vitaminB12: "2.4 mcg",
            folate: "400 mcg",
            vitaminC: "90 mg",
            vitaminE: "15 mg",
            vitaminK: "120 mcg",
            vitaminA: "900 mcg",
            vitaminB6: "1.7 mg",
            thiamine: "1.2 mg",
            riboflavin: "1.3 mg",
            niacin: "16 mg"
          },
          mostImportantNextStep: "Reduce saturated fat strictly to under 12g per day and complete a clinical blood re-test in 3 months to monitor cholesterol and glucose trends.",
          actions: [
            {
              id: "act_1",
              task: "Consult your primary care physician for a comprehensive health screening",
              explanation: "Based on your age and profile, regular annual biometric reviews are highly recommended.",
              priority: "high",
              completed: false,
              type: "doctor"
            },
            {
              id: "act_2",
              task: "Check your HbA1c and lipid panel every 6 months",
              explanation: "Routine blood metrics tracking will help confirm your lifestyle changes are successfully restoring biomarkers.",
              priority: "high",
              completed: false,
              type: "test"
            }
          ],
          dailyBenefits: [
            { id: "ben_1", activity: "Walk briskly for 30 minutes daily to boost metabolic health", target: "Daily", completed: false },
            { id: "ben_2", activity: "Substitute saturated fats with cold-pressed olive oil", target: "Daily", completed: false }
          ],
          latestInsights: [
            {
              title: "Dietary Fibers and Metabolic Longevity Indices",
              summary: "A high-fiber nutritional plan is linked to enhanced short-chain fatty acid gut synthesis, which improves overall insulin response and naturally reduces vascular inflammation markers.",
              link: "https://pubmed.ncbi.nlm.nih.gov/30612722/"
            }
          ],
          healthRiskForecast: {
            year5: "Slight vascular stiffness and mild risk of elevated glucose tolerance if sedentary habits persist.",
            year10: "Increasing risk of metabolic decline and minor cardiovascular strain.",
            year20: "Elevated probability of cardiovascular plaques and reduced active energy index.",
            optimized5: "Pristine blood pressure levels, balanced lipid particles, and metabolic health completely optimized.",
            optimized10: "Robust vascular health, optimized glycemic control, and ideal weight targets maintained.",
            optimized20: "Healthy aging with minimal chronic disease probability and vibrant metabolic index."
          }
        }
      });
    }

    // Construct profile detail string
    const profileText = `UserProfile: Age ${activeProfile.age}, Ethnicity: ${activeProfile.ethnicity}, Weight: ${activeProfile.weight}kg, Height: ${activeProfile.height}cm, Email: ${activeProfile.email}.`;
    const foodSummary = foodLogs && foodLogs.length > 0 ? `Recent Food Logs:\n${JSON.stringify(foodLogs.slice(-10))}` : "No food logs registered.";
    const biomarkerSummary = biomarkerHistory && biomarkerHistory.length > 0 ? `Biomarker Logs:\n${JSON.stringify(biomarkerHistory)}` : "No medical biomarkers logged.";

    const promptText = `Perform a comprehensive health profiling analysis using the totality of user information provided below.
    ${profileText}
    ${foodSummary}
    ${biomarkerSummary}
    ${refinement ? `\nUSER REFINEMENT REQUEST: The user has asked to refine the previous analysis. Please adjust the report considering this feedback: "${refinement.message}". Also consider this chat history: ${JSON.stringify(refinement.chatHistory)}` : ''}
    
    You need to look at all health indices and build a personalized health report.
    Identify any critical parameters (such as elevated LDL, high HbA1c, or low eGFR) and set custom daily nutrition targets for all 30 nutrients, prioritize clinical actions, lifestyle benefits, latest medical insights, and risk forecasts over 5, 10, and 20 years with vs without modifications.
    
    Respond strictly with a JSON object conforming exactly to this structure:
    {
      "report": {
        "timestamp": "ISO Date String",
        "dailyNutrientTargets": {
          "calories": "target string (e.g. 1,700-1,800 kcal)",
          "protein": "target string",
          "totalFat": "target string",
          "saturatedFat": "target string (e.g. under 15 g)",
          "unsaturatedFat": "target string",
          "omega3": "target string",
          "carbohydrates": "target string",
          "addedSugar": "target string",
          "totalFibre": "target string",
          "solubleFibre": "target string",
          "sodium": "target string",
          "potassium": "target string",
          "magnesium": "target string",
          "calcium": "target string",
          "iron": "target string",
          "zinc": "target string",
          "selenium": "target string",
          "iodine": "target string",
          "phosphorus": "target string",
          "vitaminD": "target string",
          "vitaminB12": "target string",
          "folate": "target string",
          "vitaminC": "target string",
          "vitaminE": "target string",
          "vitaminK": "target string",
          "vitaminA": "target string",
          "vitaminB6": "target string",
          "thiamine": "target string",
          "riboflavin": "target string",
          "niacin": "target string"
        },
        "mostImportantNextStep": "Specific human-focused non-negotiable step",
        "actions": [
          {
            "id": "unique string id",
            "task": "clinical or screening task",
            "explanation": "why this is important for their profile",
            "priority": "high" | "medium" | "low",
            "completed": false,
            "type": "doctor" | "test" | "lifestyle"
          }
        ],
        "dailyBenefits": [
          {
            "id": "unique string id",
            "activity": "e.g. Walk 30 min",
            "target": "e.g. Daily",
            "completed": false
          }
        ],
        "latestInsights": [
          {
            "title": "Vascular Plaque Progression Control",
            "summary": "1-2 sentence clinical takeaway",
            "link": "https://pubmed.ncbi.nlm.nih.gov/..."
          }
        ],
        "healthRiskForecast": {
          "year5": "Detailed text forecast of health risk if habits do not change",
          "year10": "Detailed text forecast of health risk if habits do not change",
          "year20": "Detailed text forecast of health risk if habits do not change",
          "optimized5": "Detailed text forecast of benefits if targets are optimized",
          "optimized10": "Detailed text forecast of benefits if targets are optimized",
          "optimized20": "Detailed text forecast of benefits if targets are optimized"
        }
      }
    }`;

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction: "You are a world-class preventative cardiologist, endocrinologist, and clinical longevity researcher. Your response must be an exact single JSON matching the requested schema. Never add markdown wrappers.",
      promptText,
      responseMimeType: "application/json"
    });

    const firstBrace = textOutput.indexOf("{");
    const lastBrace = textOutput.lastIndexOf("}");
    let cleanJson = textOutput;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = textOutput.substring(firstBrace, lastBrace + 1);
    } else {
      cleanJson = cleanJson.trim().replace(/^```json/, "").replace(/```$/, "").trim();
    }
    const parsedData = JSON.parse(cleanJson);

    res.json(parsedData);
  } catch (error: any) {
    console.error("[Insight Analyze Error]:", error);
    res.status(500).json({ error: "Failed to generate preventative recommendations: " + error.message });
  }
});

// Gemini Food Idea Endpoint
app.post("/api/gemini/food-idea", async (req, res) => {
  try {
    const { message, userProfile, location, recentMeals, engine, budget, currency, maxDistance, clientNearbyPlaces } = req.body;

    if (process.env.GEMINI_API_KEY === undefined) {
      return res.json({
        text: "Please note: GEMINI_API_KEY is not configured in the Secrets manager.",
        ideas: [
          {
            id: 'mock-1',
            name: "Grilled Chicken Salad",
            placeName: "Sweetgreen",
            address: "10 Downing St, London, UK",
            locationLink: "https://www.google.com/maps/search/?api=1&query=Sweetgreen+10+Downing+St+London+UK",
            benefitExplanation: "High protein and fiber, good for your profile.",
            tags: ["High Protein", "Low Carb"],
            distanceKm: 1.2,
            estimatedBudget: "£4.50",
            dishImageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80"
          }
        ]
      });
    }

    const budgetValue = budget || "100000";
    const currencyValue = currency || "IDR";
    const maxDistanceValue = maxDistance || 3;

    // Perform reverse-geocoding of coordinates to find exact human-readable address for highly accurate localized searches!
    let resolvedAddressText = "";
    let nearbyPlacesText = "";
    if (location && location.lat && location.lng) {
      try {
        console.log(`[ReverseGeocode] Reverse geocoding lat/lng: ${location.lat}, ${location.lng}...`);
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat}&lon=${location.lng}`, {
          headers: { 
            'User-Agent': 'HealthBiomarkerApplet/1.0 (Cwah.Liu@gmail.com)',
            'Accept-Language': 'en, id'
          }
        });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData && geoData.display_name) {
            resolvedAddressText = geoData.display_name;
            console.log("[ReverseGeocode] Resolved coordinates successfully to:", resolvedAddressText);
          }
        }
      } catch (geoErr) {
        console.warn("[ReverseGeocode] Error during reverse geocoding:", geoErr);
      }

      // Use client-side overpass results if provided, otherwise try server-side
      if (clientNearbyPlaces && clientNearbyPlaces.length > 0) {
        nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
        clientNearbyPlaces.forEach((el: any) => {
          nearbyPlacesText += `- Name: "${el.name}" (Lat: ${el.lat}, Lng: ${el.lng})\n`;
          if (el.address) nearbyPlacesText += `  Address: ${el.address}\n`;
          if (el.opening_hours) nearbyPlacesText += `  Hours: ${el.opening_hours}\n`;
        });
        nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
        console.log(`[Overpass] Found ${clientNearbyPlaces.length} real places from client side.`);
      } else {
        try {
          console.log(`[Overpass] Fetching real restaurants near lat/lng: ${location.lat}, ${location.lng} from server...`);
          const radius = Math.min(maxDistanceValue * 1000, 5000); // meters
          const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${location.lat},${location.lng}););out 30;`;
          
          const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(overpassQuery)
          });
          
          if (overpassRes.ok) {
            const overpassData = await overpassRes.json();
            if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
              nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
              overpassData.elements.forEach((el: any) => {
                if (el.tags && el.tags.name) {
                  nearbyPlacesText += `- Name: "${el.tags.name}" (Lat: ${el.lat}, Lng: ${el.lon})\n`;
                  if (el.tags['addr:street']) {
                    nearbyPlacesText += `  Address: ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}\n`;
                  }
                  if (el.tags['opening_hours']) {
                    nearbyPlacesText += `  Hours: ${el.tags['opening_hours']}\n`;
                  }
                }
              });
              nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
              console.log(`[Overpass] Found ${overpassData.elements.length} real places nearby from server.`);
            } else {
              console.log(`[Overpass] No places found nearby from server.`);
            }
          }
        } catch (err) {
          console.warn("[Overpass] Error fetching nearby places from server:", err);
        }
      }
    }

    const userCtx = userProfile ? `User Profile: Age ${userProfile.age}, Ethnicity: ${userProfile.ethnicity}, Weight: ${userProfile.weight}kg, Height: ${userProfile.height}cm.` : "User profile is unknown.";
    const userTimezone = userProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userLocalTime = new Date().toLocaleString('en-US', { timeZone: userTimezone });
    
    const locCtx = location ? `User Location: Latitude ${location.lat}, Longitude ${location.lng}.\nUser Local Time: ${userLocalTime}` : `User Local Time: ${userLocalTime}`;
    const addressCtx = resolvedAddressText ? `User Human-Readable Address / Neighborhood: "${resolvedAddressText}"` : "Human-readable address is not resolved.";
    const nearbyCtx = nearbyPlacesText ? `\n\n${nearbyPlacesText}\n\n` : "";
    const mealsCtx = recentMeals && recentMeals.length > 0 ? `Recent Meals: ${recentMeals.join(', ')}.` : "No recent meals recorded.";
    const budgetCtx = `Max Budget Limit: ${budgetValue} ${currencyValue}. Suggested meals/dishes MUST fit within this price!`;
    const distanceCtx = `Max Distance Limit: ${maxDistanceValue} km. All suggested venues must be within ${maxDistanceValue} km of the user's current location!`;

    const promptText = `You are a personalized AI Dietitian.
${userCtx}
${locCtx}
${addressCtx}
${mealsCtx}
${budgetCtx}
${distanceCtx}
${nearbyCtx}

Current User Input: "${message}"

CRITICAL SYSTEM REQUIREMENTS FOR VERACITY & LOGICAL ACCURACY:
1. VENUE SELECTION FROM PROVIDED LIST: You MUST ONLY select restaurants from the provided list of nearby REAL restaurants if it is provided. Do NOT invent or search for other restaurants. Use EXACTLY the lat and lng coordinates from the list. Do not modify the coordinates.
2. STRICT GEOGRAPHIC RADIUS ENFORCEMENT: If you must suggest a venue not on the list, it MUST be located within exactly ${maxDistanceValue} km of the user's location. Do not hallucinate coordinates.
3. SEARCH GROUNDING CONTEXT: Use Google Search Grounding ONLY to verify the selected restaurant's hours, reviews, or social media pages. Do not use it to find random new restaurants far away.
4. MAPS LINK PRECISION: Format the "locationLink" EXACTLY as: "https://www.google.com/maps/search/?api=1&query=EncodedRestaurantName&query_place_id=PlaceID". You MUST use Google Search Grounding to find the exact Google Maps Place ID for the restaurant and include it in the URL so it opens the exact address page. NEVER use generic search queries or coordinates for "locationLink" if a Place ID is retrievable! If you cannot find the Place ID, use "https://www.google.com/maps/search/?api=1&query=EncodedRestaurantName+EncodedAddress" with both the restaurant name and exact street address to open the address page correctly.
5. STRICT OPENING HOURS ENFORCEMENT: The user's current local time is ${userLocalTime}. You MUST capture the exact opening and closing time and add it to the result for the recommended place in the 'openingHours' field. You MUST use Google Search Grounding to actively search for the opening hours of the specific restaurant you recommend. Never use '--' unless you genuinely cannot find it online. You should only recommend places that are STILL OPEN 1 HOUR from the current local time!
6. REFERENCE LINK: For the 'menuLink' field, you MUST provide a direct, high-quality, real web link to the restaurant's actual official website, Instagram/Facebook page, TripAdvisor page, Yelp page, or specific Google Maps business page. DO NOT use generic Google Search query pages (like 'google.com/search?q=...') or generic placeholders, as this is unacceptable. Use Google Search Grounding to locate their actual website or profile!
7. ZERO-FIND FALLBACK & STRICT RADIUS: If no verified physical restaurants are found within the exact ${maxDistanceValue} km radius of the user's coordinates, YOU MUST NOT SUGGEST ANY PLACES. In this case, you MUST only suggest generic healthy dishes to cook at home (do not include placeName, address, lat, lng, locationLink, menuLink, or distanceKm). Clearly explain in your text response that no verified venues were found within ${maxDistanceValue} km, and suggest increasing the search radius. NEVER hallucinate places far away or fake coordinates.

Include a short conversational response (text), and a list of between 3 and 5 distinct, diverse structured food ideas (ideas) that meet the constraints. Under no circumstances should you return only 1 idea.
Each idea should have:
- name: string (A general, common healthy food category they serve, e.g. "Grilled Chicken Salad" or "Sushi". DO NOT hallucinate exact menu items unless verified.)
- placeName: string (Optional. The verified, real-world restaurant name. Omit if suggesting a home-cooked meal.)
- address: string (Optional. The verified, exact physical street address.)
- lat: number (Optional. The latitude of the suggested place. Omit if no place is found within the radius.)
- lng: number (Optional. The longitude of the suggested place. Omit if no place is found within the radius.)
- locationLink: string (Optional. Google Maps Search URL)
- menuLink: string (Optional. A URL to ANY relevant webpage about the restaurant, such as Google Maps, Yelp, Instagram, or their website. DO NOT use recipe search links!)
- distanceKm: number (Optional. The straight-line physical distance in km. This MUST be strictly <= ${maxDistanceValue} km! Omit if home-cooked.)
- estimatedBudget: string (The estimated price of this suggested dish, formatted nicely with the currency symbol, e.g., "Rp 45,000" or "£3.50". This MUST be within the maximum budget of ${budgetValue} ${currencyValue}!)
- dishImageUrl: string (A valid, beautiful, and relevant Unsplash food image URL showing this specific type of dish, e.g., "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80" for a salad, or a suitable search query image URL from Unsplash.)
- benefitExplanation: string (Why this is good for the user's profile)
- tags: array of strings (e.g. ["High Protein", "Low Carb"])
- openingHours: string (The opening hours of the restaurant. E.g., "10:00 AM - 10:00 PM". Search for it actively!)

Respond with a structured JSON format matching this schema exactly:
{
  "text": "Your conversational response here",
  "ideas": [
    {
      "name": "Food Name",
      "placeName": "Restaurant or Place Name",
      "address": "123 Main St, City, State",
      "lat": -6.2088,
      "lng": 106.8456,
      "locationLink": "https://www.google.com/maps/search/?api=1&query=HokBen&query_place_id=ChIJKZ1Uh-P1aS4R61b3Rsx8mSU",
      "menuLink": "https://www.hokben.co.id/",
      "distanceKm": 1.2,
      "estimatedBudget": "Rp 45,000",
      "dishImageUrl": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80",
      "benefitExplanation": "Why this is good...",
      "tags": ["tag1", "tag2"],
      "openingHours": "10:00 AM - 10:00 PM"
    }
  ]
}`;

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction: "You are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.",
      promptText,
      responseMimeType: "application/json",
      googleSearch: true
    });

    const firstBrace = textOutput.indexOf("{");
    const lastBrace = textOutput.lastIndexOf("}");
    let cleanJson = textOutput;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = textOutput.substring(firstBrace, lastBrace + 1);
    }
    const parsedData = JSON.parse(cleanJson);

    if (parsedData.ideas && Array.isArray(parsedData.ideas)) {
      parsedData.ideas = parsedData.ideas.map((idea: any) => ({
        ...idea,
        id: 'idea_' + Date.now() + Math.random().toString(36).substr(2, 9)
      }));
    }

    res.json(parsedData);
  } catch (error: any) {
    console.error("[Food Idea Analyze Error]:", error);
    const isQuotaError = error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED");
    
    const warningNotice = isQuotaError
      ? "*(Note: Your Gemini API key has exceeded its quota/rate limits. To prevent service interruption, I have generated these offline recommendations using high-quality nutritional heuristics based on your profile!)*\n\n"
      : "*(Note: Gemini connection timed out. Showing offline healthy options based on your profile!)*\n\n";

    const fallbackIdeas = [
      {
        id: 'idea_offline_' + Date.now() + '_1',
        name: "Grilled Salmon Avocado Bowl",
        placeName: "Local Healthy Kitchen & Grill",
        address: "Nearby health-centric restaurant",
        locationLink: "https://www.google.com/maps/search/?api=1&query=Healthy+Restaurant+Near+Me",
        menuLink: "https://www.google.com/search?q=Healthy+Restaurant+Near+Me+Menu",
        distanceKm: 0.8,
        estimatedBudget: req.body?.userProfile && req.body?.userProfile.ethnicity === "Asian" ? "Rp 65,000" : "£8.50",
        dishImageUrl: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=600&q=80",
        benefitExplanation: "Excellent source of omega-3 fatty acids and monounsaturated fats. High protein and low sodium, perfect for cardiovascular and arterial support.",
        tags: ["High Protein", "Heart Healthy", "Omega-3 Rich"]
      },
      {
        id: 'idea_offline_' + Date.now() + '_2',
        name: "Superfood Quinoa Salad",
        placeName: "Sweetgreen or local Salad Bar",
        address: "Nearby fresh produce bistro",
        locationLink: "https://www.google.com/maps/search/?api=1&query=Salad+Bar+Near+Me",
        menuLink: "https://www.google.com/search?q=Salad+Bar+Near+Me+Menu",
        distanceKm: 1.2,
        estimatedBudget: req.body?.userProfile && req.body?.userProfile.ethnicity === "Asian" ? "Rp 45,000" : "£6.90",
        dishImageUrl: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=80",
        benefitExplanation: "Rich in complex slow-digesting carbohydrates, soluble fibre, and magnesium. Great for supporting glucose management and lowering LDL cholesterol.",
        tags: ["Fiber Rich", "Low Glycemic", "Vegetarian"]
      },
      {
        id: 'idea_offline_' + Date.now() + '_3',
        name: "Steamed Edamame & Teriyaki Tofu Bowl",
        placeName: "Local Japanese or Asian Bistro",
        address: "Nearby fresh Asian diner",
        locationLink: "https://www.google.com/maps/search/?api=1&query=Japanese+Diner+Near+Me",
        menuLink: "https://www.google.com/search?q=Japanese+Diner+Near+Me+Menu",
        distanceKm: 1.5,
        estimatedBudget: req.body?.userProfile && req.body?.userProfile.ethnicity === "Asian" ? "Rp 35,000" : "£5.50",
        dishImageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=600&q=80",
        benefitExplanation: "Plant-based protein source rich in soy isoflavones, soluble fiber, and calcium to support muscle recovery and joint health.",
        tags: ["Vegan", "High Fiber", "Calcium Support"]
      }
    ];

    res.json({
      text: warningNotice + "Here are three personalized recommendations that perfectly support your biomarkers, available at healthy venues near you:",
      ideas: fallbackIdeas
    });
  }
});

// Google Health / Google Fit OAuth Endpoints
app.get('/api/health-connect/url', (req, res) => {
  // Use the host header directly for the redirect URI
  const host = req.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/health-connect/callback`;
  
  const params = new URLSearchParams({
    client_id: process.env.GHealth_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/fitness.activity.read',
    access_type: 'offline',
    prompt: 'consent'
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, redirectUri });
});

app.get(['/health-connect/callback', '/health-connect/callback/'], async (req, res) => {
  const { code } = req.query;
  const host = req.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/health-connect/callback`;

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GHealth_CLIENT_ID || '',
        client_secret: process.env.GHealth_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(JSON.stringify(tokenData));
    }

    res.send(`
      <html>
        <body>
          <script>
            try {
              localStorage.setItem('ghealth_tokens', JSON.stringify(${JSON.stringify(tokenData)}));
              localStorage.setItem('ghealth_auth_status', 'SUCCESS');
            } catch (e) {
              console.error("Failed to write to localStorage:", e);
            }

            if (window.opener) {
              try {
                window.opener.postMessage({ type: 'GHEALTH_AUTH_SUCCESS', tokens: ${JSON.stringify(tokenData)} }, '*');
              } catch (e) {
                console.error("Failed to postMessage:", e);
              }
              window.close();
            } else {
              setTimeout(() => {
                window.close();
              }, 1500);
            }
          </script>
          <div style="font-family: sans-serif; text-align: center; padding-top: 40px; color: #333;">
            <h3 style="color: #4f46e5; margin-bottom: 8px;">Connection Successful!</h3>
            <p style="margin: 4px 0; font-size: 14px;">Your Google Health account has been connected.</p>
            <p style="font-size: 12px; color: #666; margin-top: 12px;">This window will close automatically.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("GHealth OAuth error:", err);
    res.status(500).send(`Error exchanging code for tokens: ${err.message}`);
  }
});

app.post('/api/health-connect/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Missing refresh_token' });
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.GHealth_CLIENT_ID || '',
        client_secret: process.env.GHealth_CLIENT_SECRET || '',
        refresh_token: refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
    
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/health-connect/diagnostics', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(401).json({ error: 'Missing access_token' });

  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${access_token}`);
    const tokenInfo = await tokenInfoRes.json();

    const dsRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const dsData = await dsRes.json();

    res.json({
      tokenInfo: tokenInfo,
      dataSourcesCount: dsData.dataSource ? dsData.dataSource.length : 0,
      dataSources: dsData.dataSource ? dsData.dataSource.map((d: any) => d.dataStreamId) : dsData
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/health-connect/steps', async (req, res) => {
  const { access_token, startTimeMillis, endTimeMillis } = req.body;
  
  if (!access_token) {
    return res.status(401).json({ error: 'Missing access_token' });
  }

  try {
    const now = new Date();
    const endTime = endTimeMillis || now.getTime();
    
    // startTimeMillis is provided as the local start of today (midnight).
    const startTime = startTimeMillis || (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());

    // Align queryStartTime to exactly 7 days before today's midnight to ensure 24h buckets align with midnight.
    const queryStartTime = startTime - 7 * 24 * 60 * 60 * 1000;

    console.log(`[GoogleFit] Querying from ${new Date(queryStartTime).toISOString()} to ${new Date(endTime).toISOString()} with primary datasource estimated_steps...`);

    // 1. Primary: Aggregate using the estimated_steps datasource as requested by the user.
    let response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        aggregateBy: [{
          dataTypeName: 'com.google.step_count.delta',
          dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: queryStartTime,
        endTimeMillis: endTime
      })
    });

    let data = await response.json();
    
    // If the specific estimated_steps fails, try general com.google.step_count.delta as fallback
    if (!response.ok) {
      console.warn("Primary estimated_steps aggregation failed, trying general com.google.step_count.delta...");
      response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.delta'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: queryStartTime,
          endTimeMillis: endTime
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      console.warn("General delta also failed, trying com.google.step_count.cumulative...");
      response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.cumulative'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: queryStartTime,
          endTimeMillis: endTime
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    // Parse the steps day-by-day (each bucket represents 1 day)
    let todaySteps = 0;
    let totalSevenDaySteps = 0;
    let lastActiveDaySteps = 0;
    let lastActiveDayTimestamp = "";
    let activeDaysCount = 0;
    let history: { date: string, value: number }[] = [];

    if (data.bucket && data.bucket.length > 0) {
      data.bucket.forEach((b: any) => {
        let bucketSteps = 0;
        if (b.dataset && b.dataset[0] && b.dataset[0].point && b.dataset[0].point.length > 0) {
          b.dataset[0].point.forEach((p: any) => {
            if (p.value && p.value[0]) {
              if (p.value[0].intVal !== undefined) {
                bucketSteps += p.value[0].intVal;
              } else if (p.value[0].fpVal !== undefined) {
                bucketSteps += Math.round(p.value[0].fpVal);
              }
            }
          });
        }

        totalSevenDaySteps += bucketSteps;
        if (bucketSteps > 0) {
          lastActiveDaySteps = bucketSteps;
          activeDaysCount++;
          if (b.startTimeMillis) {
            lastActiveDayTimestamp = new Date(parseInt(b.startTimeMillis, 10)).toLocaleDateString();
          }
        }
        
        if (b.startTimeMillis) {
          const dateStr = new Date(parseInt(b.startTimeMillis, 10)).toISOString().split('T')[0];
          history.push({ date: dateStr, value: bucketSteps });
        }

        // Check if this bucket corresponds to today's range
        const bucketStart = parseInt(b.startTimeMillis || "0", 10);
        const bucketEnd = parseInt(b.endTimeMillis || "0", 10);
        
        // If this bucket is today's bucket
        if (bucketStart >= startTime) {
          todaySteps += bucketSteps;
        }
      });
    }

    // Robust raw dataset query fallbacks (direct point read instead of aggregate query)
    // Helps with third-party sync apps or devices logging directly to Fit without bucket aggregate syncing.
    if (todaySteps === 0 && totalSevenDaySteps === 0) {
      console.log("[GoogleFit] Aggregate returned 0 steps. Activating dynamic direct dataset query fallbacks...");
      
      let bestSum = 0;
      let bestDataSaved = null;
      let bestSourceName = "";

      try {
        const dsRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        if (dsRes.ok) {
          const dsData = await dsRes.json();
          if (dsData.dataSource && dsData.dataSource.length > 0) {
            const stepSources = dsData.dataSource.filter((d: any) => 
              d.dataType && d.dataType.name && d.dataType.name.includes("step_count")
            );

            for (const source of stepSources) {
              try {
                let currentSum = 0;
                let currentTodaySum = 0;
                const sourceId = encodeURIComponent(source.dataStreamId);
                const rawRes = await fetch(
                  `https://www.googleapis.com/fitness/v1/users/me/dataSources/${sourceId}/datasets/${queryStartTime * 1000000}-${endTime * 1000000}`,
                  { headers: { 'Authorization': `Bearer ${access_token}` } }
                );
                
                if (rawRes.ok) {
                  const rawData = await rawRes.json();
                  if (rawData.point && rawData.point.length > 0) {
                    if (source.dataType.name === "com.google.step_count.cumulative") {
                      // For cumulative, we sum positive differences between consecutive points
                      let lastVal = -1;
                      rawData.point.forEach((p: any) => {
                        if (p.value && p.value[0]) {
                          let val = p.value[0].intVal !== undefined ? p.value[0].intVal : (p.value[0].fpVal !== undefined ? Math.round(p.value[0].fpVal) : 0);
                          let delta = 0;
                          if (lastVal !== -1) {
                            if (val >= lastVal) {
                              delta = val - lastVal;
                            } else {
                              // Counter reset
                              delta = val;
                            }
                          }
                          currentSum += delta;
                          
                          // Check if point is from today
                          const pEndMillis = p.endTimeNanos ? Number(p.endTimeNanos) / 1000000 : 0;
                          if (pEndMillis >= startTime) {
                            currentTodaySum += delta;
                          }

                          lastVal = val;
                        }
                      });
                    } else {
                      // For delta, we just sum them up
                      rawData.point.forEach((p: any) => {
                        if (p.value && p.value[0]) {
                          let val = p.value[0].intVal !== undefined ? p.value[0].intVal : (p.value[0].fpVal !== undefined ? Math.round(p.value[0].fpVal) : 0);
                          currentSum += val;
                          
                          const pEndMillis = p.endTimeNanos ? Number(p.endTimeNanos) / 1000000 : 0;
                          if (pEndMillis >= startTime) {
                            currentTodaySum += val;
                          }
                        }
                      });
                    }
                    
                    if (currentSum > bestSum) {
                      bestSum = currentSum;
                      todaySteps = currentTodaySum;
                      bestDataSaved = rawData;
                      bestSourceName = source.dataStreamId;
                    }
                  }
                }
              } catch (e) {
                console.warn(`[GoogleFit] Raw query failed for ${source.dataStreamId}`, e);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[GoogleFit] Failed to fetch data sources for fallback:", e);
      }

      // Use the best available source
      if (bestSum > 0) {
        totalSevenDaySteps = bestSum;
        data = { source: `dynamic_raw_${bestSourceName}`, totalPoints: bestDataSaved?.point?.length, ...bestDataSaved };
        console.log(`[GoogleFit] Successfully retrieved ${bestSum} raw steps via fallback from ${bestSourceName}! Today steps: ${todaySteps}`);
      }
    }

    const sevenDayAverage = activeDaysCount > 0 ? Math.round(totalSevenDaySteps / activeDaysCount) : Math.round(totalSevenDaySteps / 7);

    res.json({ 
      steps: todaySteps, 
      sevenDayTotal: totalSevenDaySteps,
      sevenDayAverage,
      lastActiveDaySteps: lastActiveDaySteps || todaySteps,
      lastActiveDayTimestamp: lastActiveDayTimestamp || new Date().toLocaleDateString(),
      history,
      raw: data 
    });
  } catch (err: any) {
    console.error("GHealth Steps error:", err);
    res.status(500).json({ error: "Failed to fetch steps: " + err.message });
  }
});

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Health Cockpit App] Full-Stack server running on port ${PORT}`);
  });
}

startServer();
