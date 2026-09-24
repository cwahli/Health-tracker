#!/usr/bin/env node
/**
 * Smoke: depleted sticky → preference-list nextAvailable includes CF; never re-sticks.
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  nextAvailableRoutes,
  soonestResetAmongDepleted,
  readJson,
} from "../src/free-lane-table.js";

const LIVE_STATE = join(new URL("..", import.meta.url).pathname, "state");
const table = readJson(join(LIVE_STATE, "free-lane-table.json"));
const session = JSON.parse(readFileSync(join(LIVE_STATE, "session.json"), "utf8"));

const stickyModel = "opencode/mimo-v2.6-flash-free";
const routes = nextAvailableRoutes(table, session, {
  fromProvider: "opencode",
  fromModel: stickyModel,
});
if (!routes.length) {
  console.error("FAIL: expected at least one ✅ route after depleted sticky");
  process.exit(1);
}
if (!/qwen3\.8-27b|glm-4\.7-flash|deepseek/i.test(routes[0].model)) {
  console.error("FAIL: first route unexpected", routes[0]);
  process.exit(1);
}
if (routes.some((r) => r.model === stickyModel)) {
  console.error("FAIL: sticky still in failover list");
  process.exit(1);
}

process.env.TG_ROUTER_NO_START = "1";
const { nextFailoverRoutes, isQuotaOrLimitError } = await import("../src/index.js");
const nfr = nextFailoverRoutes("opencode", stickyModel);
if (!nfr.length || nfr[0].model !== routes[0].model) {
  console.error("FAIL: nextFailoverRoutes mismatch", nfr[0], routes[0]);
  process.exit(1);
}
if (!isQuotaOrLimitError(`Sticky OpenCode lane depleted until 2099-01-01T00:00:00.000Z: Rate limit exceeded`)) {
  console.error("FAIL: sticky phrase not quota");
  process.exit(1);
}
console.log("PASS sticky-failover", nfr.map((r) => r.model).join(" → "));
