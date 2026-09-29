import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'lucide-react',
        'motion/react',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        '@supabase/supabase-js',
        'zod',
      ],
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('lucide-react')) return 'vendor-icons';
              if (id.includes('recharts') || id.includes('d3')) return 'vendor-charts';
              if (id.includes('firebase')) return 'vendor-firebase';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('leaflet')) return 'vendor-maps';
              if (id.includes('motion')) return 'vendor-motion';
              return 'vendor';
            }
          }
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/brand_menu_items_local.json',
          '**/tests/**',
          '**/studio/**',
          '**/archive/**',
          '**/*.log',
          '**/tmp/**'
        ]
      },
    },
    test: {
      // `**/prototype/tests/**` are Playwright specs (run via `npm run test:e2e` /
      // `scripts/assert-shell-smoke.mjs`). Without this entry vitest tries to
      // collect them and `npm test` reports ~25 bogus file failures. It was added
      // in 6c25141 and dropped by accident in 7d94def.
      //
      // The `scripts/assert-*.test.mjs` + `scripts/bug-intake.test.mjs` entries below
      // are Node `node:test`/TAP scripts, each run directly via `node scripts/<file>`.
      // Vitest cannot collect them, so `npm test` reported one bogus "No test suite
      // found in file ..." failure per file (33 of them, exit 1).
      //
      // They are listed one by one instead of as `**/scripts/*.test.mjs` on purpose:
      // that glob would also drop the real Vitest suites under `scripts/`
      // (`assert-spec-diff.test.mjs`, `d1-supabase-recovery.test.mjs`,
      // `scripts/lib/*.test.mjs`), and Vitest 4 supports `!` negation in neither
      // `exclude` nor `include` (verified — negatives win globally).
      // Adding a new node:test script? Add its path here.
      exclude: [
        '**/node_modules/**', '**/dist/**', '**/studio/**', '**/archive/**', '**/prototype/tests/**',
        '**/scripts/assert-agent-hygiene.test.mjs',
        '**/scripts/assert-allowance-walk.test.mjs',
        '**/scripts/assert-bot-role-wiring.test.mjs',
        '**/scripts/assert-button-alignment.test.mjs',
        '**/scripts/assert-chat-prefs-survive-restart.test.mjs',
        '**/scripts/assert-command-scope.test.mjs',
        '**/scripts/assert-cooldown-and-dead-ends.test.mjs',
        '**/scripts/assert-council-no-invented-case.test.mjs',
        '**/scripts/assert-external-child-env.test.mjs',
        '**/scripts/assert-external-projects.test.mjs',
        '**/scripts/assert-free-catalogs.test.mjs',
        '**/scripts/assert-freemodel-tiers.test.mjs',
        '**/scripts/assert-google-store.test.mjs',
        '**/scripts/assert-group-addressing.test.mjs',
        '**/scripts/assert-ledger-dir-override.test.mjs',
        '**/scripts/assert-live-view.test.mjs',
        '**/scripts/assert-location-needs-a-worker.test.mjs',
        '**/scripts/assert-one-allowance-model.test.mjs',
        '**/scripts/assert-poller-lease.test.mjs',
        '**/scripts/assert-project3-is-blank.test.mjs',
        '**/scripts/assert-r16-failover.test.mjs',
        '**/scripts/assert-recovery-ledger.test.mjs',
        '**/scripts/assert-relay-auth.test.mjs',
        '**/scripts/assert-session-key.test.mjs',
        '**/scripts/assert-setup-gaps.test.mjs',
        '**/scripts/assert-swap-guards.test.mjs',
        '**/scripts/assert-swap-pack.test.mjs',
        '**/scripts/assert-tui-attach-is-live.test.mjs',
        '**/scripts/assert-tui-gateway.test.mjs',
        '**/scripts/assert-turn-store.test.mjs',
        '**/scripts/assert-work-view.test.mjs',
        '**/scripts/assert-worker-relay.test.mjs',
        '**/scripts/bug-intake.test.mjs',
      ],
    },
  };
});
