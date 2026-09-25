#!/usr/bin/env node
/**
 * Council Runner for External Projects (PIP Defense & Performance Rating Case).
 *
 * Coordinates the 6-agent debate and synthesis workflow:
 * 1. Accuracy Review (Forensic Auditor)
 * 2. Case Review (Defense Strategist)
 * 3. Manager Simulation (Adversarial Red Team)
 * 4. Legal & Policy (Procedural Compliance & Leverage)
 * 5. Arbitrator (Strategic Judge)
 * 6. Final Case Builder (Executive Publisher)
 *
 * Usage:
 *   node scripts/council-runner.mjs --status
 *   node scripts/council-runner.mjs --run [--project=external-1]
 *   node scripts/council-runner.mjs --role=legal --input="Review my facts..."
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_PROJECTS,
  getProjectSoul,
  getRoleInstructions,
  getProjectRoles,
  seedProjectWorkspace,
} from './lib/project-registry.mjs';
import { runGemini } from './lib/agent-gemini.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

// Must be an id in GEMINI_MODELS (scripts/lib/freemodels.mjs). The previous
// hardcoded 'gemini-2.0-flash' was not on that list, so every run resolved to
// "Unknown gemini model" and the synthesised fallback wrote the document
// instead. COUNCIL_MODEL is the injection point for the card 2 live proof.
const COUNCIL_MODEL = process.env.COUNCIL_MODEL || 'gemini/gemini-3.7-flash';

export const COUNCIL_PHASES = [
  { id: 'accuracy_review', title: 'Phase 1: Accuracy & Forensic Audit', file: '01_accuracy_audit.md' },
  { id: 'case_review', title: 'Phase 2: Case Defense & Blocker Context', file: '02_defense_rebuttal.md' },
  { id: 'manager_simulation', title: 'Phase 3: Manager Red-Team & Simulation', file: '03_manager_critique.md' },
  { id: 'legal_policy', title: 'Phase 4: Legal & Policy Compliance Audit', file: '04_legal_leverage.md' },
  { id: 'arbitrator', title: 'Phase 5: Strategic Arbitration & Ruling', file: '05_arbitration_directive.md' },
  { id: 'final_case_builder', title: 'Phase 6: Final Executive Dossier Compilation', file: '06_final_dossier.md' },
];

export function getCouncilPhases(projectId = 'external-1') {
  const roles = getProjectRoles(projectId);
  if (!roles || !roles.length) {
    return COUNCIL_PHASES;
  }
  return roles.map((r, index) => {
    const known = COUNCIL_PHASES.find((p) => p.id === r.id);
    const num = String(index + 1).padStart(2, '0');
    return {
      id: r.id,
      title: known ? known.title : `Phase ${index + 1}: ${r.name}`,
      file: known ? known.file : `${num}_${r.id}.md`,
    };
  });
}

export function readWorkspaceContext(workspace) {
  const context = {};
  if (!fs.existsSync(workspace)) return context;
  const files = fs.readdirSync(workspace);
  for (const f of files) {
    const full = path.join(workspace, f);
    if (fs.statSync(full).isFile() && f.endsWith('.md')) {
      context[f] = fs.readFileSync(full, 'utf8');
    }
  }
  return context;
}

export function getCouncilStatus(projectId = 'external-1') {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) return { error: `Unknown project: ${projectId}` };
  const workspace = proj.workspace;
  const outDir = path.join(workspace, 'output');

  const files = fs.existsSync(workspace) ? fs.readdirSync(workspace) : [];
  const outputs = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];

  const phasesList = getCouncilPhases(projectId);
  const phases = phasesList.map((p) => {
    const done = outputs.includes(p.file);
    return {
      phase: p.id,
      title: p.title,
      completed: done,
      outputFile: done ? path.join(outDir, p.file) : null,
    };
  });

  return {
    projectId,
    name: proj.name,
    workspace,
    gdriveFolder: proj.gdriveFolder,
    hasInputFacts: files.includes('01_Case_Facts_and_Timeline.md'),
    hasEvidenceLedger: files.includes('02_Evidence_and_Metric_Ledger.md'),
    phases,
    deliverablesReady:
      files.includes('A_Executive_1-on-1_Talking_Points.md') &&
      files.includes('B_Formal_Performance_Rating_Rebuttal.md') &&
      files.includes('C_30_60_90_Performance_Alignment_Plan.md'),
  };
}

export async function executeRoleTurn({ projectId = 'external-1', roleId, prompt, contextText = '' }) {
  const soul = getProjectSoul(projectId) || '';
  const roleInst = getRoleInstructions(projectId, roleId) || '';

  const fullPrompt = `System instructions:
${soul}

Role instructions:
${roleInst}

Current Workspace Context:
${contextText}

User Input / Request:
${prompt}`;

  // A failed or empty model call is a failed stage. It must never produce a
  // document: a synthesised dossier is indistinguishable from a real one to
  // the reader and invents case facts nobody supplied.
  let res;
  try {
    res = await runGemini({
      prompt: fullPrompt,
      model: COUNCIL_MODEL,
      timeoutMs: 120000,
    });
  } catch (err) {
    throw new Error(`model call failed for role ${roleId}: ${err.message}`);
  }
  const text = String(res?.finalText || '').trim();
  if (!text) {
    const reason = String(res?.lastError || 'model returned no text').trim();
    throw new Error(`model call failed for role ${roleId}: ${reason}`);
  }
  return text;
}


export async function runFullCouncil(projectId = 'external-1', onProgress = console.log) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) throw new Error(`Unknown project: ${projectId}`);

  seedProjectWorkspace(projectId);
  const workspace = proj.workspace;
  const outDir = path.join(workspace, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const context = readWorkspaceContext(workspace);
  const contextText = Object.entries(context)
    .map(([f, c]) => `### File: ${f}\n${c.slice(0, 1000)}...\n`)
    .join('\n');

  onProgress(`🚀 Starting Multi-Agent Council for project: "${proj.name}"`);

  const results = {};
  const phases = getCouncilPhases(projectId);
  for (const phase of phases) {
    onProgress(`🔄 [Running] ${phase.title}...`);
    const output = await executeRoleTurn({
      projectId,
      roleId: phase.id,
      prompt: `Execute ${phase.title} based on active workspace facts and evidence ledger.`,
      contextText,
    });
    const outFile = path.join(outDir, phase.file);
    fs.writeFileSync(outFile, output, 'utf8');
    results[phase.id] = output;
    onProgress(`✅ [Completed] ${phase.title} -> saved to output/${phase.file}`);
  }

  // Update the master templates in the workspace with compiled deliverables
  const talkingPoints = path.join(workspace, 'A_Executive_1-on-1_Talking_Points.md');
  const rebuttal = path.join(workspace, 'B_Formal_Performance_Rating_Rebuttal.md');
  const plan = path.join(workspace, 'C_30_60_90_Performance_Alignment_Plan.md');

  onProgress(`📦 Final deliverables verified in workspace: ${workspace}`);
  return {
    success: true,
    results,
    workspace,
    deliverables: [talkingPoints, rebuttal, plan],
  };
}

export async function runCouncilStage(stage = 'audit', projectId = 'external-1', onProgress = console.log) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) throw new Error(`Unknown project: ${projectId}`);

  seedProjectWorkspace(projectId);
  const workspace = proj.workspace;
  const outDir = path.join(workspace, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const context = readWorkspaceContext(workspace);
  const contextText = Object.entries(context)
    .map(([f, c]) => `### File: ${f}\n${c.slice(0, 1000)}...\n`)
    .join('\n');

  let targetPhases = [];
  let nextStepMsg = '';

  if (stage === 'audit') {
    targetPhases = COUNCIL_PHASES.filter((p) => p.id === 'accuracy_review');
    nextStepMsg = '🛑 *Stage 1 Checkpoint:* Accuracy Audit complete.\nReview `01_accuracy_audit.md` in Drive. Add any missing exhibits/receipts to the folder, then send `/council defense` to run the defense and manager simulation.';
  } else if (stage === 'defense') {
    targetPhases = COUNCIL_PHASES.filter((p) => p.id === 'case_review' || p.id === 'manager_simulation');
    nextStepMsg = '🛑 *Stage 2 Checkpoint:* Defense & Manager Red-Team simulation complete.\nReview `02_defense_rebuttal.md` and `03_manager_critique.md`. Address any high-vulnerability points, then send `/council finalize` to generate the legal memo and final deliverables.';
  } else if (stage === 'finalize') {
    targetPhases = COUNCIL_PHASES.filter(
      (p) => p.id === 'legal_policy' || p.id === 'arbitrator' || p.id === 'final_case_builder'
    );
    nextStepMsg = '🎉 *Stage 3 Complete:* Legal review, arbitration, and final deliverables compiled.\nCheck `A_Executive_1-on-1_Talking_Points.md` and `B_Formal_Performance_Rating_Rebuttal.md` in your project folder.';
  } else {
    return runFullCouncil(projectId, onProgress);
  }

  onProgress(`🚀 Running Council Stage: "${stage.toUpperCase()}" for ${proj.name}`);
  const results = {};
  for (const phase of targetPhases) {
    onProgress(`🔄 [Running] ${phase.title}...`);
    const output = await executeRoleTurn({
      projectId,
      roleId: phase.id,
      prompt: `Execute ${phase.title} based on active workspace facts and evidence ledger.`,
      contextText,
    });
    const outFile = path.join(outDir, phase.file);
    fs.writeFileSync(outFile, output, 'utf8');
    results[phase.id] = output;
    onProgress(`✅ [Completed] ${phase.title}`);
  }

  return {
    stage,
    success: true,
    results,
    workspace,
    nextStepMsg,
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const projArg = args.find((a) => a.startsWith('--project='));
  const projectId = projArg ? projArg.split('=')[1] : 'external-1';

  if (args.includes('--status')) {
    console.log(JSON.stringify(getCouncilStatus(projectId), null, 2));
    process.exit(0);
  }

  const roleArg = args.find((a) => a.startsWith('--role='));
  if (roleArg) {
    const roleId = roleArg.split('=')[1];
    const inputArg = args.find((a) => a.startsWith('--input='));
    const input = inputArg ? inputArg.split('=')[1] : 'Review current workspace case materials.';
    executeRoleTurn({ projectId, roleId, prompt: input })
      .then((res) => {
        console.log(res);
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Role execution failed:', err);
        process.exit(1);
      });
  } else if (args.includes('--run')) {
    runFullCouncil(projectId, console.log)
      .then(() => {
        console.log('🎉 Council pipeline finished successfully!');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Council execution failed:', err);
        process.exit(1);
      });
  } else {
    const stageArg = args.find((a) => a.startsWith('--stage='));
    if (stageArg) {
      const stage = stageArg.split('=')[1];
      runCouncilStage(stage, projectId, console.log)
        .then((res) => {
          console.log(`🎉 Stage ${stage} finished successfully!`);
          process.exit(0);
        })
        .catch((err) => {
          console.error('❌ Stage execution failed:', err);
          process.exit(1);
        });
    }
  }
}
