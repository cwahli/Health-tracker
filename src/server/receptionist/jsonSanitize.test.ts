import { describe, expect, it } from "vitest";
import { sanitizeReceptionistJson } from "./call_agent.js";

describe("sanitizeReceptionistJson", () => {
  it("repairs runaway weightKg decimals so JSON.parse succeeds", () => {
    const raw = "{\"weightKg\":" + "74." + "0".repeat(80) + ",\"intent\":\"weight_loss\"}";
    const parsed = JSON.parse(sanitizeReceptionistJson(raw));
    expect(parsed.weightKg).toBe(74);
    expect(parsed.intent).toBe("weight_loss");
  });

  it("repairs truncated JSON cut off inside a string literal", () => {
    const raw = '{ "intent": "weight_loss", "targetAgent": "health_coach", "status": "ready_for_handoff", "missingFields": [], "memory": { "goalSummary": "Achieve sustainable weight loss with a personalized plan based on a sedentary activity l';
    const parsed = JSON.parse(sanitizeReceptionistJson(raw));
    expect(parsed.intent).toBe("weight_loss");
    expect(parsed.targetAgent).toBe("health_coach");
    expect(parsed.status).toBe("ready_for_handoff");
    expect(parsed.memory.goalSummary).toContain("Achieve sustainable weight loss");
  });

  it("repairs truncated JSON cut off at a trailing key/colon", () => {
    const raw = '{ "intent": "weight_loss", "targetAgent": "health_coach", "status": "ready_for_handoff", "memory": { "goalSummary":';
    const parsed = JSON.parse(sanitizeReceptionistJson(raw));
    expect(parsed.intent).toBe("weight_loss");
    expect(parsed.targetAgent).toBe("health_coach");
  });
});
