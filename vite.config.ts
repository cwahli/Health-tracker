import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';
import {defineConfig} from 'vite';

function getGitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const time = execSync('git log -1 --format=%cI', { encoding: 'utf-8' }).trim();
    return { hash, time };
  } catch {
    return { hash: 'unknown', time: new Date().toISOString() };
  }
}

export default defineConfig(() => {
  const git = getGitInfo();
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __GIT_COMMIT_HASH__: JSON.stringify(git.hash),
      __GIT_COMMIT_TIME__: JSON.stringify(git.time),
    },
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
        'clsx',
        'tailwind-merge',
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
      exclude: ['**/node_modules/**', '**/dist/**', '**/studio/**', '**/archive/**'],
    },
  };
});
