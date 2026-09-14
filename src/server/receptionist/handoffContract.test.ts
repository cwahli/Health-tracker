import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { enforceReadyHandoffContract, maybePromoteHandoff, synthesizeReadyHandoffPayload, formatReceptionistInput, compactUserMemory } from "./call_agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UC02 = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../prototype/receptionist/benchmark/UC-02.json"), "utf-8")
);

const completeProfile = {
  age: 43,
  gender: "Male",
  heightCm: 163,
  weightKg: 60,
  activityLevel: "sedentary"
};

function runPostProcessor(output: any, ctx: { currentUserMessage?: string; existingUserProfile?: any }) {
  const promoted = maybePromoteHandoff({ ...output }, ctx);
  return enforceReadyHandoffContract(promoted, ctx);
}

describe("enforceReadyHandoffContract", () => {
  it("downgrades to needs_info when model emits ready_for_handoff without demographics", () => {
    const rawOutput: any = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "ready_for_handoff",
      handoffPayload: null,
      memory: {
        goalSummary: "I want to loose weight",
        userProfileSnapshot: {}
      },
      userResponse: ""
    };

    const repaired = enforceReadyHandoffContract(rawOutput, {
      currentUserMessage: "I want to loose weight",
      existingUserProfile: null
    });

    expect(repaired.status).toBe("needs_info");
    expect(repaired.handoffPayload).toBeNull();
    expect(repaired.missingFields).toContain("age");
    expect(repaired.missingFields).toContain("gender");
    expect(repaired.missingFields).toContain("height");
    expect(repaired.missingFields).toContain("weight");
    expect(repaired.userResponse).toContain("lose weight");
  });

  it("synthesizes handoffPayload when demographics are complete", () => {
    const rawOutput: any = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "ready_for_handoff",
      handoffPayload: null,
      memory: {
        goalSummary: "Lose weight sustainably",
        userProfileSnapshot: {
          age: 28,
          gender: "female",
          heightCm: 165,
          weightKg: 62,
          activityLevel: "moderately_active"
        }
      }
    };

    const repaired = enforceReadyHandoffContract(rawOutput, {
      currentUserMessage: "Here are my stats",
      existingUserProfile: null
    });

    expect(repaired.status).toBe("ready_for_handoff");
    expect(repaired.handoffPayload).toBeTruthy();
    expect(repaired.handoffPayload.targetAgent).toBe("health_coach");
    expect(repaired.handoffPayload.summaryForAgent).toContain("Age: 28");
    expect(repaired.handoffPayload.summaryForAgent).toContain("Weight: 62kg");
    expect(repaired.userResponse).toContain("Health Coach");
  });

  it("leaves non-ready outputs untouched", () => {
    const rawOutput: any = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: ["age", "weight"]
    };

    const repaired = enforceReadyHandoffContract(rawOutput, {});
    expect(repaired.status).toBe("needs_info");
    expect(repaired.missingFields).toEqual(["age", "weight"]);
  });
});

describe("maybePromoteHandoff + contract (U0 / C1 / C5)", () => {
  it("U0: 'i want' with a complete profile stays at Front Desk", () => {
    const raw = {
      intent: "general_wellness",
      targetAgent: "general_receptionist",
      status: "needs_info",
      missingFields: [],
      handoffPayload: null,
      userResponse: "It looks like your sentence got cut off. How can I help you today?",
      uiForm: { formId: "general_inquiry_form", fields: [{ name: "goal" }] },
      memory: { goalSummary: "Explore available health services.", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "i want",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("needs_info");
    expect(out.targetAgent).toBe("general_receptionist");
    expect(out.handoffPayload).toBeNull();
    expect(out.userResponse).toMatch(/cut off/i);
    expect(out.uiForm?.formId).toBe("general_inquiry_form");
  });

  it("C1 empty profile: weight loss stays needs_info", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: ["age", "gender", "height", "weight"],
      handoffPayload: null,
      memory: { goalSummary: "User wants to lose weight.", userProfileSnapshot: {} }
    };
    const out = runPostProcessor(raw, { currentUserMessage: "I want to loose weight", existingUserProfile: null });
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
  });

  it("C1b: weight_loss + complete demographics promotes to health_coach", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: [],
      handoffPayload: null,
      memory: { goalSummary: "Lose weight sustainably", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "Here are my stats: 43, male, 163cm, 60kg, sedentary",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("ready_for_handoff");
    expect(out.targetAgent).toBe("health_coach");
    expect(out.handoffPayload).toBeTruthy();
  });

  it("Existing user with complete profile sending bare 'I want to loose weight' stays at Front Desk to establish target weight", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "ready_for_handoff",
      missingFields: [],
      handoffPayload: { targetAgent: "health_coach" },
      memory: { goalSummary: "User wants to loose weight", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "I want to loose weight",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("needs_info");
    expect(out.targetAgent).toBe("general_receptionist");
    expect(out.handoffPayload).toBeNull();
    expect(out.userResponse).toContain("BMI");
    expect(out.missingFields).toContain("target_weight");
  });

  it("C5: disambiguation is not auto-promoted even with complete demographics", () => {
    const raw = {
      intent: "weight_loss",
      targetAgent: "health_coach",
      status: "needs_info",
      isDisambiguationRequired: true,
      handoffPayload: null,
      memory: { goalSummary: "Crash diet", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "I want to crash diet and lose 10kg in 10 days",
      existingUserProfile: completeProfile
    });
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
  });

  it("does not rewrite general_receptionist to health_coach just because demographics exist", () => {
    const raw = {
      intent: "general_wellness",
      targetAgent: "general_receptionist",
      status: "needs_info",
      handoffPayload: null,
      memory: { goalSummary: "Be healthy", userProfileSnapshot: completeProfile }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: "i just want to be healthy",
      existingUserProfile: completeProfile
    });
    expect(out.targetAgent).toBe("general_receptionist");
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
  });
});

describe("formatReceptionistInput & Context Anchors", () => {
  it("formats system_anchors, active_biomarkers, foodLogs, and attached images cleanly", () => {
    const formatted = formatReceptionistInput({
      currentUserMessage: "Is my sodium too high?",
      chatHistory: [],
      existingUserProfile: completeProfile,
      existingMemory: {
        goalSummary: "Manage cardiovascular health",
        userProfileSnapshot: completeProfile,
        conversationState: "ongoing_support",
        pendingItems: [],
        keyInsights: ["Borderline BP 138/88"],
        lastInteractionSummary: "User asked about morning vitals.",
        workHistoryLog: ["2026-09-02: Recorded morning vitals"]
      },
      biomarkers: { blood_pressure: "138/88", ldl: 151 },
      foodLogs: [{ name: "Ramen", date: "2026-09-03", nutrients: { sodium: 1850 } }],
      biomarkerHistory: [{ date: "2026-09-02", biomarkers: { fasting_glucose: 94 } }],
      images: ["base64_data_p1", "base64_data_p2", "base64_data_p3"],
      systemCurrentDate: "2026-09-03",
      userTimezone: "America/New_York",
      language: "en"
    });

    expect(formatted).toContain("<system_anchors>");
    expect(formatted).toContain("Current System Date: 2026-09-03");
    expect(formatted).toContain("User Timezone: America/New_York");
    expect(formatted).toContain("User Language: en");
    expect(formatted).toContain("<active_biomarkers>");
    expect(formatted).toContain('"blood_pressure": "138/88"');
    expect(formatted).toContain("<recent_food_logs>");
    expect(formatted).toContain('"sodium": 1850');
    expect(formatted).toContain("<recent_biomarker_history>");
    expect(formatted).toContain('"fasting_glucose": 94');
    expect(formatted).toContain("<attached_images>");
    expect(formatted).toContain("3 clinical image(s)");
    expect(formatted).toContain("<existing_memory>");
    expect(formatted).toContain("lastInteractionSummary");
    expect(formatted).toContain("workHistoryLog");
  });
});

describe("compactUserMemory & Active Consolidation", () => {
  it("caps keyInsights at 7 and deduplicates entries", () => {
    const mem = compactUserMemory({
      keyInsights: [
        "Fact 1",
        "Fact 2",
        "Fact 2", // exact duplicate
        "Fact 3",
        "Fact 4",
        "Fact 5",
        "Fact 6",
        "Fact 7",
        "Fact 8"
      ]
    });
    expect(mem.keyInsights.length).toBe(7);
    expect(mem.keyInsights).toContain("Fact 8");
    expect(mem.keyInsights).toContain("Fact 2");
    expect(mem.keyInsights.filter((x: string) => x === "Fact 2").length).toBe(1);
  });

  it("caps workHistoryLog at 5 entries preserving oldest milestone at index 0", () => {
    const mem = compactUserMemory({
      workHistoryLog: [
        "Milestone 2026-08: Initial setup",
        "Action 1",
        "Action 2",
        "Action 3",
        "Action 4",
        "Action 5",
        "Action 6"
      ]
    });
    expect(mem.workHistoryLog.length).toBe(5);
    expect(mem.workHistoryLog[0]).toBe("Milestone 2026-08: Initial setup");
    expect(mem.workHistoryLog[4]).toBe("Action 6");
  });
});

describe("S-6 HANDOFF_I18N — UC-02 vitality turns drive the contract", () => {
  const [ucTurn1, ucTurn2] = UC02.turns;

  it("UC-02 turn 1 (vague wellness ask, new user) stays needs_info with demographic gaps", () => {
    const t1 = ucTurn1.expectedOutput;
    const raw = {
      intent: t1.intent,
      targetAgent: t1.targetAgent,
      status: t1.status,
      missingFields: t1.expectedMissingFields,
      handoffPayload: null,
      userResponse: "Happy to help with your health! What would you like to work on?",
      memory: { goalSummary: "User wants general health", userProfileSnapshot: {} }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: ucTurn1.userMessage,
      existingUserProfile: null
    });
    expect(out.status).toBe("needs_info");
    expect(out.handoffPayload).toBeNull();
    expect(out.missingFields).toContain("age");
    expect(out.missingFields).toContain("gender");
  });

  it("UC-02 turn 2 (complete vitality snapshot) hands off to health_coach", () => {
    const t2 = ucTurn2.expectedOutput;
    const snapshot = {
      age: 28, gender: "female", heightCm: 162, weightKg: 54,
      activityLevel: "lightly_active", language: "en"
    };
    const raw = {
      intent: t2.intent,
      targetAgent: t2.targetAgent,
      status: "needs_info",
      missingFields: [],
      handoffPayload: null,
      userResponse: "",
      memory: { goalSummary: "Afternoon energy crashes and poor sleep; improve vitality", userProfileSnapshot: snapshot }
    };
    const out = runPostProcessor(raw, {
      currentUserMessage: ucTurn2.userMessage,
      existingUserProfile: snapshot
    });
    expect(out.status).toBe(t2.status);
    expect(out.targetAgent).toBe("health_coach");
    expect(out.handoffPayload).toBeTruthy();
    expect(out.handoffPayload.targetAgent).toBe(t2.handoffValidation.targetAgent);
  });

  it("coach handoff ack follows profile language (en vs id)", () => {
    const snapshot = {
      age: 28, gender: "female", heightCm: 162, weightKg: 54,
      activityLevel: "lightly_active"
    };
    const buildRaw = () => ({
      intent: "general_wellness",
      targetAgent: "health_coach",
      status: "needs_info",
      missingFields: [],
      handoffPayload: null,
      userResponse: "",
      memory: { goalSummary: "energy and sleep vitality", userProfileSnapshot: snapshot }
    });
    const enOut = runPostProcessor(buildRaw(), {
      currentUserMessage: UC02.turns[1].userMessage,
      existingUserProfile: { ...snapshot, language: "en" }
    });
    expect(enOut.userResponse).toContain("Thank you! I have all your key details");
    const idOut = runPostProcessor(buildRaw(), {
      currentUserMessage: UC02.turns[1].userMessage,
      existingUserProfile: { ...snapshot, language: "id" }
    });
    expect(idOut.userResponse).toContain("Terima kasih! Detail Anda sudah lengkap");
    expect(idOut.userResponse).not.toContain("Thank you! I have all your key details");
  });

  it("meal-photo and lab-report acks follow profile language", () => {
    const mealRaw = () => ({
      intent: "meal_logging", targetAgent: "food", status: "needs_info",
      missingFields: [], handoffPayload: null, userResponse: "", memory: {}
    });
    const mealCtx = (language: string) => ({
      currentUserMessage: "here is my lunch bowl",
      existingUserProfile: { language },
      images: ["base64_meal"]
    });
    expect(runPostProcessor(mealRaw(), mealCtx("en")).userResponse).toContain("Food & Nutrition Agent");
    const idMeal = runPostProcessor(mealRaw(), mealCtx("id")).userResponse;
    expect(idMeal).toContain("Agen Makanan & Nutrisi");
    expect(idMeal).not.toContain("Food & Nutrition Agent");

    const labRaw = () => ({
      intent: "biomarker_review", targetAgent: "medical", status: "needs_info",
      missingFields: [], handoffPayload: null, userResponse: "", memory: {}
    });
    const labCtx = (language: string) => ({
      currentUserMessage: "please parse my blood test results",
      existingUserProfile: { language },
      images: ["base64_lab"]
    });
    expect(runPostProcessor(labRaw(), labCtx("en")).userResponse).toContain("Medical Lab Parser");
    const idLab = runPostProcessor(labRaw(), labCtx("id")).userResponse;
    expect(idLab).toContain("Pengurai Lab Medis");
    expect(idLab).not.toContain("Medical Lab Parser");
  });
});
