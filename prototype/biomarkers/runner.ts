import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { batchRows, classifyRows } from "./backoffice.ts";
import { fillBatch } from "./call_agent.ts";
import { scoreC2 } from "./score.ts";
import { DRAFT_BATCH_SIZE, INSIGHT_BATCH_SIZE } from "./template.ts";
import type { CaseFile, ClassifiedRow, ExpectedFile, FillRow, ProfileFixture } from "./schema.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const HERE = path.dirname(new URL(import.meta.url).pathname);

function loadEnv() {
  const candidates = [
    path.join(ROOT, ".env"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), "src/Health-tracker/.env"),
    path.join(os.homedir(), "antigravity/Biomarker-and-Nutrient-Tracker/.env"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, override: false });
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY) return p;
  }
  dotenv.config({ override: false });
  return null;
}

const envPath = loadEnv();

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) return process.argv[i + 1];
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function printClassified(classified: ClassifiedRow[]) {
  console.log(`\nBack-office identity (${classified.length} rows)`);
  for (const r of classified) {
    const tag = r.writeTarget === "observation" ? "HIT " : "MISS";
    const st = r.template.currentEvaluationStatus ? ` status=${r.template.currentEvaluationStatus}` : "";
    console.log(
      `  ${tag} ${r.id.padEnd(4)} ${r.printed.padEnd(32)} → ${r.writeTarget.padEnd(12)} key=${r.catalog?.key || r.mappedKey} match=${r.match}${st}`
    );
  }
}

function toFillRow(c: ClassifiedRow): FillRow {
  return {
    id: c.id,
    op: "add",
    printed: c.printed,
    value: c.value,
    unit: c.unit,
    date: c.date,
    match: c.match,
    key: c.template.key,
    writeTarget: c.writeTarget,
    medicalInsight: c.template.medicalInsight,
    customRangeOverlay: c.template.customRangeOverlay,
    newCatalogDraft: c.template.newCatalogDraft,
  };
}

function applyAgentRow(classified: ClassifiedRow[], row: FillRow) {
  const cls = classified.find((c) => c.id === row.id);
  if (!cls) return;
  if (row.medicalInsight) cls.template.medicalInsight = row.medicalInsight;
  if (row.customRangeOverlay !== undefined) cls.template.customRangeOverlay = row.customRangeOverlay ?? null;
  if (row.newCatalogDraft) cls.template.newCatalogDraft = row.newCatalogDraft;
}

async function runC2() {
  const casePath = path.join(HERE, "fixtures/cases/C2.json");
  const expectPath = path.join(HERE, "fixtures/cases/C2.expected.json");
  const caseFile = loadJson<CaseFile>(casePath);
  const expected = loadJson<ExpectedFile>(expectPath);
  const profile = loadJson<ProfileFixture>(path.join(HERE, "fixtures/profile.json"));
  const insightSize = Number(arg("--insight-batch", String(INSIGHT_BATCH_SIZE)));
  const draftSize = Number(arg("--draft-batch", String(DRAFT_BATCH_SIZE)));
  const dry = hasFlag("--dry-run");

  console.log("==========================================================================================");
  console.log("C2 mixed known+unknown — hits=insight only, misses=draft; TS continuation");
  console.log(`Model: gemini-3.5-flash-lite | insightBatch=${insightSize} draftBatch=${draftSize} | dry=${dry} | env=${envPath || "none"}`);
  console.log(`User: ${caseFile.message}`);
  console.log("==========================================================================================");

  const classified = classifyRows(caseFile.rows, caseFile.history || {}, profile);
  printClassified(classified);
  const hits = classified.filter((r) => r.writeTarget === "observation");
  const misses = classified.filter((r) => r.writeTarget === "pending");
  console.log(`\nClassified: ${hits.length} hits / ${misses.length} misses (expected ${expected.expectKnown}/${expected.expectUnknown})`);
  console.log(`Flow: dictionary locked on hits; agent reviews insight. Misses get pending drafts.`);

  const insightBatches = batchRows(hits, insightSize);
  const draftBatches = batchRows(misses, draftSize);
  const turnLogs: { turn: number; kind: string; ids: string[]; ms: number; n: number; raw: string; rows: FillRow[] }[] = [];

  if (dry) {
    for (const m of misses) {
      m.template.newCatalogDraft = {
        suggestedKey: m.mappedKey || m.printed.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        name: m.printed,
        unit: m.unit,
        aliases: [],
        normalRange: "Varies",
        description: m.printed,
        riskCategories: [],
      };
    }
    turnLogs.push({ turn: 0, kind: "dry", ids: classified.map((r) => r.id), ms: 0, n: classified.length, raw: "", rows: classified.map(toFillRow) });
  } else {
    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.API_KEY ||
      process.env.GEMINI_API_KEYS?.split(",")[0]?.trim();
    if (!apiKey) {
      console.error("\nNo GEMINI_API_KEY / GOOGLE_API_KEY / API_KEY. Export one and re-run without --dry-run.");
      process.exit(2);
    }
    const ai = new GoogleGenAI({ apiKey });
    let turn = 0;
    const runKind = async (kind: "hit" | "miss", batches: ClassifiedRow[][]) => {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const later = batches.slice(i + 1).flat().map((r) => r.id);
        turn += 1;
        console.log(`\n--- agent turn ${turn} ${kind} ids=${batch.map((r) => r.id).join(",")} queued=${later.length} ---`);
        const out = await fillBatch(ai, caseFile.message, batch, turn, later, kind, profile);
        console.log(`    ${out.rows.length} rows in ${out.ms}ms`);
        turnLogs.push({ turn, kind, ids: batch.map((r) => r.id), ms: out.ms, n: out.rows.length, raw: out.raw, rows: out.rows });
        for (const row of out.rows) applyAgentRow(classified, row);
      }
    };
    await runKind("hit", insightBatches);
    await runKind("miss", draftBatches);
  }

  const filled = classified.map(toFillRow);
  const sentIds = turnLogs.flatMap((t) => t.ids);
  const remaining = dry ? [] : sentIds.filter((id) => !turnLogs.some((t) => t.rows.some((r) => r.id === id)));
  const scored = scoreC2({
    classified,
    filled,
    expected,
    turns: dry ? 0 : turnLogs.filter((t) => t.turn > 0).length,
    remaining,
    requireInsight: !dry,
    profile,
  });

  const reportDir = path.join(HERE, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const report = {
    id: "C2",
    dry,
    insightSize,
    draftSize,
    turns: turnLogs,
    classified: classified.map((r) => ({
      id: r.id,
      printed: r.printed,
      match: r.match,
      writeTarget: r.writeTarget,
      key: r.catalog?.key || null,
      status: r.template.currentEvaluationStatus,
    })),
    templates: classified.map((r) => r.template),
    filled,
    score: scored,
  };
  const reportPath = path.join(reportDir, dry ? "C2.dry.json" : "C2.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(reportDir, dry ? "C2.dry.md" : "C2_live.md");
  fs.writeFileSync(mdPath, renderC2Markdown({
    caseFile,
    classified,
    filled,
    expected,
    scored,
    turnLogs,
    insightSize,
    draftSize,
    dry,
    envPath,
  }));

  console.log(`\nScore: ${scored.pass ? "PASS" : "FAIL"}  known=${scored.known} unknown=${scored.unknown} turns=${scored.turns}`);
  if (scored.fails.length) {
    console.log("Fails:");
    for (const f of scored.fails) console.log(`  - [${f.check}] ${f.printed || f.id}: ${f.detail}`);
  }
  console.log(`Report: ${path.relative(ROOT, reportPath)}`);
  console.log(`Analysis: ${path.relative(ROOT, mdPath)}`);
  process.exit(scored.pass ? 0 : 1);
}

function renderC2Markdown(opts: {
  caseFile: CaseFile;
  classified: ClassifiedRow[];
  filled: FillRow[];
  expected: ExpectedFile;
  scored: ReturnType<typeof scoreC2>;
  turnLogs: { turn: number; kind?: string; ids: string[]; ms: number; n: number; raw: string; rows: FillRow[] }[];
  insightSize: number;
  draftSize: number;
  dry: boolean;
  envPath: string | null;
}): string {
  const { caseFile, classified, filled, expected, scored, turnLogs, insightSize, draftSize, dry, envPath } = opts;
  const lines: string[] = [];
  lines.push(`# C2 live analysis`);
  lines.push("");
  lines.push(`- Model: \`gemini-3.5-flash-lite\``);
  lines.push(`- Dry: ${dry}`);
  lines.push(`- Insight batch: ${insightSize} · draft batch: ${draftSize} → ${turnLogs.filter((t) => t.turn > 0).length || 0} agent turns`);
  lines.push(`- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.`);
  lines.push(`- Template: \`prototype/biomarkers/TEMPLATE.md\``);
  lines.push(`- Env file: ${envPath ? path.basename(path.dirname(envPath)) + "/.env" : "(none)"}`);
  lines.push(`- Score: **${scored.pass ? "PASS" : "FAIL"}** (${scored.known} known / ${scored.unknown} unknown)`);
  lines.push("");
  lines.push(`## User send (once)`);
  lines.push("");
  lines.push("```");
  lines.push(caseFile.message);
  for (const r of caseFile.rows) lines.push(`${r.printed}  ${r.value} ${r.unit}`);
  lines.push("```");
  lines.push("");
  lines.push(`## Back-office identity`);
  lines.push("");
  lines.push("| id | printed | match | writeTarget | key |");
  lines.push("|---|---|---|---|---|");
  for (const r of classified) {
    lines.push(`| ${r.id} | ${r.printed} | ${r.match} | ${r.writeTarget} | ${r.catalog?.key || "—"} |`);
  }
  lines.push("");
  if (!dry) {
    lines.push(`## Agent turns (full output)`);
    lines.push("");
    for (const t of turnLogs) {
      if (t.turn === 0) continue;
      lines.push(`### Turn ${t.turn} (${t.kind || "batch"}) — ${t.ids.join(", ")} (${t.n} rows, ${t.ms}ms)`);
      lines.push("");
      lines.push("```json");
      let pretty = t.raw;
      try {
        pretty = JSON.stringify(JSON.parse(t.raw), null, 2);
      } catch {
        /* keep raw */
      }
      lines.push(pretty);
      lines.push("```");
      lines.push("");
    }
  }
  lines.push(`## Merged fill vs expected`);
  lines.push("");
  lines.push("| printed | expected key | got key | expected target | got target | ok |");
  lines.push("|---|---|---|---|---|---|");
  const byPrinted = new Map(filled.map((r) => [r.printed.toLowerCase(), r]));
  for (const exp of expected.rows) {
    const got = byPrinted.get(exp.printed.toLowerCase());
    const ok =
      !!got &&
      got.writeTarget === exp.writeTarget &&
      (exp.writeTarget === "pending" ? got.match === "none" : got.key === exp.key);
    lines.push(
      `| ${exp.printed} | ${exp.key ?? "—"} | ${got?.key ?? "—"} | ${exp.writeTarget} | ${got?.writeTarget ?? "MISSING"} | ${ok ? "yes" : "NO"} |`
    );
  }
  lines.push("");
  lines.push(`## Hit templates (dictionary locked + user slots)`);
  lines.push("");
  for (const r of classified.filter((c) => c.writeTarget === "observation")) {
    const t = r.template;
    lines.push(`### ${t.biomarkerName} (\`${t.key}\`)`);
    lines.push("");
    lines.push(`- Alias: ${t.alias.join("; ") || "—"}`);
    lines.push(`- Normal range: ${t.normalRange} ${t.unit}`);
    lines.push(`- Description: ${t.description}`);
    lines.push(`- Risk categories: ${t.riskCategories.join("; ")}`);
    lines.push(`- Custom range (dictionary): ${t.customRangePopulation || "—"}`);
    lines.push(`- Status (computed): **${t.currentEvaluationStatus || "—"}**`);
    lines.push(`- Logs: ${t.historicalLogs.map((h) => `${h.date}=${h.value}`).join(" · ")}`);
    lines.push(`- Insight: ${t.medicalInsight || "(none)"}`);
    lines.push("");
  }
  lines.push("");
  if (scored.fails.length) {
    lines.push(`## Fails`);
    lines.push("");
    for (const f of scored.fails) lines.push(`- \`[${f.check}]\` ${f.printed || f.id}: ${f.detail}`);
    lines.push("");
  }
  lines.push(`## Instruction notes`);
  lines.push("");
  lines.push("- Hits: dictionary locked; agent only `medicalInsight` / overlay. Misses: pending draft.");
  lines.push("- Status is computed+sanitized in TS (never Critical on chronic). Insight cites it; Optimal = 1 sentence; else profile + trend.");
  lines.push("- HbA1c 40 is Elevated from brackets, not outside 20–41.");
  lines.push("- Contract: `TEMPLATE.md` + `template.ts`.");
  lines.push("");
  return lines.join("\n");
}

const only = arg("--only", "C2");
if (only && only !== "C2") {
  console.error(`Only C2 is implemented in this spike. Got --only ${only}`);
  process.exit(1);
}

runC2().catch((err) => {
  console.error(err);
  process.exit(1);
});
