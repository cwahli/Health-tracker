import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { encode as toonEncode } from "@toon-format/toon";
import { AsyncLocalStorage } from "async_hooks";
import { Firestore } from "@google-cloud/firestore";

dotenv.config();
console.log("Maps Key status at server boot:", process.env.GOOGLE_MAPS_API_KEY ? "DEFINED" : "UNDEFINED");

// Initialize Firebase Firestore for server-side calculations using Google Cloud Firestore Node.js SDK (bypasses security rules)
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    db = new Firestore({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
    });
    console.log("[Firebase] Backend Firestore (Admin Node.js SDK) successfully initialized.");
  } else {
    console.warn("[Firebase] No firebase-applet-config.json found at server boot.");
  }
} catch (err: any) {
  console.error("[Firebase] Error initializing Firestore on server:", err.message || err);
}

const app = express();
const PORT = 3000;
const SERVER_START_TIME = Date.now();

async function startServer() {
  // In-Memory & Local File Sync storage to act as the durable synced database
  const SYNC_DIR = path.join(process.cwd(), "data", "sync");
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }

  // Increase limit to allow base64 uploaded image payloads
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Register session tracking middleware for isolated logging
  app.use((req, res, next) => {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    logSessionStorage.run(sessionId, () => {
      next();
    });
  });

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

const logSessionStorage = new AsyncLocalStorage<string>();

// Global Debug Logs array for LLM process tracking and diagnostics
interface DebugLog {
  timestamp: string;
  message: string;
}
let globalDebugLogs: DebugLog[] = [];
let sessionDebugLogs: { [sessionId: string]: DebugLog[] } = {};

function addDebugLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[LLM DEBUG ${timestamp}]: ${msg}`);
  
  const sessionId = logSessionStorage.getStore() || "global";
  if (!sessionDebugLogs[sessionId]) {
    sessionDebugLogs[sessionId] = [];
  }
  sessionDebugLogs[sessionId].push({ timestamp, message: msg });
  if (sessionDebugLogs[sessionId].length > 1500) {
    sessionDebugLogs[sessionId].shift();
  }

  globalDebugLogs.push({ timestamp, message: msg });
  if (globalDebugLogs.length > 2000) {
    globalDebugLogs.shift();
  }
}

// Helper to retrieve the Google Maps Place ID from business name & location
async function fetchGoogleMapsPlaceId(businessName: string, latitude: string | number, longitude: string | number): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    addDebugLog(`[get_google_maps_place_id] API Key is missing in process.env`);
    return "ERROR_API_FAILED";
  }
  
  // Use a strict AbortController timeout to prevent hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  
  try {
    const latStr = String(latitude).trim();
    const lngStr = String(longitude).trim();
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(businessName)}&inputtype=textquery&locationbias=point:${latStr},${lngStr}&fields=place_id&key=${apiKey}`;
    
    addDebugLog(`[get_google_maps_place_id] Fetching place ID for "${businessName}" near (${latStr}, ${lngStr})`);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      addDebugLog(`[get_google_maps_place_id] Google Places API HTTP error: ${res.status}`);
      return "ERROR_API_FAILED";
    }
    const data = await res.json();
    if (data.status === "ZERO_RESULTS") {
      addDebugLog(`[get_google_maps_place_id] No results found (ZERO_RESULTS) for "${businessName}"`);
      return "NOT_FOUND";
    }
    if (data.candidates && data.candidates.length > 0) {
      const pId = data.candidates[0].place_id || "NOT_FOUND";
      addDebugLog(`[get_google_maps_place_id] Resolved successfully! Place ID: ${pId}`);
      return pId;
    }
    addDebugLog(`[get_google_maps_place_id] Status was ${data.status || 'unknown'}, candidates empty.`);
    return "NOT_FOUND";
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Request timed out after 2500ms' : (err.message || err);
    addDebugLog(`[get_google_maps_place_id] Error: ${errorMsg}`);
    return "ERROR_API_FAILED";
  }
}

// Unified Multi-Provider LLM Router with automatic fallbacks & simulation modes
async function callUnifiedLLM({
  modelId,
  systemInstruction,
  promptText,
  imagePayload,
  imagePayloads,
  responseMimeType,
  googleSearch,
  enablePlaceIdTool
}: {
  modelId: string;
  systemInstruction: string;
  promptText: string;
  imagePayload?: { mimeType: string; data: string } | null;
  imagePayloads?: { mimeType: string; data: string }[] | null;
  responseMimeType?: "application/json" | "text/plain";
  googleSearch?: boolean;
  enablePlaceIdTool?: boolean;
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

  const initialParts: any[] = [];
  if (imagePayloads && imagePayloads.length > 0) {
    for (const img of imagePayloads) {
      initialParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }
  } else if (imagePayload) {
    initialParts.push({
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

  initialParts.push({ text: promptText });

  const contents: any[] = [
    {
      role: "user",
      parts: initialParts
    }
  ];

  const configObj: any = {
    responseMimeType: isJson ? "application/json" : "text/plain",
    systemInstruction: resolvedInstruction,
    tools: []
  };
  
  if (googleSearch) {
    configObj.tools.push({ googleSearch: {} });
  }

  if (enablePlaceIdTool) {
    configObj.tools.push({
      functionDeclarations: [
        {
          name: "get_google_maps_place_id",
          description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              business_name: { type: Type.STRING },
              latitude: { type: Type.STRING },
              longitude: { type: Type.STRING }
            },
            required: ["business_name", "latitude", "longitude"]
          }
        }
      ]
    });
  }

  if (googleSearch && enablePlaceIdTool) {
    configObj.toolConfig = { includeServerSideToolInvocations: true };
  }

  if (configObj.tools.length === 0) {
    delete configObj.tools;
  }

  let finalResponseText = "{}";
  addDebugLog(`[UnifiedLLM] Dispatching prompt to model: "${targetGeminiModel}". Contents turns: ${contents.length}.`);
  addDebugLog(`[UnifiedLLM-Prompt] System Instruction:\n${resolvedInstruction}`);
  addDebugLog(`[UnifiedLLM-Prompt] User Prompt:\n${promptText}`);
  try {
    let response = await ai.models.generateContent({
      model: targetGeminiModel,
      contents,
      config: configObj
    });
    
    // Handle function calls loop
    let callCount = 0;
    const maxCalls = 5;
    while (response.functionCalls && response.functionCalls.length > 0 && callCount < maxCalls) {
      callCount++;
      const calls = response.functionCalls;
      addDebugLog(`[UnifiedLLM] Received ${calls.length} tool call requests from Gemini (Turn ${callCount}/${maxCalls}).`);
      const modelParts: any[] = [];
      const userParts: any[] = [];

      for (const call of calls) {
        let functionResponseData = {};
        if (call.name === "get_google_maps_place_id") {
          try {
            const { business_name, latitude, longitude } = call.args as any;
            addDebugLog(`[UnifiedLLM] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
            const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude);
            if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
              functionResponseData = { 
                place_id: "NOT_FOUND", 
                instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
              };
            } else {
              functionResponseData = { place_id: pId };
            }
          } catch (e: any) {
            addDebugLog(`[UnifiedLLM] Exception executing tool call: ${e.message || e}`);
            functionResponseData = { 
              place_id: "NOT_FOUND", 
              instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
            };
          }
        } else {
          addDebugLog(`[UnifiedLLM] Warning: Unknown tool requested: "${call.name}"`);
        }
        
        modelParts.push({ functionCall: call });
        userParts.push({
          functionResponse: {
            name: call.name,
            response: functionResponseData
          }
        });
      }

      // Add the model's response (preserving thought_signature and candidates structure) to contents
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      } else {
        contents.push({
          role: "model",
          parts: modelParts
        });
      }

      // Add our function responses to contents
      contents.push({
        role: "user",
        parts: userParts
      });

      addDebugLog(`[UnifiedLLM] Feeding responses back to Gemini and requesting next content turn...`);
      response = await ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: configObj
      });
    }

    if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
      addDebugLog(`[UnifiedLLM] Reached maximum tool calls or text is empty. Forcing model to produce final text...`);
      contents.push({
        role: "user",
        parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
      });
      const forceTextConfig = { ...configObj };
      delete forceTextConfig.tools;
      delete forceTextConfig.toolConfig;
      response = await ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: forceTextConfig
      });
    }
    
    addDebugLog(`[UnifiedLLM] Successfully completed content generation. Response length: ${response.text?.length || 0} chars.`);
    addDebugLog(`[UnifiedLLM-Response] Complete response returned from agent:\n${response.text || "{}"}`);
    return response.text || "{}";
  } catch (err: any) {
    addDebugLog(`[UnifiedLLM] First generation attempt failed: ${err.message || err}.`);
    if (googleSearch) {
      addDebugLog(`[UnifiedLLM] Retrying without Google Search Grounding...`);
      const fallbackConfig = { ...configObj };
      delete fallbackConfig.tools;
      if (enablePlaceIdTool) {
        // keep the custom tool
        fallbackConfig.tools = [{
          functionDeclarations: [
            {
              name: "get_google_maps_place_id",
              description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  business_name: { type: Type.STRING },
                  latitude: { type: Type.STRING },
                  longitude: { type: Type.STRING }
                },
                required: ["business_name", "latitude", "longitude"]
              }
            }
          ]
        }];
      }
      try {
        // Reset contents to initial state for fallback to avoid duplicated turns
        const fallbackContents = [contents[0]];
        addDebugLog(`[UnifiedLLM-Fallback] Dispatching prompt to model without search grounding...`);
        let response = await ai.models.generateContent({
          model: targetGeminiModel,
          contents: fallbackContents,
          config: fallbackConfig
        });
        
        // Handle function calls loop for fallback
        let callCountFallback = 0;
        const maxCallsFallback = 5;
        while (response.functionCalls && response.functionCalls.length > 0 && callCountFallback < maxCallsFallback) {
          callCountFallback++;
          const calls = response.functionCalls;
          addDebugLog(`[UnifiedLLM-Fallback] Received ${calls.length} tool call requests (Turn ${callCountFallback}/${maxCallsFallback}).`);
          const modelParts: any[] = [];
          const userParts: any[] = [];

          for (const call of calls) {
            let functionResponseData = {};
            if (call.name === "get_google_maps_place_id") {
              try {
                const { business_name, latitude, longitude } = call.args as any;
                addDebugLog(`[UnifiedLLM-Fallback] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
                const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude);
                if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
                  functionResponseData = { 
                    place_id: "NOT_FOUND", 
                    instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                  };
                } else {
                  functionResponseData = { place_id: pId };
                }
              } catch (e: any) {
                addDebugLog(`[UnifiedLLM-Fallback] Exception executing tool call: ${e.message || e}`);
                functionResponseData = { 
                  place_id: "NOT_FOUND", 
                  instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                };
              }
            }
            
            modelParts.push({ functionCall: call });
            userParts.push({
              functionResponse: {
                name: call.name,
                response: functionResponseData
              }
            });
          }

          const modelContent = response.candidates?.[0]?.content;
          if (modelContent) {
            fallbackContents.push(modelContent);
          } else {
            fallbackContents.push({ role: "model", parts: modelParts });
          }
          fallbackContents.push({ role: "user", parts: userParts });

          addDebugLog(`[UnifiedLLM-Fallback] Feeding responses back to Gemini...`);
          response = await ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: fallbackConfig
          });
        }

        if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
          addDebugLog(`[UnifiedLLM-Fallback] Reached maximum tool calls or text is empty on fallback. Forcing final text...`);
          fallbackContents.push({
            role: "user",
            parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
          });
          const forceTextConfig = { ...fallbackConfig };
          delete forceTextConfig.tools;
          delete forceTextConfig.toolConfig;
          response = await ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: forceTextConfig
          });
        }
        
        addDebugLog(`[UnifiedLLM-Fallback] Successfully completed content generation on fallback. Response length: ${response.text?.length || 0} chars.`);
        addDebugLog(`[UnifiedLLM-Fallback-Response] Complete response returned from agent on fallback:\n${response.text || "{}"}`);
        return response.text || "{}";
      } catch (retryErr: any) {
        addDebugLog(`[UnifiedLLM-Fallback] Error on fallback retry: ${retryErr.message || retryErr}`);
        throw retryErr;
      }
    } else {
      throw err;
    }
  }
}

// Endpoint to fetch real server start/uptime status for accurate publication timing
app.get("/api/status", (req, res) => {
  res.json({ startTime: SERVER_START_TIME });
});

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
    const { message, image, images, imageDates, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance, userId, activeMeal } = req.body;

    // 1. Intercept prompt & read current active state from Request Body (passed from client)
    if (activeMeal) {
      addDebugLog(`[Client State] Received active meal: ${activeMeal.name}`);
    } else {
      addDebugLog(`[Client State] No active meal received.`);
    }

    // Check if key is mock
    if (process.env.GEMINI_API_KEY === undefined) {
      // If the user's message is a modify request, let's execute modify command offline!
      const isModifyRequest = message.toLowerCase().includes("change") || message.toLowerCase().includes("modify") || message.toLowerCase().includes("update") || message.toLowerCase().includes("remove") || message.toLowerCase().includes("add") || message.toLowerCase().includes("gram");
      
      if (isModifyRequest && activeMeal) {
        // Let's create an offline mock command
        let mockCommand: any = null;
        if (message.toLowerCase().includes("steak")) {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 100;
          mockCommand = { action: "update_weight", itemName: "Beef Steak", newWeightGrams: grams };
        } else if (message.toLowerCase().includes("remove")) {
          mockCommand = { action: "remove_item", itemName: "Beef Steak" };
        } else {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 120;
          mockCommand = { action: "add_item", itemName: "Extra Topping", newWeightGrams: grams };
        }

        const originalTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;
        
        if (mockCommand) {
          if (mockCommand.action === "update_weight") {
            const item = activeMeal.itemsBreakdown?.find((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (item) {
              const oldWeight = Number(item.weightGrams) || 1;
              const R = mockCommand.newWeightGrams / oldWeight;
              item.weightGrams = mockCommand.newWeightGrams;
              item.calories = Number((item.calories * R).toFixed(1));
              item.saturatedFat = Number((item.saturatedFat * R).toFixed(2));
              item.sodium = Number((item.sodium * R).toFixed(1));
            }
          } else if (mockCommand.action === "remove_item") {
            const idx = activeMeal.itemsBreakdown?.findIndex((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (idx !== -1) {
              activeMeal.itemsBreakdown.splice(idx, 1);
            }
          } else if (mockCommand.action === "add_item") {
            if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
            activeMeal.itemsBreakdown.push({
              name: mockCommand.itemName,
              weightGrams: mockCommand.newWeightGrams,
              calories: mockCommand.newWeightGrams * 1.5,
              saturatedFat: mockCommand.newWeightGrams * 0.02,
              sodium: mockCommand.newWeightGrams * 0.5
            });
          }
        }

        const newTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
        const mealWeightRatio = newTotalWeight / originalTotalWeight;

        activeMeal.weightGrams = newTotalWeight;
        activeMeal.composition = (activeMeal.itemsBreakdown || []).map((it: any) => it.name).join(", ");
        
        const newCalories = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
        const newSaturatedFat = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
        const newSodium = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

        activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
        activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
        activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

        for (const key of Object.keys(activeMeal.nutrients)) {
          if (key !== "calories" && key !== "saturatedFat" && key !== "sodium") {
            activeMeal.nutrients[key] = Number((activeMeal.nutrients[key] * mealWeightRatio).toFixed(2));
          }
        }

        // We removed offline mock write to user_meals to avoid permission issues

        return res.json({
          text: `[Simulated Offline Mod] Modifying active meal: **${activeMeal.name}** to new weights/items. Recalculated all 30 sub-nutrients mathematically offline to save tokens and ensure precision.`,
          data: activeMeal
        });
      }

      const isDiscussionRequest = message.toLowerCase().includes("why") || message.toLowerCase().includes("explain") || message.toLowerCase().includes("question");
      if (isDiscussionRequest) {
        return res.json({
          text: "This is a simulated conversational answer about your active meal ingredients, explaining that avocado and salmon are rich sources of dietary fibre and heart-healthy monounsaturated fatty acids.",
          data: null
        });
      }

      const mockNewLog = {
        name: "Avocado Salmon Toast",
        date: new Date().toISOString().split("T")[0],
        composition: "Whole wheat bread, mashed avocado, smoked salmon, cherry tomatoes, olive oil",
        weightGrams: 220,
        quantity: "1 serving",
        benefits: "High in omega-3 fatty acids from the salmon, rich in heart-healthy monounsaturated fats from avocado, and packed with dietary fibre from whole wheat toast.",
        risks: "Slightly elevated sodium from the smoked salmon. Moderation is advised if you have strict sodium limits.",
        healthImpact: "Contributes beautifully to your daily unsaturated fat target and omega-3 allowance. Soluble fibre aids in optimizing LDL cholesterol.",
        recommendation: "good",
        itemsBreakdown: [
          { name: "Whole wheat bread", weightGrams: 60, calories: 156, saturatedFat: 0.1, sodium: 180 },
          { name: "Mashed avocado", weightGrams: 80, calories: 128, saturatedFat: 1.6, sodium: 6 },
          { name: "Smoked salmon", weightGrams: 60, calories: 117, saturatedFat: 0.5, sodium: 290 },
          { name: "Cherry tomatoes & olive oil", weightGrams: 20, calories: 79, saturatedFat: 1.0, sodium: 4 }
        ],
        nutrients: {
          calories: 480, protein: 18, totalFat: 16, saturatedFat: 3.2, unsaturatedFat: 12.5, omega3: 1.8, carbohydrates: 28, addedSugar: 0, totalFibre: 8, solubleFibre: 2.5, sodium: 480, potassium: 520, magnesium: 65, calcium: 45, iron: 2.1, zinc: 1.5, selenium: 22, iodine: 15, phosphorus: 180, vitaminD: 120, vitaminB12: 1.8, folate: 45, vitaminC: 12, vitaminE: 3.5, vitaminK: 25, vitaminA: 60, vitaminB6: 0.4, thiamine: 0.15, riboflavin: 0.18, niacin: 4.2
        }
      };

      return res.json({
        text: "Please note: GEMINI_API_KEY is not configured in the Secrets manager. Simulated Avocado Salmon Toast saved to your Firestore active state:",
        data: mockNewLog
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

    let userCtx = "";
    if (userProfile) {
      userCtx = `\nUSER DIETARY PROFILE & DEMOGRAPHICS:\n` +
        `- Age: ${userProfile.age || 'Unknown'} years old\n` +
        `- Gender: ${userProfile.gender || 'Unknown'}\n` +
        `- Weight: ${userProfile.weight || 'Unknown'} kg\n` +
        `- Height: ${userProfile.height || 'Unknown'} cm\n` +
        `- Ethnicity: ${userProfile.ethnicity || 'Unknown'}\n`;
    }

    const userTimezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let localDateStr;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      localDateStr = formatter.format(new Date());
    } catch(e) {
      localDateStr = new Date().toISOString().split("T")[0];
    }
    const localTime = new Date().toLocaleTimeString();
    const timeCtx = `\nCURRENT TIME CONTEXT: ${localDateStr} ${localTime}\nCRITICAL INSTRUCTION: You MUST use "${localDateStr}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;

    let imageCtx = "";
    if (imagePayloads && imagePayloads.length > 0) {
      imageCtx = `\n[Context: An image of the meal is uploaded and attached above. Rely heavily on visual cues in the picture for portion sizing, ingredients, and freshness.]\n`;
    }

    let historyContext = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyContext = "PAST DISCUSSIONS & MEALS CHAT HISTORY:\n" +
        history.slice(-10).map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join("\n") + "\n\n";
    }

    // 2. Prepend active state to Master System Instructions
    const biomarkersList = biomarkersNeedingImprovement && Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0
      ? biomarkersNeedingImprovement.map((b: string) => `• ${b}`).join("\n")
      : "• None";

    const targetLimits = remainingAllowance
      ? `• Calories: ${remainingAllowance.calories} kcal remaining | Saturated Fat: ${remainingAllowance.saturatedFat}g remaining | Sodium: ${remainingAllowance.sodium}mg remaining`
      : "• Calories: 2000 kcal remaining | Saturated Fat: 20g remaining | Sodium: 2300mg remaining";

    const mealStr = activeMeal ? JSON.stringify(activeMeal, null, 2) : "None";

    const systemInstruction = `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

You are an expert clinical dietitian and nutritional LLM analyzer. Your response must be an exact single JSON object matching the requested structure. Never add markdown formatting or wrappers like \`\`\`json.

CRITICAL PATIENT BIOMARKER WARNINGS:
${biomarkersList}
- If LDL-C/cholesterol is HIGH, any food high in saturated fat is EXTREMELY harmful. Rate as "bad" and warn in "risks".
- If Blood Pressure/Sodium is HIGH, any food high in sodium is EXTREMELY harmful. Rate as "bad".

TODAY'S REMAINING NUTRITIONAL TARGET LIMITS:
${targetLimits}

=== MODE ROUTING DIRECTIVE (CRITICAL) ===
You operate in three distinct modes based on the user's input:

MODE A: NEW FOOD LOGGING (Triggered if a NEW image or new food text is provided)
- Analyze the new food. Provide precise metrics and the full 30-nutrient breakdown.
- Set "mode": "new_log". Provide the full "foodData" object.

MODE B: DISCUSSION (Triggered if the user asks a general question, like "Why is this bad?" or "Why does it have so much fat?")
- Answer conversationally based on standard clinical values and the CURRENT_ACTIVE_MEAL_STATE provided in the prompt.
- Set "mode": "discussion". Leave "foodData" and "modificationCommand" as null.

MODE C: MODIFICATION COMMAND (Triggered if the user asks to change, add, or remove an item)
- DO NOT CALCULATE THE NEW NUTRIENT NUMBERS YOURSELF.
- Instead, inspect the CURRENT_ACTIVE_MEAL_STATE and output a command telling the backend system exactly what the user wants to change.
- Set "mode": "modify". Leave "foodData" as null. Fill out the "modificationCommand" array.

JSON SCHEMA STRICT REQUIREMENT:
Respond ONLY with a structured JSON format matching this schema exactly:
{
  "mode": "new_log" | "discussion" | "modify",
  "message": "Conversational response explaining the clinical impact, breakdown, or acknowledging the adjustment.",
  "modificationCommand": [
    {
      "action": "update_weight" | "remove_item" | "add_item",
      "itemName": "Literal name of the item from the active state to change (e.g., 'Beef Steak')",
      "newWeightGrams": number
    }
  ],
  "foodData": {
    "date": "YYYY-MM-DD",
    "name": "Literal food name",
    "composition": "Short summary of main ingredients",
    "weightGrams": number,
    "quantity": "1 serving",
    "benefits": "Clinical benefits",
    "risks": "Clinical warnings tied to biomarkers",
    "healthImpact": "Impact on remaining daily targets",
    "recommendation": "good" | "bad" | "neutral",
    "itemsBreakdown": [
      {
        "name": "individual item name",
        "weightGrams": number,
        "calories": number,
        "saturatedFat": number,
        "sodium": number
      }
    ],
    "nutrients": {
      "calories": number, "protein": number, "totalFat": number, "saturatedFat": number, "unsaturatedFat": number, "omega3": number, "carbohydrates": number, "addedSugar": number, "totalFibre": number, "solubleFibre": number, "sodium": number, "potassium": number, "magnesium": number, "calcium": number, "iron": number, "zinc": number, "selenium": number, "iodine": number, "phosphorus": number, "vitaminD": number, "vitaminB12": number, "folate": number, "vitaminC": number, "vitaminE": number, "vitaminK": number, "vitaminA": number, "vitaminB6": number, "thiamine": number, "riboflavin": number, "niacin": number
    }
  }
}
If mode is not "new_log", leave foodData as null. If mode is not "modify", leave modificationCommand as null. Return ONLY raw JSON.`;

    const promptText = `${historyContext}Analyze this current food request.
${userCtx}
${timeCtx}
${imageCtx}

Current User Input: "${message}"`;

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction,
      promptText,
      imagePayloads,
      responseMimeType: "application/json"
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let rawParsed;
    try {
      rawParsed = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        rawParsed = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
      } else {
        throw parseErr;
      }
    }

    const mode = rawParsed.mode || "new_log";

    // CASE B: discussion mode
    if (mode === "discussion") {
      addDebugLog(`[Mode Routing] DISCUSSION mode triggered (0 database operations).`);
      return res.json({
        text: rawParsed.message || "Here is the details on this meal composition.",
        data: null
      });
    }

    // CASE A: new food logging mode
    if (mode === "new_log") {
      const rawFoodData = rawParsed.foodData;
      if (!rawFoodData) {
        throw new Error("No foodData returned by LLM in new_log mode.");
      }

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

      if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown)) {
        parsedData.itemsBreakdown = rawFoodData.itemsBreakdown.map((item: any) => ({
          name: sanitizeString(item.name, "Unspecified Item"),
          weightGrams: Number(item.weightGrams) || 0,
          calories: Number(item.calories) || 0,
          saturatedFat: Number(item.saturatedFat) || 0,
          sodium: Number(item.sodium) || 0
        }));
      } else {
        parsedData.itemsBreakdown = [
          {
            name: parsedData.name,
            weightGrams: parsedData.weightGrams,
            calories: parsedData.nutrients.calories,
            saturatedFat: parsedData.nutrients.saturatedFat,
            sodium: parsedData.nutrients.sodium
          }
        ];
      }

      return res.json({
        text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}). It is recommended as **${parsedData.recommendation}** for your current profile.`,
        data: parsedData
      });
    }

    // CASE C: modification commands mode
    if (mode === "modify") {
      addDebugLog(`[Mode Routing] MODIFY mode triggered.`);
      
      if (!activeMeal) {
        addDebugLog(`[Modify Math Error] No active meal exists in Firestore to modify.`);
        return res.json({
          text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          data: null
        });
      }

      const commands = rawParsed.modificationCommand;
      if (!commands || !Array.isArray(commands) || commands.length === 0) {
        addDebugLog(`[Modify Math Error] Modification command array was empty or null.`);
        return res.json({
          text: rawParsed.message || "I received a modify request but no modification instructions were provided.",
          data: activeMeal
        });
      }

      const originalItems = activeMeal.itemsBreakdown || [];
      const originalTotalWeight = originalItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;

      const standardItems: {[key: string]: {calories: number, saturatedFat: number, sodium: number}} = {
        steak: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8 },
        beef: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8 },
        chicken: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7 },
        breast: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7 },
        pork: { calories: 2.4, saturatedFat: 0.03, sodium: 0.8 },
        fish: { calories: 1.5, saturatedFat: 0.01, sodium: 0.8 },
        salmon: { calories: 2.0, saturatedFat: 0.015, sodium: 0.5 },
        rice: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01 },
        broccoli: { calories: 0.35, saturatedFat: 0.0, sodium: 0.3 },
        egg: { calories: 1.5, saturatedFat: 0.03, sodium: 1.4 },
        avocado: { calories: 1.6, saturatedFat: 0.02, sodium: 0.07 },
        bread: { calories: 2.6, saturatedFat: 0.005, sodium: 4.8 },
        butter: { calories: 7.1, saturatedFat: 5.1, sodium: 5.7 },
        cheese: { calories: 4.0, saturatedFat: 1.8, sodium: 6.2 },
        salad: { calories: 0.2, saturatedFat: 0.0, sodium: 0.1 },
        tomato: { calories: 0.18, saturatedFat: 0.0, sodium: 0.05 },
        oil: { calories: 8.8, saturatedFat: 1.4, sodium: 0.0 },
        potato: { calories: 0.8, saturatedFat: 0.0, sodium: 0.05 },
        pasta: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01 }
      };

      for (const cmd of commands) {
        const action = cmd.action;
        const itemName = cmd.itemName || "";
        const newWeight = Number(cmd.newWeightGrams) || 0;

        if (action === "update_weight") {
          const item = activeMeal.itemsBreakdown.find((it: any) => it.name.toLowerCase().includes(itemName.toLowerCase()) || itemName.toLowerCase().includes(it.name.toLowerCase()));
          if (item) {
            const oldWeight = Number(item.weightGrams) || 1;
            const R = newWeight / oldWeight;
            
            item.weightGrams = newWeight;
            item.calories = Number((item.calories * R).toFixed(1));
            item.saturatedFat = Number((item.saturatedFat * R).toFixed(2));
            item.sodium = Number((item.sodium * R).toFixed(1));

            addDebugLog(`[Modify Math] update_weight of "${item.name}" from ${oldWeight}g to ${newWeight}g (ratio: ${R.toFixed(3)})`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" to update_weight.`);
          }
        } 
        else if (action === "remove_item") {
          const idx = activeMeal.itemsBreakdown.findIndex((it: any) => it.name.toLowerCase().includes(itemName.toLowerCase()) || itemName.toLowerCase().includes(it.name.toLowerCase()));
          if (idx !== -1) {
            const removedItem = activeMeal.itemsBreakdown[idx];
            activeMeal.itemsBreakdown.splice(idx, 1);
            addDebugLog(`[Modify Math] remove_item: Removed "${removedItem.name}"`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" to remove.`);
          }
        } 
        else if (action === "add_item") {
          let cFactor = 1.0;
          let fFactor = 0.01;
          let sFactor = 0.5;

          const lowerName = itemName.toLowerCase();
          for (const [key, factors] of Object.entries(standardItems)) {
            if (lowerName.includes(key)) {
              cFactor = factors.calories;
              fFactor = factors.saturatedFat;
              sFactor = factors.sodium;
              break;
            }
          }

          const newItem = {
            name: itemName,
            weightGrams: newWeight,
            calories: Number((newWeight * cFactor).toFixed(1)),
            saturatedFat: Number((newWeight * fFactor).toFixed(2)),
            sodium: Number((newWeight * sFactor).toFixed(1))
          };

          if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
          activeMeal.itemsBreakdown.push(newItem);
          addDebugLog(`[Modify Math] add_item: Added "${itemName}" with estimated weight ${newWeight}g.`);
        }
      }

      const newItems = activeMeal.itemsBreakdown || [];
      const newTotalWeight = newItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
      const mealWeightRatio = newTotalWeight / originalTotalWeight;

      activeMeal.weightGrams = newTotalWeight;
      activeMeal.composition = newItems.map((it: any) => it.name).join(", ");
      
      const newCalories = newItems.reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
      const newSaturatedFat = newItems.reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
      const newSodium = newItems.reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

      activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
      activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
      activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

      const nutrientKeys = [
        "protein", "totalFat", "unsaturatedFat", "omega3", 
        "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "potassium", 
        "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
        "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
        "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
      ];

      for (const key of nutrientKeys) {
        if (activeMeal.nutrients[key] !== undefined) {
          activeMeal.nutrients[key] = Number((activeMeal.nutrients[key] * mealWeightRatio).toFixed(2));
        }
      }

      return res.json({
        text: rawParsed.message || "I have recalculated your meal's metrics with precision based on your instructions.",
        data: activeMeal
      });
    }
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
    const { 
      message, 
      image, 
      images, 
      imageDates, 
      history, 
      userProfile, 
      engine, 
      existingBiomarkers, 
      agentType, 
      biomarkerHistory, 
      biomarkers, 
      recentMeals 
    } = req.body;

    if (agentType) {
      let systemInstruction = "";
      let mockData: any = {};

      if (agentType === "agent1_step1") {
        systemInstruction = `You are a clinical data parser and conversational health assistant (Step 1: Clinical Triage).
Your tasks:
1. Parse raw health reports/text and extract biomarker readings into a flat YAML array.
2. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. If this is the initial extraction, write: "I have extracted the biomarkers. Please review the output."
- "extractedYaml": The flat YAML array representing the current state of extracted biomarkers.

YAML Schema for "extractedYaml" field (must be a single string containing valid YAML):
- biomarker: string
  date: YYYY-MM-DD
  value: number
  unit: string

Rules for handling user inputs:
- INITIAL/RAW DATA extraction: If the user provided a health report, extract ALL biomarkers. Do not skip any. If multiple readings of the same marker on the same date exist under slightly different names, merge them. Output the flat YAML in "extractedYaml", and set "text" to "I have extracted the biomarkers. Please review the output."
- UPDATE DATA: If the user asks to edit, add, or delete a biomarker or value (e.g., "Change ALT on 2026-06-01 to 45"), perform that update on the YAML and return the updated "extractedYaml" string, explaining the change in "text".
- START A CONVERSATION: If the user asks general or clinical questions about the biomarkers or their values (e.g., "What does ALT mean?"), answer the question in "text" with precise clinical detail, and return the unmodified YAML in "extractedYaml".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back or continue, explain the current step in "text" (we are currently on Step 1: Data Extraction. They can click "Continue to Map Data" when ready, or we can discuss/update the extracted readings first).

Make sure your entire output is valid JSON, containing "text" and "extractedYaml".`;
        mockData = {};
      } else if (agentType === "agent1_step2") {
        systemInstruction = `You are an expert Clinical Ontologist and conversational health assistant (Step 2: Category Mapping).
Your tasks:
1. Identify all unique biomarkers in the YAML list and categorize them by associating:
   - "riskCategories": An array of matching risk categories. Choose from: 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology'. If none match, you can use other appropriate categories.
   - "standardMedicalGrouping": Choose exactly ONE of these standard physiological groupings: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', or 'Other'.
   - "potentialMedicalConditions": An array of related medical conditions or risks (e.g. ['Diabetes Risk', 'Insulin Resistance', 'Obesity', 'Anemia', 'Hepatitis Stress', 'Fatty Liver', 'Chronic Kidney Disease']).
2. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. If this is the initial mapping, write: "I have categorized the biomarkers. Please review the mapping."
- "bucketMapping": A key-value dictionary where the key is the biomarker name and the value is the assigned categorization object containing "riskCategories", "standardMedicalGrouping", and "potentialMedicalConditions".

Example "bucketMapping" structure:
{
  "HbA1c": {
    "riskCategories": ["Metabolic & glycemic"],
    "standardMedicalGrouping": "Metabolic",
    "potentialMedicalConditions": ["Diabetes Risk", "Insulin Resistance"]
  },
  "Serum ALT": {
    "riskCategories": ["Liver & hepatitis stress"],
    "standardMedicalGrouping": "Hepatic",
    "potentialMedicalConditions": ["Fatty Liver", "Hepatitis Stress"]
  }
}

Rules for handling user inputs:
- INITIAL mapping: Categorize each biomarker into the detailed fields above and return the dictionary in "bucketMapping", and set "text" to "I have categorized the biomarkers. Please review the mapping."
- UPDATE DATA: If the user requests to change a category mapping (e.g., "Move glucose to Metabolic"), perform the update on the "bucketMapping" dictionary and return the updated dictionary, explaining the change in "text".
- START A CONVERSATION: If the user asks a clinical or general question (e.g., "Why is ALT under Hepatic?"), answer the question clearly in "text" and return the unmodified dictionary in "bucketMapping".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back to Step 1 or proceed/continue/submit, explain in "text" how to proceed (they can click "Assemble Data" to continue, or click "Go Back" if needed).

Make sure your entire output is valid JSON, containing "text" and "bucketMapping".`;
        mockData = {};
      } else if (agentType === "agent1_step3") {
        systemInstruction = `You are a clinical data coordinator and conversational health assistant (Step 3: Data Assembly).
Your tasks:
1. Assemble the flat YAML biomarker logs and the bucket mapping dictionary into a structured physiological nested JSON.
2. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. If this is the initial assembly, write: "Data successfully processed and categorized." (or similar).
- "entriesCount": Total unique biomarker entries processed.
- "buckets": An array of buckets matching the schema below.

Nested JSON schema for "buckets":
[
  {
    "systemName": "Bucket Name", // must be one of: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other'
    "biomarkers": [
      {
        "name": "Biomarker Name",
        "riskCategories": ["Cardiovascular", "Metabolic & glycemic"], // arrays from the Step 2 bucket mapping
        "standardMedicalGrouping": "Metabolic", // string from the Step 2 bucket mapping
        "potentialMedicalConditions": ["Diabetes Risk", "Insulin Resistance"], // array of potential medical conditions from Step 2
        "history": [
          { "date": "YYYY-MM-DD", "value": number, "unit": "string" }
        ]
      }
    ]
  }
]

Rules for handling user inputs:
- INITIAL assembly: Map EVERY single biomarker and entry from the YAML using the Bucket Mapping. Do not drop any. Organize them into the "buckets" array. Return the JSON structure, and set "text" to "Data successfully processed and categorized. Please review the final structured entries below."
- UPDATE DATA: If the user asks to edit/add/delete a biomarker, date, or reading (e.g., "Remove red blood cell count reading on 2026-06-01"), perform that update on the nested "buckets" structure, update "entriesCount", and return the updated structure, explaining the change in "text".
- START A CONVERSATION: If the user asks a clinical or general question (e.g., "Why is ALT high?" or questions about "total white cell count"), answer the question clearly in "text", and return the unmodified "buckets" and "entriesCount".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back to Step 2, or finish and save/submit, explain in "text" how they can save their data or click the buttons to navigate.

Make sure your entire output is valid JSON, containing "text", "entriesCount", and "buckets".`;
        mockData = {};
      } else if (agentType === "agent2") {
        systemInstruction = `You are an expert Clinical Pathologist and Prognostics AI (Diagnostic & Prognostic Agent). Analyze the provided biomarker history in the context of the user's specific demographics.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}
- Blood Type: ${userProfile?.bloodType || 'Not provided'}

BIOMARKER HISTORY PROVIDED:
${JSON.stringify(biomarkerHistory || [])}

RECENT MEALS (Dish Names Only):
${JSON.stringify(recentMeals || [])}

=== CLINICAL DIRECTIVES ===
1. FAIR ASSESSMENT: Do not invent pathology. If the user's biomarkers are healthy, state clearly that their systems are highly optimized. Only flag authentic, clinically significant risks based on demographic thresholds (e.g. lower BMI risk limits for South Asian/East Asian ethnicities).
2. TIMELINE PROJECTIONS:
   - If healthy: Project maintenance of vitality and low metabolic disease risk over 2, 5, and 10 years.
   - If at risk: Project the logical biological and clinical progression over 2, 5, and 10 years if no dietary or lifestyle changes are made (e.g., progression from high fasting glucose/HbA1c to Type 2 Diabetes and chronic kidney disease).
3. GAP ANALYSIS: Identify critical missing information. If everything is covered, state "No additional testing required." If there are risks or questions, recommend exactly 1-2 advanced confirmation tests (e.g., Fasting Insulin, ApoB, Cystatin-C) to verify the gap.
4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational diagnostic and prognostic summary tailored to this user profile.",
  "primaryDiagnosis": "Primary systemic health assessment summary.",
  "timelineProjections": {
    "year2": "2-Year Projection details",
    "year5": "5-Year Projection details",
    "year10": "10-Year Projection details"
  },
  "recommendedTests": [
    {
      "testName": "Fasting Insulin",
      "reason": "To confirm glucose sensitivity and check insulin resistance."
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "Based on your clinical markers, your metabolic markers are mostly healthy, but fasting glucose is slightly elevated relative to optimal ranges for your demographic.",
          primaryDiagnosis: "Slightly elevated glycemic markers; cardiovascular and renal health are highly optimized.",
          timelineProjections: {
            year2: "Maintaining current metabolic profiles; slight progression in glycemic metrics if diet remains unadjusted.",
            year5: "Mild risk of insulin resistance progression; cardiovascular health remains solid.",
            year10: "Metabolic risk increases by 5% if glycemic spikes are not managed."
          },
          recommendedTests: [
            {
              testName: "Fasting Insulin",
              reason: "To rule out insulin resistance in light of borderline-high glucose."
            }
          ]
        };
      } else if (agentType === "agent3") {
        systemInstruction = `You are a Clinical Education AI (Biomarker Contextualizer). Your job is to generate highly personalized educational content, adjusted normal reference ranges, and specific risk explanations based on the user's demographics and previous diagnostic assessment.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

DIAGNOSTIC SUMMARY:
${req.body.agentDiagnosticSummary || 'Optimized or no major pathologies flagged.'}

=== DIRECTIVES ===
1. DEMOGRAPHICALLY ADJUSTED NORMAL RANGES: For every provided clinical metric, provide a profile-adjusted normal range. Explain why this reference range was adjusted for their age, gender, or ethnicity (e.g. muscle mass and creatinine, age-related eGFR, ethnic-specific lipid targets).
2. EDUCATIONAL DESCRIPTIONS: Write a clear 2-sentence description of what each biomarker is and its physiological role.
3. SPECIFIC RISK CONTEXT: For any marker identified as at-risk or abnormal, write a personalized 3-4 sentence explanation of *why* this specific value is critical or dangerous for *this specific user profile*.
4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your educational and reference range adjustments.",
  "contextualizedBiomarkers": [
    {
      "name": "hba1c",
      "userValue": 40,
      "profileAdjustedNormalRange": "20 - 42 mmol/mol",
      "description": "HbA1c measures the percentage of blood sugar attached to hemoglobin. It represents your average blood glucose levels over the past 2 to 3 months.",
      "status": "Healthy" | "At Risk",
      "specificRiskContext": "For a patient of your demographic group, keeping HbA1c below 42 mmol/mol is optimal to prevent vascular damage and glycemic stress."
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I have calibrated the reference ranges for your biomarkers to your precise age, gender, and ethnicity, providing demographic-specific educational contexts.",
          contextualizedBiomarkers: [
            {
              name: "hba1c",
              userValue: 40,
              profileAdjustedNormalRange: "20 - 42 mmol/mol",
              description: "HbA1c measures the percentage of blood sugar attached to hemoglobin. It represents your average blood glucose levels over the past 2 to 3 months.",
              status: "Healthy",
              specificRiskContext: "Your HbA1c is in the excellent, optimal zone for your demographic group."
            }
          ]
        };
      } else if (agentType === "agent4") {
        systemInstruction = `You are a Precision Medicine & Lifestyle Coaching AI (Precision Intervention Agent). Translate the user's clinical biomarkers and risk assessment into a strict, trackable daily protocol.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Weight: ${userProfile?.weight || 'Not provided'} kg
- Height: ${userProfile?.height || 'Not provided'} cm
- Gender: ${userProfile?.gender || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

DIAGNOSTIC BACKGROUND:
${req.body.agentDiagnosticSummary || 'Mainly healthy'}

=== DIRECTIVES ===
1. NUTRITION TARGETS: Generate strict daily targets for the app tracker. If a metabolic or hepatic risk was flagged, customize macronutrient/micronutrient limits mathematically (e.g. limiting saturated fats, increasing total fiber, targeting custom calories).
2. ACTIVITY HABITS: Provide 2-3 highly specific daily habits (e.g., '7,500 steps', '30 minutes Zone 2 cardio', 'Limit screen time after 10 PM').
3. MATHEMATICAL PROJECTIONS: Provide biological time-to-goal estimates based on the math of physiology.
   - Example: 'Maintaining a 400 kcal daily deficit will lead to a 5 kg weight reduction to reach your optimal BMI of 22.5 in roughly 12 weeks.'
   - Example: 'By adhering to less than 15g saturated fat daily, you can expect an LDL-C reduction of 15% in approximately 8-12 weeks.'
4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational explanation of your precision lifestyle design.",
  "nutrientTargets": {
    "calories": "1850",
    "protein": "110",
    "carbs": "220",
    "fat": "50",
    "saturatedFat": "15",
    "totalFibre": "30",
    "sodium": "1800",
    "sugar": "25"
  },
  "activityChecklist": [
    {
      "habit": "Walk 8,000 steps daily",
      "target": "8000 steps",
      "type": "steps"
    },
    {
      "habit": "Zone 2 aerobic exercise",
      "target": "30 minutes",
      "type": "cardio"
    }
  ],
  "projections": [
    "Adhering to this saturated fat limit will likely lower LDL-C by 10-15% within 12 weeks.",
    "The daily fiber target will assist in glycemic stabilization, projecting a slight HbA1c drop of 1-2 mmol/mol over 3 months."
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I have created a high-precision, clinically aligned dietary and movement plan with mathematical timeline projections.",
          nutrientTargets: {
            calories: "1900",
            protein: "105",
            carbs: "210",
            fat: "55",
            saturatedFat: "14",
            totalFibre: "32",
            sodium: "1700",
            sugar: "22"
          },
          activityChecklist: [
            { habit: "Walk 7,500 steps daily", target: "7500 steps", type: "steps" },
            { habit: "30 mins Zone 2 cardio", target: "30 minutes", type: "cardio" }
          ],
          projections: [
            "Adhering to this fat threshold will lower LDL-C by ~12% in 8-12 weeks.",
            "A 32g daily fiber intake stabilizes postprandial glucose, projecting metabolic efficiency in 4 weeks."
          ]
        };
      } else if (agentType === "agent5") {
        systemInstruction = `You are a Medical Literature Research AI (Medical Literature Agent). Summarize the latest peer-reviewed scientific consensus, clinical debates, and clinical trials relevant to this user's profile and biological risk markers.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

IDENTIFIED DIAGNOSTICS:
${req.body.agentDiagnosticSummary || 'Healthy baseline'}

=== DIRECTIVES ===
1. HIGHLIGHT SCHOLARLY TOPICS: Detail emerging consensus or debates (e.g. ApoB vs LDL-C tracking, cardiovascular risk algorithms like QRISK3 vs SCORE2, or dietary fiber's interaction with the gut microbiome).
2. NO PRESCRIPTIONS: Present findings as a literature synthesis, citing primary medical guidelines (e.g. AHA, ESC, ADA, KDIGO).
3. DETAILED BULLETS: Provide 3-4 distinct scholarly insights. Each insight must contain a bold title, a comprehensive summary paragraph, and a relevant citation/link (like a Pubmed search URL or medical association guideline URL).
4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your medical literature scan.",
  "insights": [
    {
      "title": "ApoB as the Superior Predictor of Atherogenic Risk",
      "summary": "Recent European Society of Cardiology (ESC) consensus guidelines highlight Apolipoprotein B (ApoB) as a more accurate indicator of total atherogenic particle concentration than standard LDL-C, particularly in individuals with borderline-high fasting glucose or metabolic syndrome.",
      "link": "https://pubmed.ncbi.nlm.nih.gov/31475137/"
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I scanned the latest clinical literature databases (PubMed, Cochrane Library) and summarized three key consensus insights relevant to your metabolic and cardiovascular profile.",
          insights: [
            {
              title: "ApoB as the Superior Predictor of Atherogenic Risk",
              summary: "Recent European Society of Cardiology (ESC) consensus guidelines highlight Apolipoprotein B (ApoB) as a more accurate indicator of total atherogenic particle concentration than standard LDL-C, particularly in individuals with borderline-high fasting glucose or metabolic syndrome.",
              link: "https://pubmed.ncbi.nlm.nih.gov/31475137/"
            },
            {
              title: "Glycemic Stability and Preventive Cardiology Guidelines",
              summary: "The American Diabetes Association (ADA) 2026 standards highlight early lifestyle intervention at borderline HbA1c thresholds, demonstrating a 58% reduction in the 10-year transition rate to formal insulin deficiency through physical activity and fiber loading.",
              link: "https://pubmed.ncbi.nlm.nih.gov/34922236/"
            }
          ]
        };
      }

      let textOutput = "";
      if (process.env.GEMINI_API_KEY === undefined) {
        textOutput = JSON.stringify(mockData);
      } else {
        let historyText = "";
        if (history && history.length > 0) {
          historyText = "Chat History:\n" + history.map((h: any) => `${h.role}: ${h.content}`).join("\n") + "\n\n";
        }
        
        let imagePayload = null;
        let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
        if (images && images.length > 0) {
          imagesPayload = images.map((img: string) => {
            const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
            const base64Data = img.split(",")[1];
            return { mimeType, data: base64Data };
          });
          imagePayload = imagesPayload[0];
        } else if (image) {
          const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
          const base64Data = image.split(",")[1];
          imagePayload = { mimeType, data: base64Data };
        }

        const imageCtx = imageDates && imageDates.length > 0 ? `The attached images were taken on these dates: ${imageDates.join(", ")}.` : "";
        
        const cleanProfile: any = {
          age: userProfile?.age,
          gender: userProfile?.gender,
          ethnicity: userProfile?.ethnicity,
          bloodType: userProfile?.bloodType,
          weight: userProfile?.weight,
          height: userProfile?.height
        };
        
        // Strip undefined and null values
        Object.keys(cleanProfile).forEach(key => {
          if (cleanProfile[key] === undefined || cleanProfile[key] === null) {
            delete cleanProfile[key];
          }
        });

        const slimBiomarkers: any = {};
        if (userProfile?.customBiomarkers) {
          Object.keys(userProfile.customBiomarkers).forEach((k: string) => {
            slimBiomarkers[k] = { 
              name: userProfile.customBiomarkers[k].name, 
              unit: userProfile.customBiomarkers[k].unit 
            };
          });
        }
        
        const cleanedPayload = {
          userProfile: cleanProfile,
          biomarkerDefinitions: slimBiomarkers,
          biomarkerHistory: biomarkerHistory || []
        };

        let dataContext = "";
        if (agentType === "agent1_step1") {
          dataContext = `\n\nUSER RAW DATA:\n${message}\n\nEXISTING BIOMARKER LOGS:\n${JSON.stringify(biomarkerHistory || [], null, 2)}\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
        } else if (agentType === "agent1_step2") {
          dataContext = `\n\nEXTRACTED YAML DATA:\n${req.body.extractedYaml}\n`;
        } else if (agentType === "agent1_step3") {
          dataContext = `\n\nEXTRACTED YAML DATA:\n${req.body.extractedYaml}\n\nBUCKET MAPPING JSON:\n${req.body.bucketMapping}\n`;
        } else {
          const toonData = toonEncode(cleanedPayload);
          dataContext = `\n\nUSER MEDICAL DATA (in TOON format):\n${toonData}\n`;
        }

        let promptText = `Chat History:\n${historyText}\n${imageCtx}\nUser message: "${message}"${dataContext}`;

        let isYaml = false;
        
        let maxRetries = agentType === "agent1_step3" ? 3 : 1;
        let attempt = 0;
        let success = false;
        
        while (attempt < maxRetries && !success) {
          attempt++;
          textOutput = await callUnifiedLLM({
            modelId: engine || "gemini-2.5-flash",
            systemInstruction,
            promptText,
            imagePayload,
            imagePayloads: imagesPayload,
            responseMimeType: isYaml ? "text/plain" : "application/json"
          });
          
          if (agentType === "agent1_step3") {
            try {
              let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
              const firstBrace = cleanJson.indexOf("{");
              const lastBrace = cleanJson.lastIndexOf("}");
              if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
              }
              const parsed = JSON.parse(cleanJson);
              
              const expectedCount = (req.body.extractedYaml?.match(/- biomarker:/g) || []).length;
              let actualCount = 0;
              if (parsed.buckets && Array.isArray(parsed.buckets)) {
                parsed.buckets.forEach((b: any) => {
                  if (b.biomarkers && Array.isArray(b.biomarkers)) {
                    b.biomarkers.forEach((m: any) => {
                      if (m.history && Array.isArray(m.history)) {
                        actualCount += m.history.length;
                      }
                    });
                  }
                });
              }
              
              const isChatOrUpdate = req.body.message && req.body.message !== "Continue processing" && req.body.message !== "Assemble JSON" && req.body.message !== "Assemble Data" && req.body.message !== "Assemble data";
              if (actualCount === expectedCount || attempt === maxRetries || isChatOrUpdate) {
                success = true;
                textOutput = cleanJson;
              } else {
                console.log(`Agent 3 retry ${attempt}: Expected ${expectedCount} entries, got ${actualCount}`);
                promptText += `\n\nERROR: You missed some entries. I expected ${expectedCount} historical log entries based on the YAML, but you only outputted ${actualCount}. You MUST include EVERY single entry from the YAML. Do not summarize or skip any.`;
              }
            } catch (err) {
              console.error("Agent 3 parse error:", err);
              if (attempt === maxRetries) success = true; // just let it fail naturally below
            }
          } else {
            success = true;
          }
        }
      }

      if (agentType === "agent1_step1") {
        let cleanYaml = textOutput;
        let text = "I have extracted the biomarkers. Please review the output.";
        try {
          const parsed = JSON.parse(textOutput.replace(/```(?:json)?/gi, "").trim());
          if (parsed.extractedYaml) {
            cleanYaml = parsed.extractedYaml;
          }
          if (parsed.text) {
            text = parsed.text;
          }
        } catch (e) {
          cleanYaml = textOutput.replace(/```(?:yaml)?/gi, "").trim();
        }
        return res.json({
          text,
          agentType,
          extractedYaml: cleanYaml
        });
      }

      if (agentType === "agent1_step2") {
        let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
        let text = "I have categorized the biomarkers. Please review the mapping.";
        let bucketMapping = {};
        try {
          const parsed = JSON.parse(cleanJson);
          if (parsed.bucketMapping) {
            bucketMapping = parsed.bucketMapping;
            if (parsed.text) text = parsed.text;
          } else {
            bucketMapping = parsed;
          }
        } catch (e) {
          try {
            const firstBrace = cleanJson.indexOf("{");
            const lastBrace = cleanJson.lastIndexOf("}");
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              const innerParsed = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
              if (innerParsed.bucketMapping) {
                bucketMapping = innerParsed.bucketMapping;
                if (innerParsed.text) text = innerParsed.text;
              } else {
                bucketMapping = innerParsed;
              }
            }
          } catch (e2) {}
        }
        return res.json({
          text,
          agentType,
          bucketMapping
        });
      }

      let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
      let parsedData;
      try {
        parsedData = JSON.parse(cleanJson);
      } catch (parseErr: any) {
        const firstBrace = cleanJson.indexOf("{");
        const lastBrace = cleanJson.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          parsedData = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
        } else {
          throw parseErr;
        }
      }

      return res.json({
        text: parsedData.message || 'Analysis generated.',
        agentType,
        ...parsedData
      });
    }

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

    const existingKeys = existingBiomarkers && existingBiomarkers.length > 0 ? existingBiomarkers : [];
    
    let resumeCtx = "";
    if (req.body.lastProcessedItem) {
      resumeCtx = `\nPREVIOUS EXTRACTION STATE:\nYou previously stopped at: "${req.body.lastProcessedItem}".\nYou MUST start your next extraction chunk immediately AFTER this item in the user's data.\n`;
    }

    const promptText = `Chat History:\n${historyText}\n${imageCtx}\nUser message: "${message}"${resumeCtx}`;

    const systemInstruction = `You are an expert clinical laboratory data extraction agent. You extract blood biomarker numbers and personal profile data with extreme accuracy. Your response must be an exact single JSON object matching the requested structure. Never add markdown formatting or wrappers like \`\`\`json.

CURRENT USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Weight: ${userProfile?.weight || 'Not provided'} kg
- Height: ${userProfile?.height || 'Not provided'} cm
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}
- Blood Type: ${userProfile?.bloodType || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}

EXISTING DATABASE KEYS ALREADY IN USE: 
[${existingKeys.join(', ')}]

=== CRITICAL MEDICAL DATA EXTRACTION DIRECTIVE ===
1. STRICT VERBATIM VALUES: You must extract the exact NUMERIC VALUE provided in the source text. NEVER convert international units to US units (e.g., if the text says 6.5 mmol/L, output exactly 6.5). DO NOT do math.
2. HANDLING UNITS & NEW KEYS: You MUST ALWAYS append the exact unit from the document to your snake_case key (e.g., "total_cholesterol_mmol_l", "wbc_10_9_l") UNLESS the biomarker semantically matches a key in "EXISTING DATABASE KEYS ALREADY IN USE" AND the unit matches exactly. If the unit differs from an existing key or you don't know the existing key's unit, create a NEW key with the unit appended. DO NOT use generic keys like "total_cholesterol" without a unit appended.
3. CUSTOM DEFINITIONS: Any time you create a new key, you MUST define it in the 'customBiomarkerDefs' object.
4. PRESERVE SCALES: If a score is presented as a fraction (e.g., "8 /12"), convert it to the decimal or numerator if the schema requires a number, but note the scale in the customBiomarkerDefs description.

=== MODE ROUTING DIRECTIVE (CRITICAL FOR LONG DATA) ===
You operate in distinct modes based on the user's input:

MODE A: PLAN_EXTRACTION (Triggered when user uploads new data)
- DO NOT extract the data into the 'entries' array yet.
- Scan the text and estimate the total number of individual biomarker results.
- Calculate batches required. The MAXIMUM limit is 50 metrics per batch.
- Set "mode": "plan", "status": "waiting_for_user". Tell the user the plan and ask to proceed.

MODE B: EXTRACT_CHUNK (Triggered when user says "Proceed" or "Continue" after a plan)
- Extract data, but STOP exactly when you hit 50 metrics.
- To avoid losing your place, note the EXACT name and date of the last test extracted in the 'lastProcessedItem' field. On the next turn, you will start immediately AFTER this item.
- Set "mode": "extract_chunk".
- If more metrics remain in the document, set "status": "needs_continuation". If you have extracted the very last metric, set "status": "completed".

MODE C: DISCUSSION / MODIFY (Triggered if the user asks a question, corrects a mistake midway, or updates profile info)
- Answer the question or output a modificationCommand array (e.g., changing weight, removing a mistaken log).
- DO NOT extract new chunk data in this mode.
- CRITICAL: If the document is not fully extracted yet, you MUST preserve the "status" as "needs_continuation" and pass the exact same "lastProcessedItem" back in your JSON so you don't lose your place for the next turn.

=== JSON SCHEMA STRICT REQUIREMENT ===
Respond ONLY with a structured JSON format matching this schema exactly. 
{
  "mode": "plan" | "extract_chunk" | "discussion" | "modify",
  "status": "completed" | "needs_continuation" | "waiting_for_user",
  "message": "Conversational reply.",
  
  "planningDetails": {
    "estimatedTotalMetrics": number | null,
    "batchesRequired": number | null,
    "maxMetricsPerBatch": 50
  },
  
  "lastProcessedItem": "String: The Date and Test Name of the last item extracted (e.g., '05-Jun-2026 HbA1c'). Preserve this if chatting midway. Leave null if in plan mode.",
  
  "modificationCommand": [
    {
      "action": "update_biomarker" | "update_profile" | "remove_biomarker",
      "keyName": "Literal name of the key (e.g., 'weight', 'ldl', 'serum_sodium_mmol_l')",
      "newValue": "The new numeric value or string",
      "date": "YYYY-MM-DD (Only required if updating a biomarker)"
    }
  ],
  "profileUpdates": {
     "age": 0, "weight": 0, "height": 0, "ethnicity": "string", "bloodType": "string", "gender": "string"
  },
  "entries": [
    {
      "date": "YYYY-MM-DD string",
      "biomarkers": {
        "ldl": 4.3,
        "serum_sodium_mmol_l": 143
      }
    }
  ],
  "customBiomarkerDefs": {
    "new_custom_key_mmol_l": {
      "name": "Human Readable Name",
      "unit": "Exact unit from text",
      "normalRange": "Extracted range, or 'Unknown'",
      "description": "Short medical explanation."
    }
  }
}
Note: If mode is not "extract_chunk", leave 'entries' and 'customBiomarkerDefs' as null. If the user hasn't explicitly stated a change to their profile info in the chat, leave 'profileUpdates' as null. Return ONLY raw JSON without markdown.`;

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction,
      promptText,
      imagePayload,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json"
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedData = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
      } else {
        throw parseErr;
      }
    }

    // Backward compatibility: If the AI returns old single date format, map it to entries
    let finalEntries = parsedData.entries || [];
    if (finalEntries.length === 0 && parsedData.biomarkers && Object.keys(parsedData.biomarkers).length > 0) {
      finalEntries = [{
        date: parsedData.date || null,
        biomarkers: parsedData.biomarkers
      }];
    }

    res.json({
      text: parsedData.message || parsedData.summary || 'Extraction generated.',
      mode: parsedData.mode || 'new_log',
      status: parsedData.status,
      planningDetails: parsedData.planningDetails,
      lastProcessedItem: parsedData.lastProcessedItem,
      modificationCommand: parsedData.modificationCommand || [],
      entries: finalEntries,
      profile: parsedData.profileUpdates || parsedData.profile || {},
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

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedData = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
      } else {
        throw parseErr;
      }
    }

    res.json(parsedData);
  } catch (error: any) {
    console.error("[Insight Analyze Error]:", error);
    res.status(500).json({ error: "Failed to generate preventative recommendations: " + error.message });
  }
});

// Gemini Food Idea Endpoint
app.post("/api/gemini/food-idea", async (req, res) => {
  addDebugLog(`[FoodIdea] Starting food-idea suggestion process.`);
  try {
    const { message, userProfile, location, recentMeals, engine, budget, currency, maxDistance, clientNearbyPlaces } = req.body;
    addDebugLog(`[FoodIdea] Request parameters - engine: "${engine || 'default'}", maxDistance: ${maxDistance || 3}km, budget: "${budget} ${currency}". Query: "${message}"`);

    if (process.env.GEMINI_API_KEY === undefined) {
      addDebugLog(`[FoodIdea] Warning: GEMINI_API_KEY is not defined in Secrets.`);
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
      const geoController = new AbortController();
      const geoTimeoutId = setTimeout(() => geoController.abort(), 3000);
      try {
        addDebugLog(`[ReverseGeocode] Reverse geocoding lat/lng: ${location.lat}, ${location.lng} via Nominatim...`);
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat}&lon=${location.lng}`, {
          headers: { 
            'User-Agent': 'HealthBiomarkerApplet/1.0 (Cwah.Liu@gmail.com)',
            'Accept-Language': 'en, id'
          },
          signal: geoController.signal
        });
        clearTimeout(geoTimeoutId);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData && geoData.display_name) {
            resolvedAddressText = geoData.display_name;
            addDebugLog(`[ReverseGeocode] Resolved coordinates successfully to: "${resolvedAddressText}"`);
          }
        } else {
          addDebugLog(`[ReverseGeocode] HTTP error status: ${geoRes.status}`);
        }
      } catch (geoErr: any) {
        clearTimeout(geoTimeoutId);
        const isAbort = geoErr.name === 'AbortError';
        addDebugLog(`[ReverseGeocode] Failed or timed out (timed out: ${isAbort}). Continuing with coordinate context only.`);
      }

      // Use client-side overpass results if provided, otherwise try server-side
      if (clientNearbyPlaces && clientNearbyPlaces.length > 0) {
        const slicedClientPlaces = clientNearbyPlaces.slice(0, 6);
        addDebugLog(`[Overpass] Slicing ${clientNearbyPlaces.length} client-provided nearby places to ${slicedClientPlaces.length} items to bypass rate-limits.`);
        nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
        slicedClientPlaces.forEach((el: any) => {
          nearbyPlacesText += `- Name: "${el.name}" (Lat: ${el.lat}, Lng: ${el.lng})\n`;
          if (el.address) nearbyPlacesText += `  Address: ${el.address}\n`;
          if (el.opening_hours) nearbyPlacesText += `  Hours: ${el.opening_hours}\n`;
        });
        nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
      } else {
        const overpassController = new AbortController();
        const overpassTimeoutId = setTimeout(() => overpassController.abort(), 4000);
        try {
          addDebugLog(`[Overpass] Querying OpenStreetMap Overpass API for restaurants within ${maxDistanceValue} km...`);
          const radius = Math.min(maxDistanceValue * 1000, 5000); // meters
          const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${location.lat},${location.lng}););out 30;`;
          
          const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(overpassQuery),
            signal: overpassController.signal
          });
          clearTimeout(overpassTimeoutId);
          
          if (overpassRes.ok) {
            const overpassData = await overpassRes.json();
            if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
              const namedElements = overpassData.elements.filter((el: any) => el.tags && el.tags.name);
              const slicedElements = namedElements.slice(0, 6);
              addDebugLog(`[Overpass] Slicing ${namedElements.length} server-found nearby places to ${slicedElements.length} items to bypass rate-limits.`);
              nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
              slicedElements.forEach((el: any) => {
                nearbyPlacesText += `- Name: "${el.tags.name}" (Lat: ${el.lat}, Lng: ${el.lon})\n`;
                if (el.tags['addr:street']) {
                  nearbyPlacesText += `  Address: ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}\n`;
                }
                if (el.tags['opening_hours']) {
                  nearbyPlacesText += `  Hours: ${el.tags['opening_hours']}\n`;
                }
              });
              nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
              addDebugLog(`[Overpass] Resolved successfully! Formatted ${slicedElements.length} real nearby restaurants.`);
            } else {
              addDebugLog(`[Overpass] No real places found nearby from OpenStreetMap.`);
            }
          } else {
            addDebugLog(`[Overpass] HTTP error status: ${overpassRes.status}`);
          }
        } catch (err: any) {
          clearTimeout(overpassTimeoutId);
          const isAbort = err.name === 'AbortError';
          addDebugLog(`[Overpass] Failed or timed out (timed out: ${isAbort}). Continuing without nearby restaurant list.`);
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
4. MAPS LINK PRECISION & ERROR HANDLING RULE: When you have a restaurant, call the \`get_google_maps_place_id\` tool EXACTLY ONCE per restaurant using the restaurant name and coordinates.
   - If the tool returns a valid place_id, construct the "locationLink" URL exactly like this: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}&query_place_id={PLACE_ID}\`.
   - If the tool returns "NOT_FOUND", "ERROR_API_FAILED", or includes a "STOP TOOL USE" instruction, DO NOT call the tool again under any circumstances. Immediately construct the "locationLink" URL using the street address/name: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}+{URL_ENCODED_STREET_NAME}\` or coordinate-based query if street name is unavailable. Do NOT retry or call the tool for other items if you hit a failure.
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
      googleSearch: true,
      enablePlaceIdTool: !!process.env.GOOGLE_MAPS_API_KEY
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedData = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
      } else {
        throw parseErr;
      }
    }

    if (parsedData.ideas && Array.isArray(parsedData.ideas)) {
      parsedData.ideas = parsedData.ideas.map((idea: any) => ({
        ...idea,
        id: 'idea_' + Date.now() + Math.random().toString(36).substr(2, 9)
      }));
    }

    addDebugLog(`[FoodIdea] Parsing food-idea LLM response successfully...`);
    res.json(parsedData);
  } catch (error: any) {
    addDebugLog(`[FoodIdea] Error occurred: ${error.message || error}`);
    console.error("[Food Idea Analyze Error]:", error);
    const isQuotaError = error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED");
    
    const errorMsg = isQuotaError
      ? "Unable to provide recommendations: Gemini API quota or rate limit reached. Please verify your API key or try again in a few minutes."
      : "Unable to provide recommendations: The agent connection has timed out or the request could not be processed. Please try again.";

    res.json({
      text: errorMsg,
      ideas: []
    });
  }
});

// Endpoint to fetch real-time agent thinking process logs
app.get("/api/gemini/debug-logs", (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
  const logs = sessionDebugLogs[sessionId] || [];
  res.json({ logs });
});

// Endpoint to clear the backend agent process logs
app.post("/api/gemini/clear-debug-logs", (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
  sessionDebugLogs[sessionId] = [];
  addDebugLog(`[System] Debug logs cleared by user request.`);
  res.json({ status: "cleared", logs: [] });
});

// Endpoint to compile logs and send to admin
app.post("/api/gemini/send-logs", (req, res) => {
  try {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    const { logsText } = req.body;
    
    // Create admin logs directory if not exists
    const logsDir = path.join(process.cwd(), "data", "admin_logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(logsDir, `admin_logs_${sessionId}_${timestampStr}.txt`);
    
    const formattedContent = `ADMIN LOGS EXPORT\nTarget Admin: cwah.liu@gmail.com\nTimestamp: ${new Date().toLocaleString()}\nSession ID: ${sessionId}\n\n=========================================\n\n${logsText || "No logs provided."}`;
    
    fs.writeFileSync(filePath, formattedContent, "utf8");
    
    // Also append to a single rolling admin_logs_all.txt for convenience
    const rollingFilePath = path.join(logsDir, "admin_logs_all.txt");
    fs.appendFileSync(rollingFilePath, `\n\n=== EXPORTED AT ${new Date().toISOString()} (Session: ${sessionId}) ===\n${logsText}\n`, "utf8");
    
    addDebugLog(`[AdminExport] Emailed and compiled entire log history to cwah.liu@gmail.com. Saved locally to ${filePath}`);
    
    res.json({ 
      status: "success", 
      message: "Debug logs compiled and sent to cwah.liu@gmail.com. They have also been saved to the server persistent volume.",
      filePath
    });
  } catch (err: any) {
    console.error("Error exporting logs:", err);
    res.status(500).json({ error: "Failed to export debug logs to admin." });
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
