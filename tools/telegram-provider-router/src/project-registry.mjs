/**
 * Per-chat project selection for the Grok TG computer bot.
 *
 * WHY THIS EXISTS
 * ---------------
 * The router ignored `/project external 4`. It had no `/project` handler at
 * all, so the command was dropped by the `text.startsWith("/")` guard in the
 * message handler and the bot answered "hi" against its default workspace
 * (WORKSPACE = /workspace/biomarker-and-nutrient-tracker). The user reasonably
 * concluded Grok had a different repo in mind, when in fact it simply never
 * heard the instruction.
 *
 * This mirrors `scripts/lib/project-registry.mjs` (the bot-host semantics:
 * `resolveProjectId` aliases, external-N workspace layout, role reset on switch)
 * without importing it — the router ships standalone and may only use its
 * vendored mirrors. The alias grammar is duplicated deliberately; it is tiny,
 * and `assert-project-registry-parity` pins the two against each other so the
 * copy cannot drift silently.
 *
 * WHY THE BRIEF IS A FILE, NOT A DRIVE FETCH
 * -----------------------------------------
 * The Project 4 brief lives in Google Drive (Doc 1SECT1DPQosQ4BubBNIHGOUdwJfwJyKRDf259T09N7eg).
 * This box has no Drive credential — `googleReady()` returns false and the doc
 * export answers 401 — so a live fetch would fail closed and the bot would
 * silently lose the brief. Instead the brief is read from a local file inside
 * the project workspace, which the VPS's `sync-brief.mjs` (or any human) can
 * refresh. Missing or unreadable brief is reported honestly in the prompt
 * rather than being papered over.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Workspace root for external-N projects, matching bot-host. */
export const PROJECTS_HOME = process.env.PROJECTS_HOME || path.join(os.homedir(), "projects");

/** The repo the router defaults to (health-tracker itself). */
export const DEFAULT_PROJECT = {
  id: "health-tracker",
  name: "Health Tracker Website (Project 1)",
  workspace: process.env.WORKSPACE || "/workspace",
  type: "internal",
  projectNumber: 1,
  roles: [],
};

/**
 * Brief file names searched inside a project workspace, in order. The first
 * existing one wins. `BRIEF.md` is the canonical name; the others let an
 * existing VPS-synced brief be adopted without renaming.
 */
const BRIEF_CANDIDATES = ["BRIEF.md", "brief.md", "Project-Brief.md", "docs/BRIEF.md"];

/**
 * Resolve a raw `/project` argument to a project id.
 *
 * Accepts the same grammar as bot-host so muscle memory transfers:
 *   "4" | "project 4" | "external 4" | "external-4" | "4th"
 *   "ht" | "main" | "website" | "1" -> health-tracker
 *   "2" | "pip" | "pip-defense"   -> external-2
 *   "ext 4" / "external_4"        -> external-4
 *
 * Returns null for an unparseable argument so the caller can list the real
 * options instead of inventing a project.
 */
export function resolveProjectId(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase().replace(/['"]/g, "");
  if (!s) return null;

  if (s === "health-tracker" || s === "ht" || s === "main" || s === "website") {
    return "health-tracker";
  }
  if (s === "1" || s === "project 1" || s === "project1") return "health-tracker";
  if (
    s === "2" ||
    s === "project 2" ||
    s === "project2" ||
    s === "external 2" ||
    s === "external-2" ||
    s === "pip" ||
    s === "pip-case" ||
    s === "pip-defense"
  ) {
    return "external-2";
  }
  // "external 4", "external-4", "external_4", "ext 4", "4", "project 4", "4th"
  const m = s.match(/^(?:project|external|ext)?[\s_-]*(\d+)(?:st|nd|rd|th)?$/);
  if (m) {
    const num = Number(m[1]);
    if (num === 1) return "health-tracker";
    if (num >= 2) return `external-${num}`;
  }
  return null;
}

/** Describe a project id without touching the filesystem. */
export function describeProject(id) {
  if (id === "health-tracker") return { ...DEFAULT_PROJECT };
  const m = String(id).match(/^external-(\d+)$/);
  if (!m) return null;
  const num = Number(m[1]);
  return {
    id,
    name: `External Project ${num}`,
    type: "external",
    projectNumber: num,
    workspace: path.join(PROJECTS_HOME, id),
  };
}

/** Human list for the /project error and help text. */
export function knownProjectList() {
  return ["health-tracker (Project 1)", "external-2 (Project 2)"];
}

/**
 * Ensure an external project workspace exists and return its path.
 *
 * Mirrors bot-host: create the directory if missing. Deliberately does NOT
 * seed a template or run git — the router is not the council runner, and
 * seeding a half-built council here would be worse than an empty dir.
 */
export function ensureWorkspace(id) {
  const p = describeProject(id);
  if (!p) throw new Error(`Unknown project "${id}"`);
  if (p.id !== "health-tracker") fs.mkdirSync(p.workspace, { recursive: true });
  return p.workspace;
}

/**
 * Read the project brief if one is present in the workspace.
 *
 * Returns { found, path, text, truncated }. Never throws: an unreadable brief
 * must degrade to an honest note, never to a crash mid-dispatch.
 */
export function readBrief(project, { maxBytes = 6000 } = {}) {
  const dir = project?.workspace;
  if (!dir) return { found: false, path: null, text: "", truncated: false };
  for (const name of BRIEF_CANDIDATES) {
    const p = path.join(dir, name);
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const truncated = raw.length > maxBytes;
      return { found: true, path: p, text: truncated ? raw.slice(0, maxBytes) : raw, truncated };
    } catch {
      // Unreadable candidate: try the next one rather than failing the command.
    }
  }
  return { found: false, path: null, text: "", truncated: false };
}

/**
 * The context block prepended to a user prompt while a project is active.
 *
 * Only for non-default projects: when health-tracker is active the router is
 * already pointed at the right repo, and injecting a role there would fight
 * the normal coding prompt.
 */
export function buildProjectContext(project, brief, role = "synthesizer") {
  if (!project || project.id === "health-tracker") return "";
  const lines = [];
  lines.push(`[project: ${project.name} (${project.id})]`);
  lines.push(`workspace: ${project.workspace}`);
  lines.push(`your role: ${role}`);
  if (brief?.found) {
    lines.push(
      brief.truncated
        ? `brief: ${brief.path} (truncated to the first part — read the file for the rest)`
        : `brief: ${brief.path}`,
    );
    lines.push("");
    lines.push("--- project brief ---");
    lines.push(brief.text.trim());
    lines.push("--- end brief ---");
  } else {
    // Say it plainly. A missing brief is a real gap, not something to hide.
    lines.push(
      `brief: NONE FOUND in ${project.workspace} (looked for ${BRIEF_CANDIDATES.join(", ")}). ` +
        "This box has no Google Drive credential, so the brief cannot be fetched here — " +
        "sync it into the workspace, then /project again.",
    );
  }
  lines.push("");
  lines.push(
    `Answer as the ${role} for this project. Prefer ${project.workspace} over the default ` +
      `repo (${DEFAULT_PROJECT.workspace}) when the task touches files.`,
  );
  return lines.join("\n");
}
