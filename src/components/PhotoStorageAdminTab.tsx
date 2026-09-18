import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, Trash2, Image as ImageIcon, CheckSquare, Square } from 'lucide-react';
import { auth } from '../firebase';

interface OrphanPhoto {
  key: string;
  size: number;
  lastModified: string | null;
  publicUrl: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function PhotoStorageAdminTab() {
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<OrphanPhoto[]>([]);
  const [totalPhotos, setTotalPhotos] = useState<number | null>(null);
  const [totalOrphanBytes, setTotalOrphanBytes] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasRun, setHasRun] = useState(false);

  const authHeader = async () => {
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const runAudit = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSelected(new Set());
    try {
      const headers = await authHeader();
      const res = await fetch('/api/admin/r2-photo-audit', { headers });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setOrphans(data.orphans || []);
      setTotalPhotos(data.totalPhotos ?? null);
      setTotalOrphanBytes(data.totalOrphanBytes || 0);
      setHasRun(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to run audit');
    } finally {
      setLoading(false);
    }
  };

  const toggleOne = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => (prev.size === orphans.length ? new Set() : new Set(orphans.map(o => o.key))));
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Permanently delete ${selected.size} photo${selected.size === 1 ? '' : 's'} from R2? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setErrorMsg(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
      const res = await fetch('/api/admin/r2-photo-delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ keys: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // Re-run the audit so the list reflects reality rather than assuming
      // every requested key actually got deleted.
      await runAudit();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete photos');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    // Report mode only, on demand - never runs automatically, since a full
    // audit means listing every object in the bucket plus every food log
    // and job row. No point paying that cost until an admin actually opens
    // this tab and asks for it.
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Orphaned Photo Storage</h3>
          <p className="text-xs text-theme-text-secondary mt-1 leading-normal max-w-md">
            Lists photos in R2 storage that no current food log or job references anymore
            (deleted meals, failed jobs, replaced photos never get cleaned up automatically).
            Read-only until you select photos and confirm deletion.
          </p>
        </div>
        <button
          type="button"
          onClick={runAudit}
          disabled={loading}
          className="shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Scanning...' : hasRun ? 'Re-scan' : 'Run Audit'}
        </button>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {hasRun && !loading && (
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <span className="font-bold">{totalPhotos ?? '?'}</span> total photos
          </div>
          <div className={`px-3 py-1.5 rounded-lg ${orphans.length > 0 ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'}`}>
            <span className="font-bold">{orphans.length}</span> orphaned
          </div>
          {orphans.length > 0 && (
            <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <span className="font-bold">{formatBytes(totalOrphanBytes)}</span> reclaimable
            </div>
          )}
        </div>
      )}

      {orphans.length > 0 && (
        <>
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-3">
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 cursor-pointer"
            >
              {selected.size === orphans.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {selected.size === orphans.length ? 'Deselect all' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selected.size === 0 || deleting}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? 'Deleting...' : `Delete ${selected.size || ''}`.trim()}
            </button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {orphans.map(o => (
              <div
                key={o.key}
                onClick={() => toggleOne(o.key)}
                className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${
                  selected.has(o.key)
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {selected.has(o.key) ? <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" /> : <Square className="w-4 h-4 text-slate-400 shrink-0" />}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0 flex items-center justify-center">
                  <img
                    src={o.publicUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">{o.key}</p>
                  <p className="text-[10px] text-theme-text-secondary">
                    {formatBytes(o.size)}{o.lastModified ? ` · ${new Date(o.lastModified).toLocaleDateString()}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {hasRun && !loading && orphans.length === 0 && !errorMsg && (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-theme-text-secondary">
          <ImageIcon className="w-8 h-8 opacity-40" />
          <p className="text-xs">No orphaned photos found. Storage is clean.</p>
        </div>
      )}
    </div>
  );
}
