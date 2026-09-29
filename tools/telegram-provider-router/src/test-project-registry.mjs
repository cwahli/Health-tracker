import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROJECT,
  buildProjectContext,
  describeProject,
  ensureWorkspace,
  knownProjectList,
  readBrief,
  resolveProjectId,
} from "./project-registry.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "router-projects-"));

function tmpProject(id = "external-4") {
  const p = describeProject(id);
  p.workspace = path.join(tmpRoot, id);
  return p;
}

test("resolves the health-tracker aliases", () => {
  for (const a of ["ht", "main", "website", "health-tracker", "1", "project 1", " 1 "]) {
    assert.equal(resolveProjectId(a), "health-tracker", a);
  }
});

test("resolves project 2 aliases", () => {
  for (const a of ["2", "project 2", "external 2", "pip", "pip-defense"]) {
    assert.equal(resolveProjectId(a), "external-2", a);
  }
});

test("REGRESSION: resolves /project external 4 in every spelling", () => {
  // The reported failure was `/project_external_4` being ignored entirely.
  for (const a of ["external 4", "external-4", "external_4", "ext 4", "ext4", "4", "project 4", "4th"]) {
    assert.equal(resolveProjectId(a), "external-4", a);
  }
});

test("rejects nonsense rather than inventing a project", () => {
  for (const a of ["", "   ", "banana", "external", "project", null, undefined]) {
    assert.equal(resolveProjectId(a), null, String(a));
  }
});

test("describeProject gives external-N a real workspace path", () => {
  const p = describeProject("external-4");
  assert.equal(p.id, "external-4");
  assert.equal(p.type, "external");
  assert.equal(p.projectNumber, 4);
  assert.ok(p.workspace.endsWith(path.join("projects", "external-4")));
});

test("the default project is the repo, and is not an external project", () => {
  assert.equal(DEFAULT_PROJECT.id, "health-tracker");
  assert.equal(DEFAULT_PROJECT.type, "internal");
});

test("knownProjectList names real options for the error path", () => {
  const l = knownProjectList();
  assert.ok(l.some((x) => x.includes("health-tracker")));
  assert.ok(l.some((x) => x.includes("external-2")));
});

// --- brief ----------------------------------------------------------------

test("readBrief finds a brief and reports its path", () => {
  const p = tmpProject("external-4");
  fs.mkdirSync(p.workspace, { recursive: true });
  fs.writeFileSync(path.join(p.workspace, "BRIEF.md"), "# Brief\nbe honest\n");
  const b = readBrief(p);
  assert.equal(b.found, true);
  assert.ok(b.path.endsWith("BRIEF.md"));
  assert.match(b.text, /be honest/);
  assert.equal(b.truncated, false);
});

test("a missing brief is reported, never thrown", () => {
  const b = readBrief(tmpProject("external-5"));
  assert.equal(b.found, false);
  assert.equal(b.text, "");
});

test("an oversized brief is truncated and says so", () => {
  const p = tmpProject("external-6");
  fs.mkdirSync(p.workspace, { recursive: true });
  fs.writeFileSync(path.join(p.workspace, "BRIEF.md"), "x".repeat(9000));
  const b = readBrief(p, { maxBytes: 100 });
  assert.equal(b.truncated, true);
  assert.equal(b.text.length, 100);
});

test("readBrief never throws on a project with no workspace", () => {
  assert.equal(readBrief({}).found, false);
  assert.equal(readBrief(null).found, false);
});

// --- prompt context --------------------------------------------------------

test("no context is injected for the default project", () => {
  // Injecting into the normal coding prompt would fight it.
  assert.equal(buildProjectContext(DEFAULT_PROJECT, { found: false }), "");
  assert.equal(buildProjectContext(null, { found: false }), "");
});

test("context names the project, workspace and role", () => {
  const ctx = buildProjectContext(tmpProject("external-4"), { found: false }, "synthesizer");
  assert.match(ctx, /project: External Project 4 \(external-4\)/);
  assert.match(ctx, /your role: synthesizer/);
  assert.match(ctx, /external-4/);
});

test("context inlines the brief text when present", () => {
  const p = tmpProject("external-4");
  fs.mkdirSync(p.workspace, { recursive: true });
  fs.writeFileSync(path.join(p.workspace, "BRIEF.md"), "consensus so far: 2 of 3");
  const b = readBrief(p);
  const ctx = buildProjectContext(p, b, "synthesizer");
  assert.match(ctx, /--- project brief ---/);
  assert.match(ctx, /consensus so far: 2 of 3/);
  assert.match(ctx, /--- end brief ---/);
});

test("a missing brief is stated honestly in the prompt", () => {
  const ctx = buildProjectContext(tmpProject("external-4"), { found: false }, "synthesizer");
  assert.match(ctx, /brief: NONE FOUND/);
  assert.match(ctx, /no Google Drive credential/);
});

test("a truncated brief tells the model the file has more", () => {
  const p = tmpProject("external-4");
  fs.mkdirSync(p.workspace, { recursive: true });
  fs.writeFileSync(path.join(p.workspace, "BRIEF.md"), "y".repeat(500));
  const b = readBrief(p, { maxBytes: 50 });
  const ctx = buildProjectContext(p, b, "synthesizer");
  assert.match(ctx, /truncated/);
});

// --- workspace creation ----------------------------------------------------

test("ensureWorkspace creates the external dir and is idempotent", async () => {
  const mod = await import("./project-registry.mjs");
  const id = "external-9";
  const target = mod.describeProject(id).workspace;
  fs.rmSync(target, { recursive: true, force: true });
  const first = mod.ensureWorkspace(id);
  assert.equal(first, target);
  assert.ok(fs.existsSync(target), "workspace dir was created");
  // Idempotent: a second call must not throw or change the path.
  assert.equal(mod.ensureWorkspace(id), target);
  fs.rmSync(target, { recursive: true, force: true });
});

test("ensureWorkspace does not create a dir for the default project", async () => {
  const mod = await import("./project-registry.mjs");
  // health-tracker already exists as the repo; ensureWorkspace must not mkdir it.
  assert.equal(mod.ensureWorkspace("health-tracker"), mod.DEFAULT_PROJECT.workspace);
});

test("ensureWorkspace refuses an unknown project id", () => {
  assert.throws(() => ensureWorkspace("nope"), /Unknown project/);
});

test.after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
