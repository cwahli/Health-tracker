#!/usr/bin/env npx tsx
/**
 * repro_debugmeal1_3928.ts — faithful replay of debug-job_1789920526160_7rwiexoqd.
 *
 * Working folder: prototype/meallog/meal_test_debug_1 (the "debugmeal1" folder).
 *
 * Captured chronology (from the debug breadcrumbs, not guessed):
 *   TURN 1  16:09:00  "Analyze this meal photo."                    imageCount 2
 *   TURN 2  16:12:25  "I ate half of the peanuts amount and the daun
 *                      selada krt is chicken as shown on picture"  imageCount 1
 *   3928 = turn 2's "posted for update" photo; the header Photo + final ledger
 *   (359 kcal / 535 g / 4 dishes) come from turn 2.
 *
 * All three camera files are used, all three pre-compressed to <=200KB:
 *   PXL_20260920_145102820_compressed.jpg  (turn 1)
 *   PXL_20260920_145355355_compressed.jpg  (turn 1)
 *   PXL_20260920_150613928_compressed.jpg  (turn 2 = the 3928 update photo)
 *
 * Usage:
 *   node prototype/meallog/meal_test_debug_1/compress_debugmeal1_images.mjs
 *   npx tsx prototype/meallog/meal_test_debug_1/repro_debugmeal1_3928.ts     # live Gemini
 *   REPLAY=1 npx tsx prototype/meallog/meal_test_debug_1/repro_debugmeal1_3928.ts
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { scoutSystemInstruction, parseAndHealVisionScout } from "../../../server_vision_scout.js";
import { buildVisualScoutPrompt } from "../../../agents/scoutInstructions.js";
import { finalizeDishLedger } from "../../../server_dish_finalize.js";
import { buildMealFromFinalizeLedgers, sumItemNutrients } from "../../../server_meal_from_finalize.js";
import { applyMealEdits, scaleItemNutrients } from "../../../server_meal_edit.js";

dotenv.config();

const apiKey =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.API_KEY ||
  process.env.GEMINI_API_KEYS?.split(",")[0]?.trim();

const debugDir = path.join(process.cwd(), "prototype", "meallog", "meal_test_debug_1");
const REPLAY = process.env.REPLAY === "1";
const MAX_BYTES = 200 * 1024;

const TURN1_IMAGES = ["PXL_20260920_145102820_compressed.jpg", "PXL_20260920_145355355_compressed.jpg"];
const TURN2_IMAGES = ["PXL_20260920_150613928_compressed.jpg"];
const TURN1_PROMPT = "Analyze this meal photo.";
// Verbatim from the capture's breadcrumbs (16:12:25 submit_initiated).
const TURN2_PROMPT =
  "I ate half of the peanuts amount and the daun selada krt is chicken as shown on picture";

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

function assertImagesUnderCap(files: string[]) {
  let failed = false;
  for (const f of files) {
    const p = path.join(debugDir, f);
    if (!fs.existsSync(p)) {
      console.error(`  MISSING ${f} — run compress_debugmeal1_images.mjs first`);
      failed = true;
      continue;
    }
    const size = fs.statSync(p).size;
    const ok = size <= MAX_BYTES;
    console.log(`  ${ok ? "PASS" : "FAIL"} ${f} ${(size / 1024).toFixed(1)}KB (cap 200KB)`);
    if (!ok) failed = true;
  }
  return !failed;
}

function imageParts(files: string[]) {
  return files.map((f) => ({
    inlineData: { mimeType: "image/jpeg", data: fs.readFileSync(path.join(debugDir, f)).toString("base64") },
  }));
}

async function scoutTurn(label: string, files: string[], userPrompt: string, replayFile: string) {
  const replayPath = path.join(debugDir, replayFile);
  let raw: any;
  if (REPLAY && fs.existsSync(replayPath)) {
    raw = JSON.parse(fs.readFileSync(replayPath, "utf8"));
    console.log(`[${label}] REPLAY -> ${replayFile} (no Gemini call)`);
  } else {
    if (!ai) {
      console.error("ERROR: GEMINI_API_KEY / GOOGLE_API_KEY is not set (use REPLAY=1 for captured JSON).");
      process.exit(1);
    }
    const prompt = buildVisualScoutPrompt(userPrompt, files.length);
    const t0 = Date.now();
    const res = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [{ role: "user", parts: [...imageParts(files), { text: prompt }] } as any],
      config: {
        systemInstruction: scoutSystemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
      } as any,
    });
    const text = (res as any).text?.trim() || "{}";
    const start = text.indexOf("{");
    raw = JSON.parse(start > 0 ? text.slice(start) : text);
    console.log(`[${label}] live scout ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(raw.dishes || []).length} dish(es)`);
    fs.writeFileSync(replayPath, JSON.stringify(raw, null, 2));
  }

  const healed: any = await parseAndHealVisionScout(JSON.stringify(raw), {
    userMessage: userPrompt,
    addDebugLog: () => {},
  } as any);
  const items = healed?.items || raw.dishes || raw.items || [];
  console.log(
    `[${label}] healed items (${items.length}): ` +
      items.map((i: any) => `${i.originalName || i.keyword} ${i.estimatedWeightGrams ?? i.weightGrams}g`).join(" | "),
  );
  return { raw, items, diningEnvironment: raw.diningEnvironment };
}

async function finalizeItems(items: any[], diningEnvironment?: string) {
  const ledgers: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const grams = Number(it.estimatedWeightGrams ?? it.weightGrams ?? 100) || 100;
    ledgers.push(
      await finalizeDishLedger({
        item: { ...it, scoutIndex: i },
        nutrientBasisWeight: Number(it.nutrientBasisWeight) || grams,
        consumedWeight: grams,
        diningEnvironment,
      }),
    );
  }
  return ledgers;
}

function reportFatSodium(label: string, nutrients: Record<string, any>) {
  const totalFat = Number(nutrients.totalFat) || 0;
  const sat = Number(nutrients.saturatedFat) || 0;
  const trans = Number(nutrients.transFat) || 0;
  const unsat = Number(nutrients.unsaturatedFat) || 0;
  const expectedUnsat = Math.max(0, Math.round((totalFat - sat - trans) * 10) / 10);
  const na = Number(nutrients.sodium) || 0;
  const expectedSalt = Math.round(na * 2.54) / 1000;
  console.log(
    `\n[${label}] kcal=${nutrients.calories} P=${nutrients.protein} C=${nutrients.carbohydrates} ` +
      `F=${totalFat} sat=${sat} trans=${trans} unsat=${unsat} Na=${na} salt=${nutrients.salt}`,
  );
  const unsatBad = unsat > totalFat || Math.abs(unsat - expectedUnsat) > 0.15;
  const saltBad = Math.abs((Number(nutrients.salt) || 0) - expectedSalt) > 0.02;
  console.log(`  unsat expected ${expectedUnsat} -> ${unsatBad ? "MISMATCH (bug)" : "consistent"}`);
  console.log(`  salt  expected ${expectedSalt.toFixed(2)} -> ${saltBad ? "MISMATCH (bug)" : "consistent"}`);
  return { unsatBad, saltBad };
}

async function main() {
  console.log("=".repeat(90));
  console.log("DEBUGMEAL1 REPRO — job_1789920526160_7rwiexoqd (2 turns, 3 photos, 3928 = update)");
  console.log("Model: gemini-3.5-flash-lite (repo default)");
  console.log("=".repeat(90) + "\n");

  console.log("Image budget (all source photos must be <=200KB):");
  if (!assertImagesUnderCap([...TURN1_IMAGES, ...TURN2_IMAGES])) process.exit(1);
  console.log("");

  // ---- TURN 1: two photos -> the meal that existed before the update ----
  const t1 = await scoutTurn("turn1", TURN1_IMAGES, TURN1_PROMPT, "repro-turn1-scout-raw.json");
  const t1Ledgers = await finalizeItems(t1.items, t1.diningEnvironment);
  const mealA = buildMealFromFinalizeLedgers(t1Ledgers, {});
  console.log("\n--- TURN 1 LEDGER (meal before the update) ---");
  for (const l of t1Ledgers) {
    const n = l.nutrients || {};
    console.log(
      `  ${l.originalName} ${l.weightGrams}g: kcal=${n.calories} P=${n.protein} C=${n.carbohydrates} ` +
        `F=${n.totalFat} sat=${n.saturatedFat} unsat=${n.unsaturatedFat} Na=${n.sodium}`,
    );
  }
  reportFatSodium("turn1 total", mealA.nutrients as any);

  // ---- TURN 2: 3928 photo + the verbatim edit instruction ----
  console.log("\n--- TURN 2 (3928 photo + verbatim instruction) ---");
  await scoutTurn("turn2", TURN2_IMAGES, TURN2_PROMPT, "repro-turn2-scout-raw.json");

  // Resolve the target by the meal's own name (the ledger uses the sticker name
  // verbatim, e.g. "DAUN SELADA KRT"), so the replace path actually fires.
  const seladaName =
    mealA.items.find((it: any) => /selada|lettuce/i.test(String(it.name || it.originalName || "")))?.name ||
    "Daun Selada Krt";
  const editCommands: any[] = [
    { action: "replace_identity", itemName: seladaName, newItemName: "Ayam Rebus", newWeightGrams: 165 },
  ];
  const itemsAfterHalf = mealA.items.map((it: any) =>
    /peanut|kcg/i.test(String(it.name || it.originalName || "")) ? scaleItemNutrients(it, 0.5, 105) : it,
  );
  const edited: any = applyMealEdits(itemsAfterHalf, editCommands, { userMessage: TURN2_PROMPT });
  const editedItems = edited?.items || itemsAfterHalf;
  console.log(
    `[turn2] edit commands: ${JSON.stringify(editCommands)}`,
  );
  console.log(
    `[turn2] item names after edit: ${editedItems.map((i: any) => `${i.name || i.originalName}`).join(" | ")}`,
  );
  if (Array.isArray(edited?.notes) && edited.notes.length > 0) {
    console.log(`[turn2] notes: ${edited.notes.join(" ; ")}`);
  }
  const mealB = {
    items: editedItems,
    nutrients: sumItemNutrients(editedItems),
    weightGrams: Math.round(editedItems.reduce((a: number, i: any) => a + (Number(i.weightGrams) || 0), 0)),
  };

  console.log("\n--- TURN 2 LEDGER (what the card and debug table read) ---");
  for (const it of editedItems) {
    const n = it.nutrients || {};
    console.log(
      `  ${it.name || it.originalName} ${it.weightGrams}g: kcal=${n.calories} P=${n.protein} C=${n.carbohydrates} ` +
        `F=${n.totalFat} sat=${n.saturatedFat} unsat=${n.unsaturatedFat} Na=${n.sodium} salt=${n.salt}`,
    );
  }
  const check = reportFatSodium("turn2 total", mealB.nutrients as any);

  console.log(
    "\nCapture for comparison: 359 kcal / 535 g / 4 dishes, F=3.4 sat=2.7 -> unsat must be 0.7;" +
      " the capture printed 29.2 (DERIVED_STALE).",
  );
  console.log(
    `Replay turn 2: ${mealB.weightGrams}g, F=${mealB.nutrients.totalFat} sat=${mealB.nutrients.saturatedFat} unsat=${mealB.nutrients.unsaturatedFat}`,
  );

  fs.writeFileSync(
    path.join(debugDir, "repro-debugmeal1-result.json"),
    JSON.stringify(
      {
        turn1: { ledgers: t1Ledgers, nutrients: mealA.nutrients },
        turn2: { items: editedItems, nutrients: mealB.nutrients },
        derivedCheck: check,
      },
      null,
      2,
    ),
  );
  console.log("\nWrote repro-debugmeal1-result.json");
  console.log(
    check.unsatBad || check.saltBad
      ? "RESULT: derived-value bug PRESENT"
      : "RESULT: derived values consistent (invariant holds)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
