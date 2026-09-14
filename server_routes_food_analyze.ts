import { Router } from 'express';
import { buildFoodAnalyzeInstruction } from './agents/index.js';
import { withGeminiRetry } from './server_gemini_retry.js';
import {
  addDebugLog,
  getGeminiClient,
  adminAuth,
  db,
  logSessionStorage,
  sessionDebugLogs,
  globalDebugLogs,
} from './server.js';
import { runFoodAnalyze } from './server_food_analyze_run.js';

export const foodAnalyzeRouter = Router();

// GET Endpoint for System Instruction Preview
foodAnalyzeRouter.get("/api/gemini/instruction-preview", async (req, res) => {
  try {
    const { agentType, biomarkersNeedingImprovement, remainingAllowance, activeMeal } = req.query;
    const previewLang = typeof req.query.language === 'string' ? req.query.language : 'en';
    
    if (agentType === 'food_scout') {
      const instruction = `You are a fast visual food identification agent. Look at the image and return a short list of plain-text search keywords for the food items you see (e.g. ['fried chicken', 'white rice', 'sambal']), plus a rough estimated weight in grams for each if visually judgeable. Do not do any nutrition or clinical analysis. Also try to identify any clues on how it's cooked (e.g., oil cooked, fried, steamed) or freshness (e.g., fresh fish). Include these details in your keywords if helpful. Output only: { "items": [{ "keyword": string, "estimatedWeightGrams": number }] }`;
      return res.json({ instruction });
    }

    if (agentType === 'food') {
      let parsedBiomarkers: any[] | undefined = undefined;
      let parsedAllowance: any = undefined;
      let parsedMeal: any = undefined;

      try {
        if (biomarkersNeedingImprovement && typeof biomarkersNeedingImprovement === 'string') {
          parsedBiomarkers = JSON.parse(biomarkersNeedingImprovement);
        }
      } catch (e) {}

      try {
        if (remainingAllowance && typeof remainingAllowance === 'string') {
          parsedAllowance = JSON.parse(remainingAllowance);
        }
      } catch (e) {}

      try {
        if (activeMeal && typeof activeMeal === 'string') {
          parsedMeal = JSON.parse(activeMeal);
        }
      } catch (e) {}

      // If they are not passed or empty, try to look up the user's synced context
      if (!parsedBiomarkers || !parsedAllowance) {
        const idToken = req.headers.authorization?.split('Bearer ')[1];
        if (idToken) {
          try {
            const decoded = await adminAuth.verifyIdToken(idToken);
            const uid = decoded.uid;
            
            if (db) {
              // Try to fetch reports/latest
              const reportRef = db.collection('users').doc(uid).collection('reports').doc('latest');
              const reportSnap = await reportRef.get();
              if (reportSnap.exists) {
                const reportData = reportSnap.data();
                if (reportData && Array.isArray(reportData.biomarkers)) {
                  parsedBiomarkers = reportData.biomarkers.filter((b: any) => b.status === 'At Risk' || b.status === 'HIGH' || b.status === 'LOW');
                }
              }

              // Try to fetch dashboard
              const dashRef = db.collection('users').doc(uid).collection('metadata').doc('dashboard');
              const dashSnap = await dashRef.get();
              if (dashSnap.exists) {
                const dashData = dashSnap.data();
                if (dashData) {
                  if (!parsedAllowance && dashData.remainingAllowance) {
                    parsedAllowance = dashData.remainingAllowance;
                  }
                  if (!parsedMeal && dashData.activeMeal) {
                    parsedMeal = dashData.activeMeal;
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[instruction-preview] Error loading authenticated user context:", err);
          }
        }
      }

      // Safe placeholder values as fallback
      if (!parsedBiomarkers) {
        parsedBiomarkers = [];
      }
      if (!parsedAllowance) {
        parsedAllowance = {
          calories: 2000,
          saturatedFat: 20,
          sodium: 2300
        };
      }

      const instruction = buildFoodAnalyzeInstruction({
        biomarkersNeedingImprovement: parsedBiomarkers,
        remainingAllowance: parsedAllowance,
        activeMeal: parsedMeal,
        userProfile: { language: previewLang },
      });

      return res.json({ instruction });
    }

    return res.status(400).json({ error: "Unsupported agentType" });
  } catch (error: any) {
    console.error("[instruction-preview] Error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Gemini Food Analyze Endpoint

import { callReceptionistAgent } from './src/server/receptionist/index.js';
import { runBiomarkerPipeline } from './src/server/biomarkers/pipeline.js';

// Health Preparation & Receptionist Agent
foodAnalyzeRouter.post("/api/gemini/front-desk", async (req, res) => {
  try {
    const {
      message,
      profile,
      biomarkers,
      foodLogs,
      biomarkerHistory,
      history,
      engine,
      image,
      images,
      existingMemory,
      existingActivitiesAndTasks,
      specialistContainers,
    } = req.body;
    
    let targetModel = typeof engine === 'object' ? engine?.name || engine?.model || "gemini-3.5-flash-lite" : (engine || "gemini-3.5-flash-lite");
    
    const ai = getGeminiClient();

    // Map profile to UserProfileSnapshot
    const existingUserProfile = profile ? {
      name: profile.name || null,
      age: profile.age ? Number(profile.age) : null,
      gender: profile.gender || null,
      ethnicity: profile.ethnicity || null,
      bloodType: profile.bloodType || null,
      heightCm: profile.height ? Number(profile.height) : null,
      weightKg: profile.weight ? Number(profile.weight) : null,
      activityLevel: profile.activityLevel || null,
      medicalHistory: Array.isArray(profile.medicalHistory) ? profile.medicalHistory : (profile.medicalConditions ? [profile.medicalConditions] : null),
      dietaryPreferences: Array.isArray(profile.dietaryRestrictions) ? profile.dietaryRestrictions : null,
      targetWeightKg: profile.targetWeight ? Number(profile.targetWeight) : null,
      language: profile.language || null,
    } : null;

    // Convert history into ChatMessage[]
    const chatHistory = (history || []).map((h: any) => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: typeof h.content === 'string' ? h.content : (h.message || JSON.stringify(h.content || ''))
    }));

    const userTimezone = profile?.timezone || "UTC";
    const systemCurrentDate = new Date().toISOString().split('T')[0];

    // Check if images or complex medical report were submitted
    let base64Images: string[] = [];
    if (images && Array.isArray(images) && images.length > 0) {
      base64Images = images;
    } else if (image) {
      base64Images = [image];
    }

    const synchronizedBiomarkers = biomarkers ? { ...biomarkers } : {};
    if (existingUserProfile?.heightCm) {
      synchronizedBiomarkers.height = existingUserProfile.heightCm;
    }
    if (existingUserProfile?.weightKg) {
      synchronizedBiomarkers.weight = existingUserProfile.weightKg;
    }
    if (existingUserProfile?.heightCm && existingUserProfile?.weightKg) {
      const hM = existingUserProfile.heightCm / 100;
      synchronizedBiomarkers.bmi = Number((existingUserProfile.weightKg / (hM * hM)).toFixed(1));
    }

    // Force sync existingMemory.userProfileSnapshot with the true existingUserProfile
    // If the database profile was cleared, we must not let stale localStorage data persist.
    if (existingMemory && existingMemory.userProfileSnapshot) {
      if (existingUserProfile) {
        existingMemory.userProfileSnapshot.age = existingUserProfile.age || null;
        existingMemory.userProfileSnapshot.heightCm = existingUserProfile.heightCm || null;
        existingMemory.userProfileSnapshot.weightKg = existingUserProfile.weightKg || null;
        existingMemory.userProfileSnapshot.gender = existingUserProfile.gender || null;
      } else {
        existingMemory.userProfileSnapshot = {};
      }
    }

    const receptionistPayload = {
      currentUserMessage: message || "",
      chatHistory,
      existingUserProfile,
      existingMemory: existingMemory || null,
      existingActivitiesAndTasks: existingActivitiesAndTasks || null,
      language: profile?.language || null,
      biomarkers: Object.keys(synchronizedBiomarkers).length > 0 ? synchronizedBiomarkers : null,
      foodLogs: foodLogs || null,
      biomarkerHistory: biomarkerHistory || null,
      images: base64Images.length > 0 ? base64Images : null,
      systemCurrentDate,
      userTimezone,
      specialistContainers: specialistContainers || null,
    };

    const sessionId = logSessionStorage.getStore() || "global";
    const initialLogCount = (sessionDebugLogs[sessionId] || globalDebugLogs).length;

    addDebugLog(`[FrontDesk] Dispatching receptionist prompt to model: "${targetModel}".`);

    const { output: recOutput, raw, systemInstruction, userText } = await withGeminiRetry(() => 
      callReceptionistAgent(ai, receptionistPayload, targetModel)
    );

    addDebugLog(`[FrontDesk] Dispatched System Instruction:\n${systemInstruction}`);
    addDebugLog(`[FrontDesk] Dispatched Prompt:\n${userText}`);
    addDebugLog(`[FrontDesk] Response received (${raw.length} chars). Raw output:\n${raw}`);
    addDebugLog(`[FrontDesk-Response] Output status: ${recOutput.status}, intent: ${recOutput.intent}, targetAgent: ${recOutput.targetAgent}`);
    if (recOutput.handoffPayload) {
      addDebugLog(`[FrontDesk-HandoffChain] Front Desk [triage] ➔ Handoff Payload Generated ➔ Target Agent: ${recOutput.targetAgent} (${recOutput.handoffPayload.targetAgent || 'health_coach'})`);
    }

    let updatedProfile = recOutput.updatedProfile ? { ...profile, ...recOutput.updatedProfile } : null;
    if (recOutput.modificationCommand && Array.isArray(recOutput.modificationCommand)) {
      if (!updatedProfile) updatedProfile = { ...profile };
      recOutput.modificationCommand.forEach((cmd: any) => {
        if (cmd.field && cmd.value !== undefined) {
           updatedProfile[cmd.field] = cmd.value;
        }
      });
    }
    let newBiomarkerLogs = recOutput.newBiomarkerLogs || null;
    let filledRows: any[] = [];

    if (base64Images.length > 0 || (recOutput.targetAgent === 'medical' && recOutput.status === 'ready_for_handoff')) {
      try {
        const formattedHistory: Record<string, any[]> = {};
        for (const h of (biomarkerHistory || [])) {
          if (h.biomarkers) {
            Object.keys(h.biomarkers).forEach(k => {
              if (!formattedHistory[k]) formattedHistory[k] = [];
              formattedHistory[k].push({ date: h.date, value: h.biomarkers[k] });
            });
          }
        }

        const medicalProfile = {
          age: profile?.age || 40,
          gender: profile?.gender || 'unknown',
          ethnicity: profile?.ethnicity || 'unknown',
          unitPreference: profile?.unitPreference || 'SI',
          language: profile?.language || 'en'
        };

        filledRows = await runBiomarkerPipeline(
          ai,
          message || "",
          base64Images,
          formattedHistory,
          medicalProfile as any,
          undefined,
          targetModel
        );

        if (filledRows && filledRows.length > 0) {
          const autoLogs = filledRows
            .filter((r: any) => r.key && r.value !== undefined && r.value !== null)
            .map((r: any) => ({
              biomarker: r.key,
              value: Number(r.value),
              unit: r.unit || '',
              date: r.date || new Date().toISOString().split('T')[0]
            }));
          if (autoLogs.length > 0) {
            newBiomarkerLogs = [...(newBiomarkerLogs || []), ...autoLogs];
          }
        }
      } catch (err: any) {
        addDebugLog(`[FrontDesk-MedicalExtractError] Failed to extract medical biomarkers: ${err.message}`);
      }
    }

    // Default today's date if newBiomarkerLogs entries missing date
    if (newBiomarkerLogs && Array.isArray(newBiomarkerLogs)) {
      const today = new Date().toISOString().split('T')[0];
      newBiomarkerLogs = newBiomarkerLogs.map((item: any) => ({
        ...item,
        date: item.date || today
      }));
    }

    const cleanUserResponse = typeof recOutput.userResponse === 'string'
      ? recOutput.userResponse
          .replace(/(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?\s*What\s+(?:should\s+(?:I|you)\s+do|to\s+do\s+next)\??:?\s*(?:\*\*)?\s*(?=\n|$)/gi, '\n\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : recOutput.userResponse;

    const logsToUse = sessionDebugLogs[sessionId] || globalDebugLogs;
    const backendLogs = logsToUse.slice(initialLogCount).map((l: any) => `[${l.timestamp}] ${l.message}`).join('\n');

    res.json({
      agentType: 'front_desk',
      text: cleanUserResponse,
      userResponse: cleanUserResponse,
      intent: recOutput.intent,
      targetAgent: recOutput.targetAgent,
      status: recOutput.status,
      missingFields: recOutput.missingFields,
      collectedData: recOutput.collectedData,
      memory: recOutput.memory,
      isDisambiguationRequired: recOutput.isDisambiguationRequired,
      disambiguationContext: recOutput.disambiguationContext,
      uiForm: recOutput.uiForm,
      handoffPayload: recOutput.handoffPayload,
      handoffChain: recOutput.handoffPayload ? ['Front Desk (triage)', recOutput.targetAgent === 'medical' ? 'Medical Specialist' : 'Health Coach'] : undefined,
      updatedProfile,
      newBiomarkerLogs,
      modificationCommand: recOutput.modificationCommand || null,
      filledRows,
      backendLogs,
      type: 'front_desk'
    });
  } catch (err: any) {
    console.error("Front Desk Error:", err);
    addDebugLog(`[FrontDesk-Error] Receptionist execution failed: ${err.message || String(err)}`);
    if (err.stack) {
      addDebugLog(`[FrontDesk-Error-Stack] ${err.stack}`);
    }
    const isQuota = /429|quota|RESOURCE_EXHAUSTED/i.test(err.message || '');
    const is503 = /503|UNAVAILABLE|overloaded/i.test(err.message || '');
    const statusCode = (isQuota || is503) ? 503 : 500;
    
    // Omit stack trace in response for clean errors, only send stack on true 500
    res.status(statusCode).json({ 
       error: err.message, 
       stack: statusCode === 500 ? err.stack : undefined, 
       agentType: 'front_desk' 
    });
  }
});



foodAnalyzeRouter.post("/api/gemini/food-analyze", (req, res) => {
  return runFoodAnalyze(req, res);
});
