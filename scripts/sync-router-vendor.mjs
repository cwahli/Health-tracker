// Copies the canonical working-headline framework into the Grok TG router's
// vendored mirror. The router ships standalone to the box, so it cannot
// import scripts/ relatively — instead it imports ./tg-progress.vendor.mjs,
// and scripts/check-capability-propagation.mjs FAILS if the vendor drifts
// from this canonical file. Change the status line here, run this script,
// and every agent (bot-host family + Grok TG) picks it up.
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR_MARKER = '// === VENDORED FROM scripts/lib/tg-progress.mjs — DO NOT EDIT ===';

const canonical = readFileSync(join(ROOT, 'scripts', 'lib', 'tg-progress.mjs'), 'utf8');
const header = `${VENDOR_MARKER}
// Mirrored by scripts/sync-router-vendor.mjs. Edit the canonical file, not this copy.
`;
writeFileSync(
  join(ROOT, 'tools', 'telegram-provider-router', 'src', 'tg-progress.vendor.mjs'),
  `${header}\n${canonical}`,
);
console.log('router vendor synced from scripts/lib/tg-progress.mjs');
