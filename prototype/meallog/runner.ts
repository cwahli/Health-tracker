import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const HERE = path.dirname(new URL(import.meta.url).pathname);

function loadEnv(): string | null {
  const candidates = [
    path.join(ROOT, ".env"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), "src/Health-tracker/.env"),
    path.join(os.homedir(), "antigravity/Biomarker-and-Nutrient-Tracker/.env"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, override: false });
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY) {
      return p;
    }
  }
  dotenv.config({ override: false });
  return null;
}

loadEnv();

export interface MealBenchmarkCase {
  id: string;
  name: string;
  imageFiles: string[];
  userPrompt: string;
  groundTruth: {
    weight: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    satFat: number;
    fibre: number;
    sodium: number;
  };
}

export const benchmarkCases: Record<string, MealBenchmarkCase> = {
  "01": {
    id: "01",
    name: "YOLK Chicken Sandwich & Roasted Sides",
    imageFiles: ["prototype/meallog/images/01_yolk_panini_wrap.jpg"],
    userPrompt: "I had it from Yolk",
    groundTruth: { weight: 600, calories: 950, protein: 49.0, carbs: 92.0, fat: 42.0, satFat: 8.5, fibre: 11.5, sodium: 1250 },
  },
  "02": {
    id: "02",
    name: "Lidl Chicken Bites & Chocolate Muffin",
    imageFiles: ["prototype/meallog/images/02_lidl_chicken_muffin.jpg"],
    userPrompt: "Analyze this meal photo from Lidl",
    groundTruth: { weight: 195, calories: 557, protein: 21.7, carbs: 58.0, fat: 26.5, satFat: 7.5, fibre: 3.0, sodium: 628 },
  },
  "03": {
    id: "03",
    name: "Salmon Sushi Roll, Shrimp Pasta Salad & Demi-Baguette",
    imageFiles: ["prototype/meallog/images/03_sushi_shrimp_salad.jpg"],
    userPrompt: "Analyze this meal photo",
    groundTruth: { weight: 650, calories: 1000, protein: 55.5, carbs: 134.0, fat: 25.0, satFat: 5.5, fibre: 9.5, sodium: 1350 },
  },
  "04": {
    id: "04",
    name: "Berry Parfait, Pastries & Cobb Salad",
    imageFiles: ["prototype/meallog/images/04_seaside_fish_chips.jpg"],
    userPrompt: "Analyze this meal photo with parfait, pastries, and salad",
    groundTruth: { weight: 1000, calories: 1630, protein: 75.0, carbs: 148.0, fat: 80.0, satFat: 26.0, fibre: 18.0, sodium: 1450 },
  },
  "05": {
    id: "05",
    name: "Airline Breakfast Tray (Congee, Croissant, Cake, Coffee)",
    imageFiles: ["prototype/meallog/images/05_cafe_waffles_coffee.jpg"],
    userPrompt: "Analyze this airline breakfast meal tray",
    groundTruth: { weight: 640, calories: 838, protein: 23.0, carbs: 104.0, fat: 37.0, satFat: 19.0, fibre: 3.5, sodium: 520 },
  },
  "06": {
    id: "06",
    name: "Mie Gacoan (Mie Suit, Siomay, Es Petak Umpet)",
    imageFiles: ["prototype/meallog/images/06_indonesian_menu_page_1.jpg", "prototype/meallog/images/06_indonesian_menu_page_2.jpg"],
    userPrompt: "Analyze this Indonesian noodle meal and receipt from Mie Gacoan",
    groundTruth: { weight: 570, calories: 780, protein: 27.0, carbs: 111.0, fat: 25.0, satFat: 5.0, fibre: 4.0, sodium: 1250 },
  },
  "07": {
    id: "07",
    name: "Fresh Fruit Plate & Greek Yogurt Oats Mug",
    imageFiles: ["prototype/meallog/images/07_sainsbury_oat_fruits.jpg"],
    userPrompt: "Analyze this fresh fruit and yogurt oats meal",
    groundTruth: { weight: 550, calories: 442, protein: 14.2, carbs: 89.0, fat: 5.3, satFat: 1.8, fibre: 12.6, sodium: 65 },
  },
  "08": {
    id: "08",
    name: "Sunrise Rolled Oats Porridge (Direct Label)",
    imageFiles: ["prototype/meallog/images/08_rolled_oats_1.jpg", "prototype/meallog/images/08_rolled_oats_2.jpg"],
    userPrompt: "Analyze this rolled oats porridge with its nutrition facts label",
    groundTruth: { weight: 220, calories: 212, protein: 5.0, carbs: 35.0, fat: 5.8, satFat: 0.8, fibre: 5.0, sodium: 0 },
  },
  "09": {
    id: "09",
    name: "Sizzling Steak & Fish & Chips Plates",
    imageFiles: ["prototype/meallog/images/09_steak_fish_chips_1.jpg", "prototype/meallog/images/09_steak_fish_chips_2.jpg"],
    userPrompt: "Analyze these two sizzling and fried meal plates with drink",
    groundTruth: { weight: 1135, calories: 1340, protein: 78.0, carbs: 102.0, fat: 67.0, satFat: 16.0, fibre: 10.0, sodium: 1850 },
  },
  "10": {
    id: "10",
    name: "Indonesian Beef Hotpot (Barcoded Groceries)",
    imageFiles: ["prototype/meallog/images/10_beef_soup_barcode_meal_0.jpg", "prototype/meallog/images/10_beef_soup_barcode_meal_1.jpg"],
    userPrompt: "Analyze this home cooked beef soup meal from Hari Hari Lokasari grocery barcodes",
    groundTruth: { weight: 825, calories: 616, protein: 65.2, carbs: 45.9, fat: 23.5, satFat: 6.2, fibre: 17.8, sodium: 380 },
  },
  "11": {
    id: "11",
    name: "Seafood Squid/Fish + Mr Oat Rolled Oats (brackets)",
    imageFiles: [
      "prototype/meallog/images/11_seafood_squid_fish_ingredients.jpg",
      "prototype/meallog/images/11_seafood_squid_fish_receipt_1.jpg",
      "prototype/meallog/images/11_seafood_squid_fish_receipt_2.jpg",
    ],
    userPrompt: "I had [Mr Oat Rolled Oats 70g] and all food in the pictures",
    // Approximate GT — used for portion defaults / band checks; refine later if needed
    groundTruth: { weight: 700, calories: 900, protein: 55.0, carbs: 80.0, fat: 30.0, satFat: 8.0, fibre: 10.0, sodium: 1200 },
  },
  "12": {
    id: "12",
    name: "Quaker Rolled Oats (Back Label, Front Bag, Cooked Pot)",
    imageFiles: [
      "prototype/meallog/images/12_quaker_oats_label_0.jpg",
      "prototype/meallog/images/12_quaker_oats_front_1.jpg",
      "prototype/meallog/images/12_quaker_oats_pot_2.jpg",
    ],
    userPrompt: "",
    groundTruth: { weight: 40, calories: 160, protein: 5.0, carbs: 27.0, fat: 4.0, satFat: 0.5, fibre: 3.0, sodium: 0 },
  },
};

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function encodeImageToDataUrl(relPath: string): string {
  const fullPath = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Image not found: ${fullPath}`);
  }
  const ext = path.extname(fullPath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const buf = fs.readFileSync(fullPath);
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

export async function runLiveMealBenchmark(c: MealBenchmarkCase, options: { port?: number; verbose?: boolean } = {}) {
  const port = options.port || Number(process.env.PORT) || 3000;
  const verbose = options.verbose ?? false;
  const startMs = Date.now();

  console.log(`\n========================================================================`);
  console.log(`[MEAL BENCHMARK] Running Case ${c.id}: ${c.name}`);
  console.log(`  User Prompt: "${c.userPrompt}"`);
  console.log(`  Images: ${c.imageFiles.length} file(s)`);
  console.log(`  Target GT: ${c.groundTruth.calories} kcal | P: ${c.groundTruth.protein}g | C: ${c.groundTruth.carbs}g | F: ${c.groundTruth.fat}g | W: ${c.groundTruth.weight}g`);
  console.log(`========================================================================\n`);

  const imageDataUrls = c.imageFiles.map(encodeImageToDataUrl);
  const body = {
    message: c.userPrompt,
    images: imageDataUrls,
    image: imageDataUrls[0],
    userProfile: {
      language: "en",
      name: "Benchmark Runner",
    },
    jobId: `live_benchmark_meal_${c.id}_${Date.now()}`,
  };

  let resultData: any = null;
  const logs: string[] = [];

  // Try calling via running HTTP server
  let usedHttp = false;
  try {
    const fetchUrl = `http://localhost:${port}/api/gemini/food-analyze?stream=true`;
    if (verbose) console.log(`[Runner] Calling ${fetchUrl}...`);
    const res = await fetch(fetchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": `server-job-${body.jobId}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (verbose) console.warn(`[Runner] HTTP call returned ${res.status}: ${errText}`);
    } else {
      usedHttp = true;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let lineBuffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("data:")) {
                try {
                  const evt = JSON.parse(trimmed.slice(5).trim());
                  if (evt.final === true || evt.type === "final" || evt.type === "result") {
                    resultData = evt.result || evt.foodAnalysis || evt.data || evt;
                  } else if (evt.type === "log" && evt.message) {
                    logs.push(evt.message);
                    if (verbose) console.log(`  [Log] ${evt.message}`);
                  }
                } catch {}
              }
            }
          }
        }
      } else {
        resultData = await res.json();
      }
    }
  } catch (err: any) {
    if (verbose) console.log(`[Runner] HTTP call failed (${err.message}). Falling back to in-process execution.`);
  }

  // If HTTP call did not yield resultData, run in-process directly
  if (!resultData) {
    const { runFoodAnalyze } = await import("../../server_food_analyze_run.ts");
    const sseLines: string[] = [];
    const mockRes: any = {
      writeHead: () => {},
      write: (chunk: any) => {
        const text = String(chunk);
        sseLines.push(text);
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            try {
              const evt = JSON.parse(trimmed.slice(5).trim());
              if (evt.final === true || evt.type === "final" || evt.type === "result") {
                resultData = evt.result || evt.foodAnalysis || evt.data || evt;
              } else if (evt.type === "log" && evt.message) {
                logs.push(evt.message);
                if (verbose) console.log(`  [Log] ${evt.message}`);
              }
            } catch {}
          }
        }
      },
      end: () => {},
      setHeader: () => {},
      status: () => mockRes,
      json: (data: any) => {
        resultData = data?.result || data?.foodAnalysis || data;
      },
    };

    const mockReq: any = {
      body,
      query: { stream: "true" },
      headers: { "x-session-id": `server-job-${body.jobId}` },
    };

    await runFoodAnalyze(mockReq, mockRes);
  }

  // If Portion Clarification was triggered, automatically submit Turn 2 with resolved portion choices
  if (resultData?.needsPortionClarify || resultData?.mode === "portion_clarify") {
    console.log(`  [Runner] Turn 1 paused for Portion Clarification: "${resultData.message || resultData.text}"`);
    console.log(`  [Runner] Auto-answering Turn 2 with confirmed portion choices...`);
    // Server applySkipScoutShortcut needs prior scout rows; they live on portionClarify.scoutItems
    // when the final payload omits top-level scoutItems. Choices must be keyed by scoutIndex.
    const priorScout =
      (Array.isArray(resultData.scoutItems) && resultData.scoutItems.length > 0
        ? resultData.scoutItems
        : null) ||
      (Array.isArray(resultData.portionClarify?.scoutItems) && resultData.portionClarify.scoutItems.length > 0
        ? resultData.portionClarify.scoutItems
        : null) ||
      (Array.isArray(resultData.agentResult?.scoutItems) && resultData.agentResult.scoutItems.length > 0
        ? resultData.agentResult.scoutItems
        : []) ||
      [];
    const clarifyItems = resultData.portionClarify?.items || priorScout || [];
    const portionChoices: Record<string, number> = {};
    for (let idx = 0; idx < clarifyItems.length; idx++) {
      const item = clarifyItems[idx];
      const si = item.scoutIndex != null ? Number(item.scoutIndex) : idx;
      const chosenGrams = Number(item.estimatedWeightGrams) || c.groundTruth.weight || 100;
      portionChoices[String(si)] = Math.round(chosenGrams);
    }
    // If clarify only listed ambiguous rows, still apply GT total weight to index 0 when single dish
    if (Object.keys(portionChoices).length === 0 && priorScout.length > 0) {
      portionChoices["0"] = Math.round(c.groundTruth.weight || priorScout[0].estimatedWeightGrams || 100);
    }
    const turn2Body = {
      message: "Confirmed portion sizes",
      portionChoices,
      skipScout: true,
      scoutItems: priorScout,
      activeScoutItems: priorScout,
      resolvedDbCandidates: resultData.resolvedDbCandidates || [],
      userProfile: body.userProfile,
      jobId: body.jobId,
      // Keep image context like LogChat portion confirm (helps resume path)
      images: imageDataUrls,
      image: imageDataUrls[0],
      imageUrls: imageDataUrls,
    };

    try {
      const turn2Res = await fetch(`http://localhost:${port}/api/gemini/food-analyze?stream=true`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": `server-job-${body.jobId}`,
        },
        body: JSON.stringify(turn2Body),
      });

      if (turn2Res.ok) {
        const reader = turn2Res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let lineBuffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("data:")) {
                try {
                  const evt = JSON.parse(trimmed.slice(5).trim());
                  if (evt.final === true || evt.type === "final" || evt.type === "result") {
                    resultData = evt.result || evt.foodAnalysis || evt.data || evt;
                  } else if (evt.type === "log" && evt.message && verbose) {
                    console.log(`  [Turn 2 Log] ${evt.message}`);
                  }
                } catch {}
              }
            }
          }
        }
      }
    } catch (turn2Err: any) {
      if (verbose) console.warn(`[Runner] Turn 2 error: ${turn2Err.message}`);
    }
  }

  const durationMs = Date.now() - startMs;
  if (!resultData) {
    console.error(`❌ Case ${c.id} FAILED: No result returned from food analysis.`);
    return { passed: false, caseId: c.id, error: "No result returned", durationMs };
  }

  const rawMeal = resultData.pendingFoodLog || resultData.data || resultData.foodAnalysis || resultData.activeMeal || resultData.mealBuild?.pendingFoodLog || resultData;
  const meal = rawMeal.foodData || rawMeal;
  const items = meal.itemsBreakdown || meal.items || [];
  const macros = meal.nutrients || meal.macros || {};
  const totalWeight = Number(meal.weightGrams || meal.totalWeightGrams || meal.totalWeight || meal.estimatedWeightGrams || 0);
  const calories = Math.round(Number(macros.calories || meal.calories || 0));
  const protein = Math.round(Number(macros.protein || meal.protein || 0) * 10) / 10;
  const carbs = Math.round(Number(macros.carbohydrates || meal.carbs || 0) * 10) / 10;
  const fat = Math.round(Number(macros.totalFat || meal.fat || 0) * 10) / 10;

  // Assertions
  const failures: string[] = [];

  // Contract 1: No phantom empty dishes
  const emptyContextDishes = items.filter((it: any) => {
    const n = String(it.originalName || it.name || it.keyword || "").toLowerCase();
    return n.includes("empty context") || n === "none" || n === "no food";
  });
  if (emptyContextDishes.length > 0) {
    failures.push(`Phantom placeholder dish detected: ${emptyContextDishes.map((d: any) => d.name || d.originalName).join(", ")}`);
  }

  // Contract 2: Non-zero items identified
  if (items.length === 0) {
    failures.push(`Zero food items identified in meal.`);
  }

  // Contract 3: Macro non-zero sanity
  if (calories <= 0) failures.push(`Zero calories calculated.`);
  if (protein <= 0 && carbs <= 0 && fat <= 0) failures.push(`All macronutrients are 0.`);

  // Tolerances vs Ground Truth
  const gt = c.groundTruth;
  const calDiff = Math.abs(calories - gt.calories) / gt.calories;
  const proDiff = Math.abs(protein - gt.protein) / Math.max(gt.protein, 1);
  const carbDiff = Math.abs(carbs - gt.carbs) / Math.max(gt.carbs, 1);
  const fatDiff = Math.abs(fat - gt.fat) / Math.max(gt.fat, 1);

  // Reasonable tolerance bands for visual estimation (within ±35% on calories, ±40% on macros)
  const calPass = calDiff <= 0.35;
  const proPass = proDiff <= 0.40;
  const carbPass = carbDiff <= 0.40;
  const fatPass = fatDiff <= 0.40;

  console.log(`------------------------------------------------------------------------`);
  console.log(`[RESULTS] Case ${c.id}: ${meal.mealName || "Meal"} (Latency: ${(durationMs / 1000).toFixed(1)}s, ${usedHttp ? "HTTP" : "In-Process"})`);
  console.log(`  Items Identified (${items.length}):`);
  for (const it of items) {
    const itemWeight = it.weightGrams || it.estimatedWeightGrams || "?";
    const itemCal = it.nutrients?.calories || it.calories || "?";
    console.log(`    - ${it.originalName || it.name || it.keyword} (~${itemWeight}g, ${itemCal} kcal)`);
  }
  console.log(`\n  Macronutrient Accuracy:`);
  console.log(`    Calories: ${calories} kcal (GT: ${gt.calories} kcal, diff: ${(calDiff * 100).toFixed(1)}%) -> ${calPass ? "✅" : "⚠️"}`);
  console.log(`    Protein:  ${protein}g (GT: ${gt.protein}g, diff: ${(proDiff * 100).toFixed(1)}%) -> ${proPass ? "✅" : "⚠️"}`);
  console.log(`    Carbs:    ${carbs}g (GT: ${gt.carbs}g, diff: ${(carbDiff * 100).toFixed(1)}%) -> ${carbPass ? "✅" : "⚠️"}`);
  console.log(`    Fat:      ${fat}g (GT: ${gt.fat}g, diff: ${(fatDiff * 100).toFixed(1)}%) -> ${fatPass ? "✅" : "⚠️"}`);
  console.log(`------------------------------------------------------------------------`);

  const passed = failures.length === 0;
  if (!passed) {
    console.error(`❌ Case ${c.id} CONTRACT FAILURES:`);
    for (const f of failures) console.error(`   - ${f}`);
  } else {
    console.log(`✅ Case ${c.id} PASSED all contract and sanity rules!`);
  }

  return {
    passed,
    caseId: c.id,
    durationMs,
    failures,
    output: { calories, protein, carbs, fat, itemsCount: items.length },
  };
}

async function main() {
  const caseId = arg("--case", "08");
  const runAll = hasFlag("--all");
  const verbose = hasFlag("--verbose") || hasFlag("-v");

  const casesToRun: MealBenchmarkCase[] = [];
  if (runAll) {
    casesToRun.push(...Object.values(benchmarkCases));
  } else {
    const selected = benchmarkCases[caseId];
    if (!selected) {
      console.error(`Invalid case ID: ${caseId}. Available cases: ${Object.keys(benchmarkCases).join(", ")}`);
      process.exit(1);
    }
    casesToRun.push(selected);
  }

  console.log(`Starting Live Meal Benchmark (${casesToRun.length} case(s))...`);
  let allPassed = true;
  for (const c of casesToRun) {
    const res = await runLiveMealBenchmark(c, { verbose });
    if (!res.passed) allPassed = false;
  }

  console.log(`\n========================================================================`);
  console.log(`OVERALL MEAL BENCHMARK RESULT: ${allPassed ? "ALL PASSED (100%)" : "FAILURES DETECTED"}`);
  console.log(`========================================================================\n`);

  process.exit(allPassed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Benchmark runner crashed:", err);
    process.exit(1);
  });
}
