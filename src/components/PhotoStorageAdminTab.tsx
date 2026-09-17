import React, { useState } from 'react';
import { Database, Image as ImageIcon, Trash2, RefreshCw } from 'lucide-react';

export function PhotoStorageAdminTab() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ totalPhotos: number; totalSizeMb: number } | null>(null);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/photo-storage-stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" id="photo-storage-admin-tab">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-indigo-500" />
            Photo Storage Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Monitor and manage food and medical image assets stored in R2 and local caches.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 transition-colors"
          id="photo-storage-refresh-btn"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Stats
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700" id="photo-storage-r2-card">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">R2 Object Storage</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cloudflare R2 storage bucket for durable image persistence.
          </p>
          <div className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? `${stats.totalPhotos} photos` : 'Connected'}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700" id="photo-storage-cache-card">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Client IndexedDB Cache</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Local browser cache for offline previews and immediate rendering.
          </p>
          <div className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
            Active
          </div>
        </div>
      </div>
    </div>
  );
}

export default PhotoStorageAdminTab;
