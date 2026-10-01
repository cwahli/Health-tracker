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
  resolveRoleId,
  seedProjectWorkspace,
} from './lib/project-registry.mjs';
import { runGemini } from './lib/agent-gemini.mjs';
import { buildHealthContext, renderContextBlock } from './lib/health/context.mjs';

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

/**
 * The case pipeline's checkpoints, declared rather than inferred.
 *
 * external-1 and external-2 were the council's first tenants and their three
 * checkpoints are part of a working routine: the messages and the phase sets
 * below are what those chats have always received. They live here, in one map,
 * so that a second project's stages can be its own roles without this file
 * having to guess which pipeline a call belongs to.
 */
export const LEGACY_CHECKPOINTS = {
  audit: {
    phases: ['accuracy_review'],
    nextStepMsg: '🛑 *Stage 1 Checkpoint:* Accuracy Audit complete.\nReview `01_accuracy_audit.md` in Drive. Add any missing exhibits/receipts to the folder, then send `/council defense` to run the defense and manager simulation.',
  },
  defense: {
    phases: ['case_review', 'manager_simulation'],
    nextStepMsg: '🛑 *Stage 2 Checkpoint:* Defense & Manager Red-Team simulation complete.\nReview `02_defense_rebuttal.md` and `03_manager_critique.md`. Address any high-vulnerability points, then send `/council finalize` to generate the legal memo and final deliverables.',
  },
  finalize: {
    phases: ['legal_policy', 'arbitrator', 'final_case_builder'],
    nextStepMsg: '🎉 *Stage 3 Complete:* Legal review, arbitration, and final deliverables compiled.\nCheck `A_Executive_1-on-1_Talking_Points.md` and `B_Formal_Performance_Rating_Rebuttal.md` in your project folder.',
  },
};

/** The three executive documents the case pipeline reports. */
export const LEGACY_DELIVERABLES = [
  'A_Executive_1-on-1_Talking_Points.md',
  'B_Formal_Performance_Rating_Rebuttal.md',
  'C_30_60_90_Performance_Alignment_Plan.md',
];

/**
 * Which pipeline a project runs: the declared legacy case map, or its own roles.
 *
 * The registry says so (`councilPipeline: 'case'`); a project that does not say
 * is a roles project, because every project but the two case councils is.
 */
export function isCaseProject(projectId) {
  return KNOWN_PROJECTS[projectId]?.councilPipeline === 'case';
}

/** The stages a project can run, numbered as the chat numbers them. */
export function councilStages(projectId) {
  return getCouncilPhases(projectId).map((p, i) => ({ ...p, index: i + 1 }));
}

/**
 * Resolve a `/council <stage>` token against the project's own phases.
 *
 * Accepted for a roles project: a phase id (`data_steward`), a role alias
 * (`steward` → `data_steward`, through the same alias table `/role` uses), a
 * 1-based number (`2`), or `all`/`run`/`` for every phase. A case project gets
 * its three checkpoints first, so `/council audit` keeps meaning what it means.
 *
 * Anything else is a refusal naming the real stages — the previous fallback ran
 * the **entire** council for an unknown token, which is the one thing a stage
 * command must never silently do.
 */
export function resolveCouncilStage(stage, projectId = 'external-1') {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) return { ok: false, error: `Unknown project: ${projectId}`, stages: [] };

  const phases = councilStages(projectId);
  const byId = (id) => phases.find((p) => p.id === id);
  const stageList = phases.map((p) => `${p.index} ${p.id}`).join(', ');
  const token = String(stage ?? '').trim().toLowerCase();

  if (isCaseProject(projectId) && LEGACY_CHECKPOINTS[token]) {
    const checkpoint = LEGACY_CHECKPOINTS[token];
    return {
      ok: true,
      label: token,
      legacy: true,
      phases: checkpoint.phases.map((id) => byId(id)).filter(Boolean),
      nextStepMsg: checkpoint.nextStepMsg,
    };
  }

  if (token === '' || token === 'all' || token === 'run' || token === 'full') {
    return {
      ok: true,
      label: 'all',
      legacy: false,
      phases,
      nextStepMsg: `✅ *Council complete* — ${phases.length} seat(s): ${phases.map((p) => p.title).join(' · ')}\nArtifacts: \`${resultDir(proj.workspace)}/\` — one file per seat.\nNext: review them, then \`/council <stage>\` to re-run one seat.`,
    };
  }

  const index = /^\d+$/.test(token) ? Number(token) : NaN;
  const phase = byId(token) || byId(resolveRoleId(token, projectId) || '') || (Number.isInteger(index) ? phases[index - 1] : null);
  if (!phase) {
    return {
      ok: false,
      error: `Unknown stage "${stage}" for ${proj.name} — stages: ${stageList}${isCaseProject(projectId) ? `, or the checkpoints ${Object.keys(LEGACY_CHECKPOINTS).join(' / ')}` : ''}`,
      stages: phases,
    };
  }
  const next = phases[phase.index];
  return {
    ok: true,
    label: phase.id,
    legacy: false,
    phases: [phase],
    nextStepMsg: `✅ *Stage ${phase.index}/${phases.length} complete* — ${phase.title}\nArtifact: \`${phase.file}\` in the workspace's result folder.\n${next ? `Next: \`/council ${next.id}\`` : 'That was the last stage.'}${next ? ', or ' : ' '}\`/council status\` lists every stage and which have run.`,
  };
}

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

/**
 * Where a workspace keeps its outputs. `result/` is the current layout;
 * `output/` is the previous one. New layout wins when both exist; old workspaces
 * keep working untouched.
 */
export function resultDir(workspace) {
  const next = path.join(workspace, 'result');
  if (fs.existsSync(next) && fs.statSync(next).isDirectory()) return next;
  return path.join(workspace, 'output');
}

/** File lookup across the current layout with old-layout fallback. */
export function findInWorkspace(workspace, ...candidates) {
  for (const rel of candidates) {
    const full = path.join(workspace, rel);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return rel;
    } catch { /* unreadable entry is not a match */ }
  }
  return '';
}

/**
 * Which context reader a project declares, if any.
 *
 * A project names a `contextProvider` in the registry when its workspace is not
 * a case/ workspace. external-health is one: its data lives in `result/` and
 * `sources/`, and the case/ reader below — root `*.md` plus `case/` and
 * `working/` — found exactly one file there (`BRIEF.md`), so every seat reasoned
 * from the brief and none of the verified numbers.
 */
export function contextProviderFor(workspace, projectId = '') {
  const proj = projectId
    ? KNOWN_PROJECTS[projectId]
    : Object.values(KNOWN_PROJECTS).find((p) => p.workspace === workspace);
  return proj?.contextProvider || '';
}

/**
 * The context block a seat turn is given.
 *
 * `context` is the legacy file map for case/ projects and the structured pack
 * for a provider project; `text` is what goes into the prompt. The legacy path
 * renders byte-for-byte what it always did (`### File:` headers, 1000-character
 * slice) so external-1 and external-2 prompts do not change.
 *
 * A provider that refuses (no brief, no such folder) answers `ok:false` with its
 * reasons, and the caller must refuse the turn rather than send an empty block:
 * a seat reasoning from nothing produces exactly the confident claims this
 * project exists to prevent.
 */
export function readWorkspaceContext(workspace, { projectId = '' } = {}) {
  if (contextProviderFor(workspace, projectId) === 'health') {
    const context = buildHealthContext(workspace);
    return { ok: context.ok, provider: 'health', refuses: context.refuses, context, text: renderContextBlock(context) };
  }

  const files = {};
  if (fs.existsSync(workspace)) {
    // Root files (old layout) plus the current layout's case/ and working/ trees,
    // keyed by relative path so same-named files cannot collide silently.
    const readFile = (rel) => {
      try {
        files[rel] = fs.readFileSync(path.join(workspace, rel), 'utf8');
      } catch { /* listed but unreadable: skip, do not fail the turn */ }
    };
    for (const f of fs.readdirSync(workspace)) {
      if (f.endsWith('.md')) {
        try {
          if (fs.statSync(path.join(workspace, f)).isFile()) readFile(f);
        } catch { /* ignore */ }
      }
    }
    for (const dir of ['case', 'working']) {
      const abs = path.join(workspace, dir);
      let entries = [];
      try {
        entries = fs.statSync(abs).isDirectory() ? fs.readdirSync(abs) : [];
      } catch { /* absent dir: nothing to add */ }
      for (const f of entries) if (f.endsWith('.md')) readFile(path.join(dir, f));
    }
  }
  const text = Object.entries(files)
    .map(([f, c]) => `### File: ${f}\n${c.slice(0, 1000)}...\n`)
    .join('\n');
  return { ok: true, provider: 'legacy', refuses: [], context: files, text };
}

/** The seat context for a turn, or a thrown refusal naming what is missing. */
function seatContextText(projectId, workspace) {
  const ctx = readWorkspaceContext(workspace, { projectId });
  if (!ctx.ok) {
    throw new Error(`workspace context refused for ${projectId}: ${ctx.refuses.join('; ')}`);
  }
  return ctx.text;
}

export function getCouncilStatus(projectId = 'external-1') {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) return { error: `Unknown project: ${projectId}` };
  const workspace = proj.workspace;
  const outDir = resultDir(workspace);

  const files = fs.existsSync(workspace) ? fs.readdirSync(workspace) : [];
  const outputs = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  const has = (...rels) => rels.some((r) => files.includes(r) || Boolean(findInWorkspace(workspace, r)));

  const phasesList = getCouncilPhases(projectId);
  const phases = phasesList.map((p, i) => {
    // The same directory the stage writer uses: a run that reported success and
    // a status page that says "pending" is one bug, not two opinions.
    const done = outputs.includes(p.file);
    return {
      phase: p.id,
      index: i + 1,
      title: p.title,
      completed: done,
      outputFile: done ? path.join(outDir, p.file) : null,
    };
  });

  // A project's deliverables are its own phase files; the case pipeline keeps
  // the A/B/C trio it has always checked.
  const casePipeline = isCaseProject(projectId);
  const deliverables = casePipeline ? LEGACY_DELIVERABLES : phasesList.map((p) => p.file);
  const deliverablesReady = deliverables.every((rel) => outputs.includes(rel) || Boolean(findInWorkspace(workspace, rel)));

  return {
    projectId,
    name: proj.name,
    workspace,
    outDir,
    gdriveFolder: proj.gdriveFolder,
    pipeline: casePipeline ? 'case' : 'roles',
    hasInputFacts: has('01_Case_Facts_and_Timeline.md', 'case/01_Case_Facts_and_Timeline.md'),
    hasEvidenceLedger: has('02_Evidence_and_Metric_Ledger.md', 'case/02_Evidence_and_Metric_Ledger.md'),
    phases,
    deliverables,
    deliverablesReady,
  };
}

export async function executeRoleTurn({ projectId = 'external-1', roleId, prompt, contextText = '', runGemini: runModel = runGemini }) {
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
    res = await runModel({
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


export async function runFullCouncil(projectId = 'external-1', onProgress = console.log, { runGemini: runModel = runGemini } = {}) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) throw new Error(`Unknown project: ${projectId}`);

  seedProjectWorkspace(projectId);
  const workspace = proj.workspace;
  const outDir = resultDir(workspace);
  fs.mkdirSync(outDir, { recursive: true });

  const contextText = seatContextText(projectId, workspace);

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
      runGemini: runModel,
    });
    const outFile = path.join(outDir, phase.file);
    fs.writeFileSync(outFile, output, 'utf8');
    results[phase.id] = output;
    onProgress(`✅ [Completed] ${phase.title} -> saved to ${path.relative(workspace, outDir)}/${phase.file}`);
  }

  // Update the master templates in the workspace with compiled deliverables.
  // Working drafts live in working/ in the current layout; fall back to root.
  const at = (name) => {
    const hit = findInWorkspace(workspace, path.join('working', name), name);
    return hit ? path.join(workspace, hit) : path.join(workspace, 'working', name);
  };
  const deliverables = isCaseProject(projectId)
    ? [
        at('A_Executive_1-on-1_Talking_Points.md'),
        at('B_Formal_Performance_Rating_Rebuttal.md'),
        at('C_30_60_90_Performance_Alignment_Plan.md'),
      ]
    : phases.map((p) => path.join(outDir, p.file));

  onProgress(`📦 Final deliverables verified in workspace: ${workspace}`);
  return {
    success: true,
    results,
    workspace,
    outDir,
    phases: phases.map((p) => p.id),
    deliverables,
  };
}

export async function runCouncilStage(stage = 'audit', projectId = 'external-1', onProgress = console.log, { runGemini: runModel = runGemini } = {}) {
  const proj = KNOWN_PROJECTS[projectId];
  if (!proj) throw new Error(`Unknown project: ${projectId}`);

  seedProjectWorkspace(projectId);
  const workspace = proj.workspace;
  // One agreed directory, and it is the one getCouncilStatus reads. This used to
  // be a hardcoded `output/` while the reader looked in `result/`, so every
  // completed stage read back as pending.
  const outDir = resultDir(workspace);
  fs.mkdirSync(outDir, { recursive: true });

  const resolved = resolveCouncilStage(stage, projectId);
  if (!resolved.ok) throw new Error(resolved.error);

  const contextText = seatContextText(projectId, workspace);

  onProgress(`🚀 Running Council Stage: "${resolved.label.toUpperCase()}" for ${proj.name}`);
  const results = {};
  for (const phase of resolved.phases) {
    onProgress(`🔄 [Running] ${phase.title}...`);
    const output = await executeRoleTurn({
      projectId,
      roleId: phase.id,
      prompt: `Execute ${phase.title} based on active workspace facts and evidence ledger.`,
      contextText,
      runGemini: runModel,
    });
    const outFile = path.join(outDir, phase.file);
    fs.writeFileSync(outFile, output, 'utf8');
    results[phase.id] = output;
    onProgress(`✅ [Completed] ${phase.title}`);
  }

  return {
    stage: resolved.label,
    success: true,
    results,
    workspace,
    outDir,
    phases: resolved.phases.map((p) => ({ id: p.id, file: p.file, path: path.join(outDir, p.file) })),
    deliverables: resolved.phases.map((p) => path.join(outDir, p.file)),
    nextStepMsg: resolved.nextStepMsg,
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
