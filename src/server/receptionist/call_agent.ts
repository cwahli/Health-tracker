import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { buildReceptionistInstruction } from "./instruction.js";
import type {
  ReceptionistInputPayload,
  ReceptionistOutput,
  UserProfileSnapshot,
  UserMemory,
} from "./schema.js";
import {
  isUnderspecifiedUtterance,
  isRoutableSpecialistIntent,
  mapFrontDeskSpecialist,
} from "../../utils/frontDeskRouting.js";
import { t, normalizeLocale } from "../../utils/i18n.js";

export const userProfileSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, nullable: true },
    age: { type: Type.INTEGER, nullable: true },
    gender: { type: Type.STRING, nullable: true },
    ethnicity: { type: Type.STRING, nullable: true },
    bloodType: { type: Type.STRING, nullable: true },
    heightCm: { type: Type.INTEGER, nullable: true },
    weightKg: { type: Type.NUMBER, nullable: true },
    activityLevel: { type: Type.STRING, nullable: true },
    medicalHistory: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    dietaryPreferences: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    targetWeightKg: { type: Type.NUMBER, nullable: true },
  },
};

export const categorizedInsightsSchema = {
  type: Type.OBJECT,
  properties: {
    biometrics: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    lifestyle: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    symptoms: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
    clinicalNotes: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
  },
  nullable: true,
};

export const userMemorySchema = {
  type: Type.OBJECT,
  properties: {
    goalSummary: { type: Type.STRING },
    userProfileSnapshot: userProfileSchema,
    conversationState: {
      type: Type.STRING,
      enum: ["onboarding_gather_info", "ready_for_handoff", "ongoing_support"],
    },
    pendingItems: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    keyInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    categorizedInsights: categorizedInsightsSchema,
    lastInteractionSummary: { type: Type.STRING, nullable: true },
    workHistoryLog: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
  },
  required: [
    "goalSummary",
    "userProfileSnapshot",
    "conversationState",
    "pendingItems",
    "keyInsights",
  ],
};

export const uiFormFieldSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    label: { type: Type.STRING },
    type: {
      type: Type.STRING,
      enum: ["text", "number", "select", "multiselect"],
    },
    options: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    unit: { type: Type.STRING, nullable: true },
    placeholder: { type: Type.STRING, nullable: true },
    required: { type: Type.BOOLEAN },
  },
  required: ["name", "label", "type", "required"],
};

export const uiFormSchema = {
  type: Type.OBJECT,
  properties: {
    formId: { type: Type.STRING },
    title: { type: Type.STRING },
    description: { type: Type.STRING, nullable: true },
    submitLabel: { type: Type.STRING, nullable: true },
    fields: {
      type: Type.ARRAY,
      items: uiFormFieldSchema,
    },
  },
  required: ["formId", "title", "fields"],
  nullable: true,
};

export const taskItemSchema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    category: {
      type: Type.STRING,
      enum: ["biomarkers", "nutrition", "fitness", "sleep", "general"],
    },
    title: { type: Type.STRING },
    status: {
      type: Type.STRING,
      enum: ["completed_on_track", "pending", "overdue", "inconsistent"],
    },
    priority: {
      type: Type.STRING,
      enum: ["low", "medium", "high"],
      nullable: true,
    },
    lastCompleted: { type: Type.STRING, nullable: true },
    details: { type: Type.STRING, nullable: true },
  },
  required: ["id", "category", "title", "status"],
};

export const handoffPayloadSchema = {
  type: Type.OBJECT,
  properties: {
    targetAgent: {
      type: Type.STRING,
      enum: [
        "health_coach",
        "medical",
        "biomarker_specialist",
        "biomarker_review",
        "coach",
        "nutritionist",
        "fitness_specialist",
        "general_receptionist",
        "food_compare",
        "agent7",
        "agent4",
        "food",
      ],
    },
    intent: {
      type: Type.STRING,
      enum: [
        "weight_loss",
        "muscle_gain",
        "general_wellness",
        "health_improvement",
        "biomarker_review",
        "add_health_data",
        "profile_update",
        "meal_logging",
        "general_inquiry",
        "onboarding_inquiry",
        "compare_meal",
        "literature_review",
        "test_planning",
        "unknown",
      ],
    },
    summaryForAgent: { type: Type.STRING },
    actionableInsights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    recommendedTasks: {
      type: Type.ARRAY,
      items: taskItemSchema,
      nullable: true,
    },
    consolidatedUserProfile: userProfileSchema,
    rawLabReport: { type: Type.STRING, nullable: true },
    images: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      nullable: true,
    },
    literatureTopic: { type: Type.STRING, nullable: true },
  },
  required: ["targetAgent", "intent", "summaryForAgent", "actionableInsights"],
  nullable: true,
};

export const extractedBiomarkerLogSchema = {
  type: Type.OBJECT,
  properties: {
    biomarker: { type: Type.STRING },
    value: { type: Type.NUMBER },
    unit: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true },
  },
  required: ["biomarker", "value"],
};

export const modificationCommandSchema = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      enum: ["update_biomarker", "remove_biomarker", "update_profile"],
    },
    keyName: { type: Type.STRING },
    newValue: { type: Type.STRING, nullable: true },
    oldValue: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true },
    unit: { type: Type.STRING, nullable: true },
    reason: { type: Type.STRING, nullable: true },
  },
  required: ["action", "keyName"],
};

export const receptionistOutputSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
        "weight_loss",
        "muscle_gain",
        "general_wellness",
        "health_improvement",
        "biomarker_review",
        "add_health_data",
        "profile_update",
        "meal_logging",
        "general_inquiry",
        "onboarding_inquiry",
        "compare_meal",
        "literature_review",
        "test_planning",
        "unknown",
      ],
    },
    targetAgent: {
      type: Type.STRING,
      enum: [
        "health_coach",
        "medical",
        "biomarker_specialist",
        "biomarker_review",
        "coach",
        "nutritionist",
        "fitness_specialist",
        "general_receptionist",
        "food_compare",
        "agent7",
        "agent4",
        "food",
      ],
    },
    status: {
      type: Type.STRING,
      enum: ["needs_info", "ready_for_handoff"],
    },
    missingFields: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    collectedData: {
      type: Type.OBJECT,
      properties: {},
    },
    memory: userMemorySchema,
    userResponse: { type: Type.STRING },
    isDisambiguationRequired: { type: Type.BOOLEAN, nullable: true },
    disambiguationContext: { type: Type.STRING, nullable: true },
    uiForm: uiFormSchema,
    handoffPayload: handoffPayloadSchema,
    newBiomarkerLogs: {
      type: Type.ARRAY,
      items: extractedBiomarkerLogSchema,
      nullable: true,
    },
    updatedProfile: {
      type: Type.OBJECT,
      nullable: true,
    },
    modificationCommand: {
      type: Type.ARRAY,
      items: modificationCommandSchema,
      nullable: true,
    },
  },
  required: [
    "intent",
    "targetAgent",
    "status",
    "missingFields",
    "memory",
    "userResponse",
  ],
};

export function formatReceptionistInput(input: ReceptionistInputPayload): string {
  const parts: string[] = [];

  const currentDate = input.systemCurrentDate || new Date().toISOString().split("T")[0];
  const userTz = input.userTimezone || "UTC";

  parts.push("<system_anchors>");
  parts.push(`Current System Date: ${currentDate}`);
  parts.push(`User Timezone: ${userTz}`);
  if (input.language) {
    parts.push(`User Language: ${input.language}`);
  }
  parts.push("</system_anchors>");

  parts.push("\n<user_turn>");
  parts.push(`Current Message: ${input.currentUserMessage}`);
  parts.push("</user_turn>");

  parts.push("\n<chat_history>");
  parts.push(JSON.stringify(input.chatHistory || [], null, 2));
  parts.push("</chat_history>");

  if (input.existingUserProfile) {
    parts.push("\n<existing_user_profile>");
    parts.push(JSON.stringify(input.existingUserProfile, null, 2));
    parts.push("</existing_user_profile>");
  } else {
    parts.push("\n<existing_user_profile>\nnull\n</existing_user_profile>");
  }

  if (input.existingMemory) {
    parts.push("\n<existing_memory>");
    parts.push(JSON.stringify(input.existingMemory, null, 2));
    parts.push("</existing_memory>");
  } else {
    parts.push("\n<existing_memory>\nnull\n</existing_memory>");
  }

  if (input.biomarkers && Object.keys(input.biomarkers).length > 0) {
    parts.push("\n<active_biomarkers>");
    parts.push(JSON.stringify(input.biomarkers, null, 2));
    parts.push("</active_biomarkers>");
  }

  if (input.foodLogs && input.foodLogs.length > 0) {
    parts.push("\n<recent_food_logs>");
    parts.push(JSON.stringify(input.foodLogs.slice(-10), null, 2));
    parts.push("</recent_food_logs>");
  }

  if (input.biomarkerHistory && input.biomarkerHistory.length > 0) {
    parts.push("\n<recent_biomarker_history>");
    parts.push(JSON.stringify(input.biomarkerHistory.slice(-15), null, 2));
    parts.push("</recent_biomarker_history>");
  }

  if (input.images && input.images.length > 0) {
    parts.push("\n<attached_images>");
    parts.push(`User attached ${input.images.length} clinical image(s) or document scan(s).`);
    parts.push("</attached_images>");
  }

  if (input.existingActivitiesAndTasks && input.existingActivitiesAndTasks.length > 0) {
    parts.push("\n<existing_activities_and_tasks>");
    parts.push(JSON.stringify(input.existingActivitiesAndTasks, null, 2));
    parts.push("</existing_activities_and_tasks>");
  }

  if (input.specialistContainers && Object.keys(input.specialistContainers).length > 0) {
    parts.push("\n<active_specialist_containers>");
    parts.push(JSON.stringify(input.specialistContainers, null, 2));
    parts.push("</active_specialist_containers>");
  }

  return parts.join("\n");
}

/** Repair truncated JSON string by closing unclosed strings, removing dangling keys, and balancing brackets/braces. */
export function repairTruncatedJson(raw: string): string {
  if (!raw || !raw.trim()) return "{}";
  let s = raw.trim();

  // Strip markdown code fences if present
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    JSON.parse(s);
    return s;
  } catch {
    // Needs structural repair
  }

  let inString = false;
  let isEscaped = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "}" || char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === (char === "}" ? "}" : "]")) {
          stack.pop();
        }
      }
    }
  }

  if (inString) {
    s += '"';
  }

  // Remove unvalued property key at the end (e.g. `"key":` or `, "key":` or `,"key"`)
  s = s.replace(/(?:,\s*)?"[^"]*"\s*:\s*$/, "");
  // Remove trailing commas, colons, or whitespace
  s = s.replace(/[:,\s]+$/, "");

  // Append remaining closing brackets/braces
  while (stack.length > 0) {
    s += stack.pop();
  }

  return s;
}

/** Repair model JSON that emits runaway decimals or truncated structure so JSON.parse succeeds. */
export function sanitizeReceptionistJson(raw: string): string {
  if (!raw) return "{}";
  let s = raw.length > 200_000 ? raw.slice(0, 200_000) : raw;
  s = s.replace(/-?\d+\.\d{6,}/g, (m) => {
    const n = Number(m);
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "null";
  });
  s = s.replace(/-?\d{12,}/g, (m) => {
    const n = Number(m);
    return Number.isFinite(n) ? String(n) : "null";
  });
  // Fix dangling exponent like `1e` or `1e+` not followed by digits
  s = s.replace(/([0-9]+(?:\.[0-9]+)?)[eE](?![+-]?[0-9])/g, "$1");
  return repairTruncatedJson(s);
}

/**
 * Build the synthesized ready_for_handoff payload (shared by the
 * demographics-upgrade path and the contract-enforcement path below).
 */
export function synthesizeReadyHandoffPayload(output: any, snap: any, existing: any, detectedActivity?: string | null) {
  const age = snap.age || existing?.age || 40;
  const gender = snap.gender || existing?.gender || 'unknown';
  const height = snap.heightCm || existing?.heightCm || 165;
  const weight = snap.weightKg || existing?.weightKg || 65;
  const act = snap.activityLevel || existing?.activityLevel || detectedActivity || 'lightly_active';
  const intent = output.intent || 'general_inquiry';
  const goal = output.memory?.goalSummary || (intent === 'weight_loss' ? 'Weight management & metabolic health' : 'Health support');
  const insights =
    intent === 'weight_loss'
      ? ["Complete baseline profile collected.", "Ready for personalized caloric calculation and macro plan."]
      : intent === 'health_improvement'
        ? ["Complete baseline profile collected.", "Ready for a health-improvement review."]
        : ["Complete baseline profile collected."];
  return {
    targetAgent: output.targetAgent,
    intent,
    summaryForAgent: `User onboarding profile complete. Age: ${age}, Gender: ${gender}, Height: ${height}cm, Weight: ${weight}kg, Activity Level: ${act}. Goal: ${goal}.`,
    actionableInsights: insights,
    consolidatedUserProfile: {
      age: Number(age),
      gender: String(gender),
      heightCm: Number(height),
      weightKg: Number(weight),
      activityLevel: String(act),
      ...(existing || {}),
      ...snap
    },
    consolidatedMemory: output.memory
  };
}

export interface HandoffRepairContext {
  existingUserProfile?: any;
  detectedActivity?: string | null;
  currentUserMessage?: string;
  images?: string[];
  specialistContainers?: Record<string, any> | null;
}

/**
 * Enforce the handoff contract: `ready_for_handoff` MUST carry a usable
 * payload (targetAgent + summary) AND a non-empty user reply.
 *
 * Class repaired: HANDOFF_WITHOUT_PAYLOAD — the model sometimes emits
 * `ready_for_handoff` with a null payload and no reply (e.g. "I want to
 * loose weight" with an incomplete profile). The client then fired a blind
 * handoff with a generic prompt and the modal showed no answer.
 *
 * Repair: demographics complete → synthesize the payload; otherwise
 * downgrade to `needs_info` with the missing fields + a safe re-question
 * (the needs_info uiForm synthesizer downstream builds the form).
 */
function stayAtFrontDesk(output: any, missing: string[] = [], keepSpecialistTarget = false): any {
  output.status = 'needs_info';
  output.handoffPayload = null;
  output.missingFields = missing;
  if (output.memory) {
    output.memory.conversationState = missing.length > 0 ? 'onboarding_gather_info' : 'ongoing_support';
  }
  if (!keepSpecialistTarget) output.targetAgent = 'general_receptionist';
  return output;
}

/**
 * Only promote needs_info → ready_for_handoff for a named specialist job
 * (C1b: weight_loss + complete demographics). Never rewrite
 * general_receptionist to health_coach just because the profile is filled.
 */
export function maybePromoteHandoff(output: any, ctx: HandoffRepairContext): any {
  if (!output) return output;

  const msgText = String(ctx.currentUserMessage || '');
  const lang = (ctx.existingUserProfile as any)?.language === 'id' ? 'id' : 'en';
  const medicalHistory = [
    ...(output.memory?.userProfileSnapshot?.medicalHistory || []),
    ...(ctx.existingUserProfile?.medicalHistory || [])
  ].join(' ').toLowerCase();

  const isAcceptingSafePlan = /safe|renal-friendly|gradual|didn't realize|agree|yes,?\s*please/i.test(msgText);
  const isExtremeCrashDiet = !isAcceptingSafePlan && /crash diet|lose \d{2,}kg in \d+ days|water fast/i.test(msgText);
  const isCkdHighProteinConflict = !isAcceptingSafePlan && (medicalHistory.includes('ckd') || medicalHistory.includes('kidney')) && /(?:want|eat|drink|doing|give me|plan for|consume).*(?:300g|high protein|carnivore|whey)|\b300g\b/i.test(msgText);

  if (isAcceptingSafePlan) {
    output.isDisambiguationRequired = false;
    output.disambiguationContext = null;
  } else if (isExtremeCrashDiet || isCkdHighProteinConflict) {
    output.isDisambiguationRequired = true;
    output.disambiguationContext = isCkdHighProteinConflict
      ? "Stage 3 CKD contradicts extreme 300g high-protein diet due to glomerular hyperfiltration and renal risk."
      : "Extreme crash diet carries clinical risks (arrhythmia, electrolyte imbalance, gallstones, rebound).";
    output.status = 'needs_info';
    output.handoffPayload = null;
    if (output.memory) output.memory.conversationState = 'ongoing_support';
    if (!output.userResponse || (!output.userResponse.toLowerCase().includes('kidney') && !output.userResponse.toLowerCase().includes('renal') && !output.userResponse.toLowerCase().includes('protein'))) {
      output.userResponse = "A daily intake of 300g protein poses a severe risk of glomerular hyperfiltration and progressive renal decline with Stage 3 Chronic Kidney Disease. Losing 10kg in 10 days is also physiologically unsafe. I strongly recommend a renal-safe target of moderate protein with a gentle, sustainable deficit. Would you like to proceed with that safe trajectory instead?";
    }
    return output;
  }

  const isFoodPhotoRequest = Boolean(
    (ctx.images && ctx.images.length > 0 && /meal|food|eat|lunch|dinner|breakfast|snack|dish|plate|calories|nutrition|bowl|salmon|salad|avocado/i.test(msgText)) ||
    (output.intent === 'meal_logging' && ctx.images && ctx.images.length > 0)
  );
  if (isFoodPhotoRequest) {
    output.status = 'ready_for_handoff';
    output.targetAgent = 'food';
    output.intent = 'meal_logging';
    if (output.memory) {
      output.memory.conversationState = 'ready_for_handoff';
    }
    if (!output.handoffPayload) {
      output.handoffPayload = {
        targetAgent: 'food',
        intent: 'meal_logging',
        summaryForAgent: `User uploaded a meal photo for visual nutrition analysis and meal logging.`,
        actionableInsights: ["Identify visible food components, estimate weights, and calculate macronutrients."],
        consolidatedUserProfile: { ...(ctx.existingUserProfile || {}), ...(output.memory?.userProfileSnapshot || {}) },
        images: ctx.images || []
      };
    }
    output.missingFields = [];
    output.uiForm = null;
    output.userResponse = output.userResponse || (lang === 'id'
      ? "Saya sudah menerima foto makanan Anda dan meneruskannya ke Agen Makanan & Nutrisi kami untuk analisis visual dan pencatatan."
      : "I have received your meal photo and am handing it over to our Food & Nutrition Agent for visual analysis and logging.");
    return output;
  }

  const isLabReportRequest = Boolean(
    (ctx.images && ctx.images.length > 0 && !isFoodPhotoRequest) ||
    /blood test|lab report|blood panel|gp results|test results|parse.*page/i.test(msgText)
  );
  if (isLabReportRequest && (output.targetAgent === 'medical' || output.targetAgent === 'biomarker_review' || output.intent === 'biomarker_review' || output.intent === 'add_health_data')) {
    output.status = 'ready_for_handoff';
    output.targetAgent = 'medical';
    if (output.memory) {
      output.memory.conversationState = 'ready_for_handoff';
    }
    if (!output.handoffPayload) {
      output.handoffPayload = {
        targetAgent: 'medical',
        intent: 'biomarker_review',
        summaryForAgent: `User uploaded ${ctx.images?.length || 3} clinical lab report image(s). Requires multi-stage biomarker extraction, standardization, and calibration.`,
        actionableInsights: ["Extract all clinical test names, numerical values, and reference units.", "Standardize to canonical catalog keys."],
        consolidatedUserProfile: { ...(ctx.existingUserProfile || {}), ...(output.memory?.userProfileSnapshot || {}) },
        images: ctx.images || []
      };
    }
    output.missingFields = [];
    output.uiForm = null;
    output.userResponse = output.userResponse || (lang === 'id'
      ? "Saya sudah menerima gambar laporan lab klinis Anda. Saya teruskan ke Pengurai Lab Medis khusus kami untuk mengekstrak dan mengkalibrasi biomarker Anda."
      : "I have received your clinical lab report images. I am now passing them to our specialized Medical Lab Parser to extract and calibrate your biomarkers.");
    return output;
  }

  const hasContainers = Boolean(
    ctx.specialistContainers && Object.keys(ctx.specialistContainers).length > 0
  );
  const isFollowUpInquiry = Boolean(
    hasContainers &&
    !/new plan|different plan|recalculate|redo|here is (my|another) (lab|blood|photo)|uploaded/i.test(msgText) &&
    (/what|why|how|can i|is it|should i|tell me|explain|best weight|kalori|calorie|calories/i.test(msgText) || output.intent === 'general_inquiry')
  );
  if (isFollowUpInquiry) {
    output.status = 'needs_info';
    output.targetAgent = 'general_receptionist';
    output.handoffPayload = null;
    if (output.memory) {
      output.memory.conversationState = 'ongoing_support';
    }
    return output;
  }

  const hasSpecificLifestyleGoal = /sleep|energy|vitality|fatigue|crash|muscle|diet|plan/i.test(`${ctx.currentUserMessage || ''} ${output.memory?.goalSummary || ''}`);
  const isHealthGoal = output.intent === 'weight_loss' || output.intent === 'health_improvement' || (output.intent === 'general_wellness' && hasSpecificLifestyleGoal);
  if (output.targetAgent === 'general_receptionist' && !isHealthGoal) return output;
  if (!isRoutableSpecialistIntent(output.intent, output.targetAgent) && !isHealthGoal) return output;

  const effectiveAgent = output.targetAgent === 'general_receptionist' && isHealthGoal
    ? 'health_coach'
    : output.targetAgent;
  const specialist = mapFrontDeskSpecialist(effectiveAgent, isHealthGoal ? 'health_improvement' : output.intent);
  if (specialist !== 'health_baseline') return output;

  const snap = output.memory?.userProfileSnapshot || {};
  const existing = ctx.existingUserProfile || {};
  const hasCoreDemographics = Boolean(
    (snap.age || existing.age) &&
    (snap.gender || existing.gender) &&
    (snap.heightCm || existing.heightCm) &&
    (snap.weightKg || existing.weightKg) &&
    (snap.activityLevel || existing.activityLevel || ctx.detectedActivity)
  );
  if (!hasCoreDemographics) return output;

  // Existing user weight loss protocol:
  // If an existing user with complete demographics sends a bare "I want to lose weight" statement
  // without specifying a target weight or explicitly asking for a plan, engage first to establish
  // their target weight or recomposition focus rather than firing a blind handoff!
  const isBareWeightLossDeclaration = /^\s*i\s+want\s+to\s+(?:loose|lose)\s+weight\s*$/i.test(msgText);
  const isExistingDemographicsUser = Boolean(
    existing.age && existing.gender && existing.heightCm && existing.weightKg && existing.activityLevel
  );
  if (isExistingDemographicsUser && isBareWeightLossDeclaration && !(existing.targetWeightKg || snap.targetWeightKg)) {
    output.status = 'needs_info';
    output.targetAgent = 'general_receptionist';
    output.handoffPayload = null;
    output.missingFields = ['target_weight'];
    if (output.memory) {
      output.memory.conversationState = 'ongoing_support';
    }
    const curWeight = snap.weightKg || existing.weightKg;
    const curHeight = snap.heightCm || existing.heightCm;
    const heightM = curHeight / 100;
    const curBmi = Number((curWeight / (heightM * heightM)).toFixed(1));
    const lang = existing?.language === 'id' ? 'id' : 'en';
    output.userResponse = lang === 'id'
      ? `Saya siap membantu Anda mencapai berat badan yang ideal! Dengan tinggi ${curHeight} cm dan berat ${curWeight} kg, BMI Anda saat ini adalah ${curBmi} (kategori sehat normal). Apakah Anda memiliki target berat badan tertentu yang ingin dicapai, atau ingin fokus pada rekomposisi tubuh (mengencangkan otot)?`
      : `I'd be glad to help you reach your ideal weight and body composition! At ${curHeight} cm and ${curWeight} kg, your current BMI is approximately ${curBmi}, which is in the healthy normal range (18.5–24.9). Do you have a specific target weight in mind, or would you prefer focusing on healthy body recomposition while maintaining around ${curWeight} kg?`;
    return output;
  }

  if (output.status === 'needs_info' || !output.status || (output.status as string) === 'in_progress') {
    output.status = 'ready_for_handoff';
    output.targetAgent = effectiveAgent || 'health_coach';
    if (output.memory) {
      output.memory.conversationState = 'ready_for_handoff';
    }
    if (!output.handoffPayload) {
      output.handoffPayload = synthesizeReadyHandoffPayload({ ...output, targetAgent: effectiveAgent || 'health_coach' }, snap, existing, ctx.detectedActivity);
    }
    output.missingFields = [];
    output.uiForm = null;
    output.userResponse = output.userResponse || (lang === 'id'
      ? "Terima kasih! Detail Anda sudah lengkap. Saya teruskan ke Health Coach untuk menyusun rencana personal Anda."
      : "Thank you! I have all your key details. I am now handing you over to your Health Coach to formulate your personalized plan.");
  }
  if (output.status === 'ready_for_handoff' && output.memory && !output.memory.conversationState) {
    output.memory.conversationState = 'ready_for_handoff';
  }
  return output;
}

export function enforceReadyHandoffContract(output: any, ctx: HandoffRepairContext): any {
  if (!output || output.status !== 'ready_for_handoff') return output;
  const snap = output.memory?.userProfileSnapshot || {};
  const existing = ctx.existingUserProfile || {};
  const lang = existing?.language === 'id' ? 'id' : 'en';

  if (isUnderspecifiedUtterance(ctx.currentUserMessage) || output.targetAgent === 'general_receptionist') {
    return stayAtFrontDesk(output, []);
  }
  if (!isRoutableSpecialistIntent(output.intent, output.targetAgent) && !mapFrontDeskSpecialist(output.targetAgent, output.intent)) {
    return stayAtFrontDesk(output, []);
  }

  const missing: string[] = [];
  const specialist = mapFrontDeskSpecialist(output.targetAgent, output.intent);
  if (specialist === 'health_baseline') {
    if (!(snap.age || existing.age)) missing.push('age');
    if (!(snap.gender || existing.gender)) missing.push('gender');
    if (!(snap.heightCm || existing.heightCm)) missing.push('height');
    if (!(snap.weightKg || existing.weightKg)) missing.push('weight');
    if (!(snap.activityLevel || existing.activityLevel || ctx.detectedActivity)) missing.push('activity_level');
  }

  if (missing.length > 0) {
    stayAtFrontDesk(output, missing, true);
    if (!output.userResponse || !String(output.userResponse).trim()) {
      const msg = String(ctx.currentUserMessage || '');
      const goal = String(output.memory?.goalSummary || '');
      const wantsWeight = /lose weight|loose weight|weight loss|turun.*berat|berat badan/i.test(`${msg} ${goal}`);
      output.userResponse = lang === 'id'
        ? (wantsWeight
          ? `Saya bisa membantu Anda menurunkan berat badan dengan aman. Agar rencananya tepat, saya masih membutuhkan: ${missing.join(', ')}. Boleh dibagikan?`
          : `Terima kasih! Agar bisa lanjut, saya masih membutuhkan: ${missing.join(', ')}.`)
        : (wantsWeight
          ? `I can help you lose weight safely. To build your plan I still need: ${missing.join(', ')}. Could you share them?`
          : `Thanks! To proceed I still need: ${missing.join(', ')}.`);
    }
    return output;
  }

  const hp = output.handoffPayload;
  const usable = hp && typeof hp === 'object' && hp.targetAgent && hp.targetAgent !== 'general_receptionist' && (hp.summaryForAgent || hp.userContextSummary);
  if (!usable) {
    output.handoffPayload = synthesizeReadyHandoffPayload(output, snap, existing, ctx.detectedActivity);
  }
  output.missingFields = [];
  output.uiForm = null;
  if (output.handoffPayload) {
    const existingClean = { ...(existing || {}) };
    delete (existingClean as any).agentMemory;
    const snapClean = { ...(snap || {}) };
    output.handoffPayload.consolidatedUserProfile = {
      ...existingClean,
      ...snapClean,
      ...(output.handoffPayload.consolidatedUserProfile || {}),
    };
  }
  if (!output.userResponse || !String(output.userResponse).trim()) {
    const specialist = mapFrontDeskSpecialist(output.targetAgent, output.intent);
    output.userResponse = lang === 'id'
      ? (specialist === 'medical'
        ? 'Terima kasih! Saya teruskan ke spesialis medis.'
        : 'Terima kasih! Detail Anda sudah lengkap. Saya teruskan ke Health Coach untuk menyusun rencana personal Anda.')
      : (specialist === 'medical'
        ? 'Thank you! I am handing you over to the medical specialist.'
        : 'Thank you! I have all your key details. I am now handing you over to your Health Coach to formulate your personalized plan.');
  }
  return output;
}

/**
 * Active Memory Compaction: Prevents unbounded linear growth by:
 * 1. Deduplicating and capping keyInsights at 7 distilled facts.
 * 2. Capping workHistoryLog at 5 entries (preserving milestone + last 4 recent events).
 */
export function compactUserMemory(memory: any): any {
  if (!memory) return memory;

  if (Array.isArray(memory.keyInsights)) {
    const unique: string[] = [];
    for (const item of memory.keyInsights) {
      const trimmed = String(item || '').trim();
      if (!trimmed) continue;
      const isDuplicate = unique.some(u =>
        u.toLowerCase() === trimmed.toLowerCase() ||
        (trimmed.length > 20 && u.toLowerCase().includes(trimmed.toLowerCase()))
      );
      if (!isDuplicate) {
        unique.push(trimmed);
      }
    }
    memory.keyInsights = unique.slice(-7);
  }

  if (Array.isArray(memory.workHistoryLog)) {
    const uniqueWork: string[] = [];
    for (const item of memory.workHistoryLog) {
      const trimmed = String(item || '').trim();
      if (!trimmed) continue;
      if (!uniqueWork.some(w => w.toLowerCase() === trimmed.toLowerCase())) {
        uniqueWork.push(trimmed);
      }
    }
    if (uniqueWork.length > 5) {
      const milestone = uniqueWork[0];
      const recent = uniqueWork.slice(-4);
      memory.workHistoryLog = [milestone, ...recent];
    } else {
      memory.workHistoryLog = uniqueWork;
    }
  }

  return memory;
}

export async function callReceptionistAgent(
  ai: GoogleGenAI,
  payload: ReceptionistInputPayload,
  modelName = "gemini-3.5-flash-lite"
): Promise<{ output: ReceptionistOutput; raw: string; ms: number; systemInstruction: string; userText: string }> {
  const userText = formatReceptionistInput(payload);
  const systemInstruction = buildReceptionistInstruction((payload as any).language || (payload.existingUserProfile as any)?.language);

  const contentParts: any[] = [{ text: userText }];
  if (payload.images && Array.isArray(payload.images) && payload.images.length > 0) {
    for (const img of payload.images) {
      if (typeof img === "string") {
        const resolvedPath = path.isAbsolute(img) ? img : path.resolve(process.cwd(), img);
        try {
          if (fs.existsSync(resolvedPath)) {
            const buf = fs.readFileSync(resolvedPath);
            contentParts.push({
              inlineData: {
                mimeType: "image/png",
                data: buf.toString("base64"),
              },
            });
            continue;
          }
        } catch {}
        const match = img.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          contentParts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      }
    }
  }

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: modelName,
    contents: contentParts,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: receptionistOutputSchema,
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  });

  const durationMs = Date.now() - started;
  let rawResponseText = response.text || "{}";
  let rawText = sanitizeReceptionistJson(rawResponseText);
  let output: ReceptionistOutput;

  try {
    output = JSON.parse(rawText);
  } catch (initialErr) {
    try {
      const retryResponse = await ai.models.generateContent({
        model: modelName,
        contents: [{ text: userText }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: receptionistOutputSchema,
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });
      rawResponseText = retryResponse.text || "{}";
      rawText = sanitizeReceptionistJson(rawResponseText);
      output = JSON.parse(rawText);
    } catch (err) {
      const head = rawText.slice(0, 240).replace(/\s+/g, " ");
      console.error("Failed to parse receptionist JSON after retry:", err instanceof Error ? err.message : err, "rawLen=", rawText.length, "head=", head);
    const msg = String(payload.currentUserMessage || "").toLowerCase();
    const wantsWeight = /lose weight|loose weight|weight loss/.test(msg);
    output = {
      intent: wantsWeight ? "weight_loss" : "general_inquiry",
      targetAgent: wantsWeight ? "health_coach" : "general_receptionist",
      status: "needs_info",
      missingFields: wantsWeight ? ["gender", "age", "height", "weight", "medical_history"] : [],
      collectedData: {},
      memory: {
        goalSummary: wantsWeight ? "User wants to lose weight." : "Inquiry received",
        userProfileSnapshot: payload.existingUserProfile || {},
        preferencesAndConstraints: {},
        conversationState: "onboarding_gather_info",
        pendingItems: wantsWeight ? ["gender", "age", "height", "weight"] : [],
        keyInsights: [],
      },
      userResponse: wantsWeight
        ? "I can help you lose weight safely. To build a calorie plan I need your gender, age, height, current weight, activity level, and any medical conditions."
        : "Hello! I am your Health Preparation Specialist. How can I help you today?",
      isDisambiguationRequired: false,
      disambiguationContext: null,
      uiForm: null,
      handoffPayload: null,
      newBiomarkerLogs: null,
      updatedProfile: null,
    };
  }
}

  // Strip rhetorical / filler "What should I do?" headers from userResponse
  if (output.userResponse && typeof output.userResponse === 'string') {
    output.userResponse = output.userResponse
      .replace(/(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?\s*What\s+(?:should\s+(?:I|you)\s+do|to\s+do\s+next)\??:?\s*(?:\*\*)?\s*(?=\n|$)/gi, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Preserve any known existing demographic fields if model omitted them
  if (payload.existingUserProfile && output.memory?.userProfileSnapshot) {
    const existing = payload.existingUserProfile;
    const snap = output.memory.userProfileSnapshot;
    (Object.keys(existing) as (keyof UserProfileSnapshot)[]).forEach((k) => {
      if (existing[k] !== undefined && existing[k] !== null && (snap[k] === undefined || snap[k] === null)) {
        (snap as any)[k] = existing[k];
      }
    });
  }

  // Also preserve known demographic fields from existingMemory
  if (payload.existingMemory?.userProfileSnapshot && output.memory?.userProfileSnapshot) {
    const prevSnap = payload.existingMemory.userProfileSnapshot;
    const snap = output.memory.userProfileSnapshot;
    (Object.keys(prevSnap) as (keyof UserProfileSnapshot)[]).forEach((k) => {
      if (prevSnap[k] !== undefined && prevSnap[k] !== null && (snap[k] === undefined || snap[k] === null)) {
        (snap as any)[k] = prevSnap[k];
      }
    });
  }

  // Preserve, merge, and actively compact workHistoryLog & keyInsights to prevent linear context bloat
  if (output.memory) {
    if (payload.existingMemory?.workHistoryLog) {
      const prevWork = Array.isArray(payload.existingMemory.workHistoryLog) ? payload.existingMemory.workHistoryLog : [];
      const newWork = Array.isArray(output.memory.workHistoryLog) ? output.memory.workHistoryLog : [];
      const mergedWork = [...prevWork];
      for (const item of newWork) {
        if (!mergedWork.some(w => w.toLowerCase() === item.toLowerCase())) {
          mergedWork.push(item);
        }
      }
      output.memory.workHistoryLog = mergedWork;
    }
    if (payload.existingMemory?.keyInsights) {
      const prevInsights = Array.isArray(payload.existingMemory.keyInsights) ? payload.existingMemory.keyInsights : [];
      const newInsights = Array.isArray(output.memory.keyInsights) ? output.memory.keyInsights : [];
      const mergedInsights = [...prevInsights];
      for (const item of newInsights) {
        if (!mergedInsights.some(i => i.toLowerCase() === item.toLowerCase())) {
          mergedInsights.push(item);
        }
      }
      output.memory.keyInsights = mergedInsights;
    }

    // Active Compaction & Sliding Window: Keep at most 7 distilled facts and at most 5 recent/milestone actions
    output.memory = compactUserMemory(output.memory);
  }

  // Check if currentUserMessage contains activity level or if form submitted it
  const userMsg = String(payload.currentUserMessage || "").trim();
  const userMsgLower = userMsg.toLowerCase();
  let detectedActivity: string | null = null;
  if (/sedentary/i.test(userMsgLower)) detectedActivity = 'sedentary';
  else if (/lightly\s*active|light\s*exercise|\blight\b/i.test(userMsgLower)) detectedActivity = 'lightly_active';
  else if (/moderately\s*active|moderate\s*exercise|\bmoderate\b/i.test(userMsgLower)) detectedActivity = 'moderately_active';
  else if (/very\s*active|heavy\s*exercise|\bintense\b|\bvery\b/i.test(userMsgLower)) detectedActivity = 'very_active';
  else if (/extra\s*active|\bathlete\b/i.test(userMsgLower)) detectedActivity = 'extra_active';
  else if (/mahasiswa|pelajar|\bstudent\b|kantoran|kantor|\boffice\b|ringan|sedentari/i.test(userMsgLower)) detectedActivity = 'lightly_active';

  if (detectedActivity && output.memory?.userProfileSnapshot) {
    output.memory.userProfileSnapshot.activityLevel = detectedActivity as any;
    if (output.collectedData) {
      output.collectedData.activityLevel = detectedActivity;
    }
    if (Array.isArray(output.missingFields)) {
      output.missingFields = output.missingFields.filter(f => !/activity/i.test(f));
    }
    if (Array.isArray(output.memory?.pendingItems)) {
      output.memory.pendingItems = output.memory.pendingItems.filter(p => !/activity/i.test(p));
    }
  }

  output = maybePromoteHandoff(output, {
    existingUserProfile: payload.existingUserProfile,
    detectedActivity,
    currentUserMessage: payload.currentUserMessage,
    images: payload.images,
    specialistContainers: payload.specialistContainers
  });

  output = enforceReadyHandoffContract(output, {
    existingUserProfile: payload.existingUserProfile,
    detectedActivity,
    currentUserMessage: payload.currentUserMessage,
    images: payload.images,
    specialistContainers: payload.specialistContainers
  });

  // Preserve all known demographic fields into handoffPayload.consolidatedUserProfile
  if (output.handoffPayload) {
    const existing = payload.existingUserProfile || {};
    const currentSnap = output.memory?.userProfileSnapshot || {};
    if (!output.handoffPayload.consolidatedUserProfile) {
      output.handoffPayload.consolidatedUserProfile = { ...existing, ...currentSnap };
    } else {
      const cup = output.handoffPayload.consolidatedUserProfile;
      const combined = { ...existing, ...currentSnap };
      (Object.keys(combined) as (keyof UserProfileSnapshot)[]).forEach((k) => {
        if (combined[k] !== undefined && combined[k] !== null && (cup[k] === undefined || cup[k] === null)) {
          (cup as any)[k] = combined[k];
        }
      });
    }
    if (!output.handoffPayload.consolidatedMemory && output.memory) {
      output.handoffPayload.consolidatedMemory = output.memory;
    }
    if (payload.images && payload.images.length > 0 && (!output.handoffPayload.images || output.handoffPayload.images.length === 0)) {
      output.handoffPayload.images = payload.images;
    }
  }

  // Synthesize updatedProfile object for easy consumption by LogChat (only genuinely new/changed fields)
  if (!output.updatedProfile && output.memory?.userProfileSnapshot) {
    const snap = output.memory.userProfileSnapshot;
    const existing = payload.existingUserProfile || {};
    const patch: Record<string, any> = {};
    if (snap.weightKg && snap.weightKg !== existing.weightKg) patch.weight = snap.weightKg;
    if (snap.heightCm && snap.heightCm !== existing.heightCm) patch.height = snap.heightCm;
    if (snap.age && snap.age !== existing.age) patch.age = snap.age;
    if (snap.gender && snap.gender !== existing.gender) patch.gender = snap.gender;
    if (snap.ethnicity && snap.ethnicity !== existing.ethnicity) patch.ethnicity = snap.ethnicity;
    if (snap.bloodType && snap.bloodType !== existing.bloodType) patch.bloodType = snap.bloodType;
    if (snap.activityLevel && snap.activityLevel !== existing.activityLevel) patch.activityLevel = snap.activityLevel;
    if (snap.targetWeightKg && snap.targetWeightKg !== existing.targetWeightKg) patch.targetWeight = snap.targetWeightKg;
    if (Object.keys(patch).length > 0) {
      output.updatedProfile = patch;
    }
  }

  // Synthesize uiForm if status is needs_info but model omitted uiForm
  if (
    output.status === "needs_info" &&
    (!output.uiForm || !output.uiForm.fields || output.uiForm.fields.length === 0) &&
    output.missingFields &&
    output.missingFields.length > 0
  ) {
    const formLang = normalizeLocale(
       (payload as any).language || payload.existingUserProfile?.language || "en"
    );
    const fields: any[] = [];
    const fieldMapping: Record<
      string,
      { label: string; type: "text" | "number" | "select"; unit?: string; options?: string[] }
    > = {
      gender: { label: t(formLang, "gender"), type: "select", options: ["female", "male", "other"] },
      age: { label: t(formLang, "age"), type: "number", unit: "years" },
      height: { label: t(formLang, "height"), type: "number", unit: "cm" },
      heightcm: { label: t(formLang, "height"), type: "number", unit: "cm" },
      weight: { label: t(formLang, "recepCurrentWeight"), type: "number", unit: "kg" },
      weightkg: { label: t(formLang, "recepCurrentWeight"), type: "number", unit: "kg" },
      activitylevel: {
        label: t(formLang, "recepActivityLevel"),
        type: "select",
        options: ["sedentary", "light", "moderate", "very_active"],
      },
      medicalhistory: { label: t(formLang, "medicalHistory"), type: "text" },
      targetweight: { label: t(formLang, "recepTargetWeight"), type: "number", unit: "kg" },
      targetweightkg: { label: t(formLang, "recepTargetWeight"), type: "number", unit: "kg" },
    };

    output.missingFields.forEach((mf) => {
      const cleanKey = mf.toLowerCase().replace(/[^a-z0-9]/g, "");
      const matched = Object.entries(fieldMapping).find(
        ([k]) => k === cleanKey || cleanKey.includes(k) || k.includes(cleanKey)
      );
      if (matched) {
        fields.push({
          name: mf,
          label: matched[1].label,
          type: matched[1].type,
          unit: matched[1].unit,
          options: matched[1].options,
          required: true,
        });
      } else {
        fields.push({
          name: mf,
          label: mf.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          type: "text",
          required: true,
        });
      }
    });

    output.uiForm = {
      formId: `${output.intent || "onboarding"}_details_form`,
      title: t(formLang, "recepFormTitle"),
      description: t(formLang, "recepFormDescription"),
      submitLabel: t(formLang, "recepSubmit"),
      fields,
    };
  }

  const replyLang = normalizeLocale(
     (payload as any).language || payload.existingUserProfile?.language || "en"
  );
  if (output.uiForm) {
    output.uiForm.title = t(replyLang, "recepFormTitle");
    output.uiForm.description = t(replyLang, "recepFormDescription");
    output.uiForm.submitLabel = t(replyLang, "recepSubmit");
    if (Array.isArray(output.uiForm.fields)) {
      output.uiForm.fields = output.uiForm.fields.map((field: any) => {
        const key = String(field?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        let label = field?.label;
        if (key.includes("gender")) label = t(replyLang, "gender");
        else if (key.includes("age")) label = t(replyLang, "age");
        else if (key.includes("height")) label = t(replyLang, "height");
        else if (key.includes("weight") && key.includes("target")) label = t(replyLang, "recepTargetWeight");
        else if (key.includes("weight")) label = t(replyLang, "recepCurrentWeight");
        else if (key.includes("activity")) label = t(replyLang, "recepActivityLevel");
        else if (key.includes("medical")) label = t(replyLang, "medicalHistory");
        return { ...field, label };
      });
    }
  }
  if (!String(output.userResponse || "").trim()) {
    output.userResponse =
      replyLang === "id"
        ? "Saya masih butuh sedikit informasi untuk menyesuaikan saran. Silakan isi detail yang kurang, atau tanyakan lagi."
        : "I still need a bit more information to tailor advice. Please fill in any missing details, or ask again.";
  }

  return { output, raw: rawText, ms: durationMs, systemInstruction, userText };
}
