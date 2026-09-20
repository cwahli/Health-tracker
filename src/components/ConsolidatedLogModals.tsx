import React from 'react';
import { Table, X } from 'lucide-react';

export interface ConsolidatedLogModalsProps {
  activeModalTableRows: any[] | null;
  activeModalTitle: string;
  setActiveModalTableRows: (rows: any[] | null) => void;
  fullScreenJson: string | null;
  setFullScreenJson: (json: string | null) => void;
  t: any;
}

export const ConsolidatedLogModals: React.FC<ConsolidatedLogModalsProps> = ({
  activeModalTableRows,
  activeModalTitle,
  setActiveModalTableRows,
  fullScreenJson,
  setFullScreenJson,
  t,
}) => {
  return (
    <>
      {/* Full View Consolidated Log Modal */}
      {activeModalTableRows && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-theme-bg-card border border-theme-border rounded-3xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-theme-text font-display">
                    {activeModalTitle}
                  </h3>
                  <p className="text-xs text-theme-text-secondary">
                    {activeModalTitle.includes('Reference')
                      ? (t.demographicallyAdjustedRanges || 'Demographically adjusted reference ranges and risk analysis based on age, gender, and ethnicity')
                      : (t.unifiedViewHealthIndicators || 'Unified view of system-by-system health indicators and 2-year longitudinal insights')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-855 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="overflow-x-auto rounded-2xl border border-theme-border bg-white dark:bg-slate-950 shadow-sm">
                <table className="min-w-[1200px] w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/90 font-bold text-theme-text-secondary sticky top-0 backdrop-blur-sm">
                    <tr>
                      <th className="px-4 py-3 w-[200px]">
                        {activeModalTitle.includes('Reference') ? (t.calibrationDomain || 'Calibration Domain') : (t.systemHeader || 'System')}
                      </th>
                      <th className="px-4 py-3 w-[180px]">{t.biomarkerHeader || 'Biomarker'}</th>
                      <th className="px-4 py-3 w-[120px] text-center">{t.resultHeader || 'Result'}</th>
                      <th className="px-4 py-3 w-[100px] text-center">{t.statusHeader || 'Status'}</th>
                      <th className="px-4 py-3 min-w-[600px]">
                        {activeModalTitle.includes('Reference') ? (t.profileCalibratedRangesExpl || 'Profile Calibrated Ranges & Diagnostic Explanations') : (t.twoYearTrendInsight || '2-Year Trend / Insight (Twice as Wide)')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-slate-800/60 bg-white dark:bg-slate-950 text-theme-neutral font-medium">
                    {activeModalTableRows.map((row, idx) => {
                      const stat = row.status.toUpperCase();
                      let badgeStyle = "text-slate-600 bg-slate-50 dark:bg-slate-900 border-slate-150";
                      if (stat === 'CRITICAL') {
                        badgeStyle = "text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/40";
                      } else if (stat === 'WARNING' || stat === 'AMBER' || stat === 'HIGH' || stat === 'LOW') {
                        badgeStyle = "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/40";
                      } else if (stat === 'NORMAL' || stat === 'OPTIMAL') {
                        badgeStyle = "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/40";
                      }
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
                          <td className="px-4 py-3.5 font-bold text-theme-text-secondary capitalize">{row.system}</td>
                          <td className="px-4 py-3.5 text-theme-text font-bold">{row.biomarker}</td>
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800 dark:text-slate-200">{row.result}</td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold border ${badgeStyle}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-650 dark:text-slate-400 leading-relaxed font-medium whitespace-pre-line">
                            {row.insight}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-theme-text-secondary">
                Showing {activeModalTableRows.length} biomarker correlations. Tip: Use horizontal scroll on narrow views.
              </span>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Full Screen JSON Viewer */}
      {fullScreenJson && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[120] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-theme-bg-card border border-theme-border rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-theme-text font-display">
                    Previous Review Data
                  </h3>
                  <p className="text-xs text-theme-text-secondary">
                    The JSON data provided for context in this conversation step.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFullScreenJson(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="rounded-2xl border border-theme-border bg-white dark:bg-slate-950 shadow-sm p-4 overflow-auto">
                <pre className="text-xs font-mono text-theme-neutral whitespace-pre-wrap break-words">
                  {fullScreenJson}
                </pre>
              </div>
            </div>
            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-theme-border/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-theme-text-secondary">
                Read-only view
              </span>
              <button
                type="button"
                onClick={() => setFullScreenJson(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ConsolidatedLogModals;
