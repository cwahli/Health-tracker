#!/usr/bin/env node
/**
 * Router thin wrapper — single-source is scripts/lib/free-lanes.mjs.
 * This file exists only so existing imports (`from "./free-lane-table.js"`)
 * keep working on the standalone box. Do not add logic here.
 */
export * from "./free-lane-table.vendor.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Router-local default (vendor canonical has no box path). */
export const DEFAULT_TABLE_PATH = join(HERE, "..", "state", "free-lane-table.json");
