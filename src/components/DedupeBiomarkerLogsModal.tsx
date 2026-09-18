import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Check, Loader, Trash2 } from 'lucide-react';

interface DedupeBiomarkerLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DedupeBiomarkerLogsModal: React.FC<DedupeBiomarkerLogsModalProps> = ({ isOpen, onClose }) => {
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRunReport, setDryRunReport] = useState<any>(null);
  const [applyReport, setApplyReport] = useState<any>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  if (!isOpen) return null;

  const runDedupe = async (commit: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/admin/dedupe-biomarker-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secret
        },
        body: JSON.stringify({ uid: 'hiJun2hTdDTk2igwerun2LKvwb42', commit })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || `Request failed (${res.status})`);
        return;
      }
      if (commit) {
        setApplyReport(json);
      } else {
        setDryRunReport(json);
        setApplyReport(null);
        setConfirmChecked(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setDryRunReport(null);
    setApplyReport(null);
    setError(null);
    setConfirmChecked(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end sm:items-center justify-center">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-white font-bold text-sm">Dedupe Biomarker Logs</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Merges duplicate biomarker_logs rows that share a date (from the
            lab-report parser key-mismatch bug). Never overwrites an existing
            value — only merges rows and removes the now-redundant duplicate.
            Run a dry run first.
          </p>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Admin secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); reset(); }}
              placeholder="ADMIN_MIGRATION_SECRET"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="text-rose-400 text-xs bg-rose-950/30 border border-rose-900/40 rounded-lg p-3">
              {error}
            </div>
          )}

          {!dryRunReport && !applyReport && (
            <button
              onClick={() => runDedupe(false)}
              disabled={loading || !secret}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 text-slate-200 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? <Loader className="w-4 h-4 animate-spin" /> : null}
              Run Dry Run
            </button>
          )}

          {dryRunReport && !applyReport && (
            <div className="space-y-3">
              <div className="bg-slate-800/60 rounded-xl p-3 text-xs text-slate-300 space-y-1">
                <div>Dates scanned: <span className="text-white font-semibold">{dryRunReport.datesScanned}</span></div>
                <div>Duplicate groups found: <span className="text-white font-semibold">{dryRunReport.duplicateGroups}</span></div>
                <div>Rows that will be merged into: <span className="text-white font-semibold">{dryRunReport.rowsMerged}</span></div>
                <div>Rows that will be deleted: <span className="text-white font-semibold">{dryRunReport.rowsDeleted}</span></div>
              </div>

              {dryRunReport.conflictsSkipped?.length > 0 && (
                <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {dryRunReport.conflictsSkipped.length} value conflict(s) — worth a look
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-auto">
                    {dryRunReport.conflictsSkipped.map((c: any, i: number) => (
                      <div key={i} className="text-[10px] text-amber-200/80 font-mono">
                        {c.date} — {c.key}: kept {String(c.keptValue)}, dropped {String(c.droppedValue)} (from {c.droppedFromId})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dryRunReport.duplicateGroups > 0 ? (
                <>
                  <label className="flex items-start gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={confirmChecked}
                      onChange={(e) => setConfirmChecked(e.target.checked)}
                      className="mt-0.5"
                    />
                    I understand this will permanently delete {dryRunReport.rowsDeleted} duplicate row(s) after merging their unique data.
                  </label>
                  <button
                    onClick={() => runDedupe(true)}
                    disabled={loading || !confirmChecked}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Apply Cleanup
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 text-emerald-400 text-xs">
                  <Check className="w-4 h-4" /> No duplicates found — nothing to clean up.
                </div>
              )}

              <button onClick={reset} className="w-full text-center text-xs text-slate-500 py-1">
                Run again
              </button>
            </div>
          )}

          {applyReport && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                <Check className="w-4 h-4" /> Cleanup applied
              </div>
              <div className="bg-slate-800/60 rounded-xl p-3 text-xs text-slate-300 space-y-1">
                <div>Rows merged into: <span className="text-white font-semibold">{applyReport.rowsMerged}</span></div>
                <div>Duplicate rows deleted: <span className="text-white font-semibold">{applyReport.rowsDeleted}</span></div>
              </div>
              <p className="text-xs text-slate-400">
                Re-open "Flagged Telemetry &amp; Outlier Errors" and Sync to confirm the outliers are gone for good.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DedupeBiomarkerLogsModal;
