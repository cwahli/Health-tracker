// Copies canonical shared frameworks into the Grok TG router's vendored
// mirrors. The router ships standalone to the box, so it cannot import
// scripts/ relatively — instead it imports ./*.vendor.mjs, and
// scripts/check-capability-propagation.mjs FAILS if a vendor drifts from its
// canonical file. Edit the canonical file, run this script, and every agent
// (bot-host family + Grok TG) picks it up.
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIRRORS = [
  {
    src: join(ROOT, 'scripts', 'lib', 'tg-progress.mjs'),
    dest: join(ROOT, 'tools', 'telegram-provider-router', 'src', 'tg-progress.vendor.mjs'),
    marker: '// === VENDORED FROM scripts/lib/tg-progress.mjs — DO NOT EDIT ===',
  },
  {
    src: join(ROOT, 'scripts', 'lib', 'free-lanes.mjs'),
    dest: join(ROOT, 'tools', 'telegram-provider-router', 'src', 'free-lane-table.vendor.mjs'),
    marker: '// === VENDORED FROM scripts/lib/free-lanes.mjs — DO NOT EDIT ===',
  },
  {
    src: join(ROOT, 'scripts', 'lib', 'inbound-media.mjs'),
    dest: join(ROOT, 'tools', 'telegram-provider-router', 'src', 'inbound-media.vendor.mjs'),
    marker: '// === VENDORED FROM scripts/lib/inbound-media.mjs — DO NOT EDIT ===',
  },
  {
    // free-lanes.mjs imports this for the per-provider setup verdict, and the
    // router ships standalone, so the import has to resolve inside its src/.
    // Without this mirror the router's own test suite cannot even import
    // free-lane-table.vendor.mjs.
    src: join(ROOT, 'scripts', 'lib', 'setup-gaps.mjs'),
    dest: join(ROOT, 'tools', 'telegram-provider-router', 'src', 'setup-gaps.mjs'),
    marker: '// === VENDORED FROM scripts/lib/setup-gaps.mjs — DO NOT EDIT ===',
  },
];

for (const { src, dest, marker } of MIRRORS) {
  let canonical = readFileSync(src, 'utf8');
  // Shebang must stay on line 1 to remain valid ESM — strip it from libs
  // (shared libs are imported, never executed). Router wrappers keep their own.
  if (canonical.startsWith('#!')) {
    canonical = canonical.replace(/^#[^\n]*\n/, '');
  }
  const header = `${marker}\n// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.\n`;
  writeFileSync(dest, `${header}\n${canonical}`);
  console.log(`synced ${dest} from ${src}`);
}
