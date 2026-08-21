import React from 'react';
import { PHASE_LABEL, groupJourneyByDish } from '../../utils/goldenScoreboard';
import { Play, Loader2 } from 'lucide-react';
import { AutoSpotList } from './AutoSpotList';
import type { AutoSpotHit } from '../../utils/bugAutoSpot';

export type FoodDetailTabsProps = {
  activeTab: 'checks' | 'dishes' | 'scout' | 'balance' | 'history';
  onTabChange: (tab: 'checks' | 'dishes' | 'scout' | 'balance' | 'history') => void;
  board?: any;
  goldenLines?: any[];
  onAddDish?: () => void;
  onReplayLog?: () => void;
  replayingLog?: boolean;
  onReplayCatalog?: () => void;
  replayingCatalog?: boolean;
  onReanalyze?: () => void;
  canReanalyze?: boolean;
  className?: string;
};

/**
 * Computes pass vs fail breakdown from a scoreboard/board object.
 * Maps outcomes/invariants into passCount, failCount, and percentage distributions.
 * (Scouted only / label filters do not count as remaining issues).
 */
export function computeBoardProgress(board?: any) {
  if (!board) return { passCount: 0, failCount: 0, total: 0, passPct: 0, failPct: 0 };
  const invariants = Array.isArray(board.invariants)
    ? board.invariants.filter((i: any) => {
        const text = `${i.id || ''} ${i.label || ''}`;
        if (/scouted only/i.test(text)) return false;
        if (/^j_/i.test(String(i.id || ''))) return false;
        return true;
      })
    : [];
  const outcomes = Array.isArray(board.outcomes)
    ? board.outcomes.filter((o: any) => {
        const text = `${o.id || ''} ${o.label || ''} ${o.name || ''}`;
        if (/scouted only/i.test(text)) return false;
        if (/^j_/i.test(String(o.id || ''))) return false;
        return true;
      })
    : [];

  let passCount = 0;
  let failCount = 0;

  if (invariants.length > 0) {
    passCount = invariants.filter((i: any) => i.pass === true || i.status === 'pass').length;
    failCount = invariants.filter((i: any) => i.pass !== true && i.status !== 'pass').length;
  } else if (outcomes.length > 0) {
    passCount = outcomes.filter((o: any) => o.pass === true || o.status === 'pass').length;
    failCount = outcomes.filter((o: any) => o.pass !== true && o.status !== 'pass').length;
  } else if (board.passCount != null || board.failCount != null) {
    passCount = Number(board.passCount || 0);
    failCount = Number(board.failCount || 0);
  }

  const total = passCount + failCount;
  const passPct = total > 0 ? Math.round((passCount / total) * 100) : 0;
  const failPct = total > 0 ? 100 - passPct : 0;

  return { passCount, failCount, total, passPct, failPct };
}

/**
 * FoodDetailTabs — 5-tab navigation strip for food cards on BugTrackerModal (Q-6.4 G1/G2).
 * Tabs: Checks · Dishes · Scout identity · Balance · History
 * (History renders the primary tracker commits timeline in parent).
 */
export const FoodDetailTabs: React.FC<FoodDetailTabsProps> = ({
  activeTab,
  onTabChange,
  board,
  goldenLines = [],
  onAddDish,
  onReplayLog,
  replayingLog = false,
  onReplayCatalog,
  replayingCatalog = false,
  onReanalyze,
  canReanalyze = false,
  className = '',
}) => {
  const journey = Array.isArray(board?.journey) ? board.journey : [];
  const invariants = Array.isArray(board?.invariants) ? board.invariants : [];
  const autoSpotHits: AutoSpotHit[] = Array.isArray(board?.autoSpot) ? board.autoSpot : [];
  const ledger = board?.ledger;
  const progress = computeBoardProgress(board);

  const effectiveDishes = goldenLines.length > 0 ? goldenLines : (Array.isArray(board?.expectedMeal) ? board.expectedMeal : []);

  return (
    <div className={`space-y-2.5 ${className}`} data-testid="food-detail-tabs">
      {/* Green/Red Outcome Bar from Board (G2-3) */}
      {board && progress.total > 0 && (
        <div className="rounded-xl bg-slate-950 p-2.5 border border-white/15 space-y-1.5" data-testid="board-progress-bar">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${progress.failCount === 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              Board Outcomes
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-emerald-400 font-semibold">{progress.passCount} pass</span>
              <span className="text-white/40">·</span>
              <span className="text-rose-400 font-semibold">{progress.failCount} fail</span>
              {board?.jobId && <span className="text-white/40">· job {String(board.jobId).slice(0, 8)}</span>}
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-black/60 overflow-hidden flex">
            {progress.passCount > 0 && (
              <div
                className="bg-emerald-500 transition-all duration-300"
                style={{ width: `${progress.passPct}%` }}
                title={`${progress.passCount} passed`}
              />
            )}
            {progress.failCount > 0 && (
              <div
                className="bg-rose-500 transition-all duration-300"
                style={{ width: `${progress.failPct}%` }}
                title={`${progress.failCount} failed`}
              />
            )}
          </div>
        </div>
      )}

      {/* 5-Tab Navigation Strip */}
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex rounded-xl bg-slate-950 p-1 border border-white/15 gap-1 flex-1 flex-wrap">
          <button
            type="button"
            onClick={() => onTabChange('history')}
            className={`flex-1 min-w-[65px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => onTabChange('checks')}
            className={`flex-1 min-w-[65px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === 'checks'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Checks
          </button>
          <button
            type="button"
            onClick={() => onTabChange('dishes')}
            className={`flex-1 min-w-[65px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === 'dishes'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Dishes
          </button>
          <button
            type="button"
            onClick={() => onTabChange('scout')}
            className={`flex-1 min-w-[65px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === 'scout'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Scout identity
          </button>
          <button
            type="button"
            onClick={() => onTabChange('balance')}
            className={`flex-1 min-w-[65px] py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
              activeTab === 'balance'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Balance
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
        {onReplayLog && (
          <button
            type="button"
            disabled={replayingLog}
            onClick={onReplayLog}
            className="py-1.5 px-2.5 rounded-xl bg-sky-950/70 hover:bg-sky-900 border border-sky-500/40 text-sky-200 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
            title="Replay saved tape (preview only, no agent)"
          >
            {replayingLog ? <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" /> : <Play className="w-3.5 h-3.5 text-sky-400" />}
            <span>Replay log</span>
          </button>
        )}
        {onReplayCatalog && (
          <button
            type="button"
            disabled={replayingCatalog}
            onClick={onReplayCatalog}
            className="py-1.5 px-2.5 rounded-xl bg-teal-950/70 hover:bg-teal-900 border border-teal-500/40 text-teal-200 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
            title="Frozen scout × dictionary. Preview only — does not mark the card done."
          >
            {replayingCatalog ? <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" /> : <Play className="w-3.5 h-3.5 text-teal-400" />}
            <span>Replay catalog</span>
          </button>
        )}
        {onReanalyze && (
          <button
            type="button"
            disabled={!canReanalyze}
            onClick={onReanalyze}
            className="py-1.5 px-2.5 rounded-xl bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
            title={canReanalyze ? 'Open the saved food job' : 'No saved job_id on this card'}
          >
            <Play className="w-3.5 h-3.5 text-indigo-400" />
            <span>Re-analyze</span>
          </button>
        )}
        </div>
      </div>

      {/* Pane: Checks */}
      {activeTab === 'checks' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          {autoSpotHits.length > 0 && (
            <AutoSpotList hits={autoSpotHits} className="mb-2" />
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
              Journey Checks & Invariants ({invariants.length})
            </span>
          </div>

          {invariants.length === 0 ? (
            <p className="text-[11px] text-white/50 italic">No invariant checks recorded on this meal tape.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {invariants.map((inv: any, idx: number) => {
                const isPass = inv.pass === true || inv.status === 'pass';
                return (
                  <div
                    key={inv.id || idx}
                    className={`flex items-start justify-between gap-2 p-2 rounded-lg border text-[11px] ${
                      isPass
                        ? 'bg-emerald-950/30 border-emerald-500/20 text-emerald-100'
                        : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
                    }`}
                  >
                    <span className="leading-snug">{inv.label || inv.id}</span>
                    <span
                      className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                        isPass ? 'bg-emerald-900/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'
                      }`}
                    >
                      {isPass ? 'pass' : inv.status || 'fail'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pane: Dishes */}
      {activeTab === 'dishes' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
              Top Dishes Target Values ({effectiveDishes.length})
            </span>
            {onAddDish && (
              <button
                type="button"
                onClick={onAddDish}
                className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
              >
                + Add Dish
              </button>
            )}
          </div>

          {effectiveDishes.length === 0 ? (
            <p className="text-[11px] text-white/50 italic">No target dishes defined for this meal.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/40">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-400">
                    <th className="py-1 px-2 text-left w-6">✓</th>
                    <th className="py-1 px-2 text-left">Dish</th>
                    <th className="py-1 px-2 text-right">kcal</th>
                    <th className="py-1 px-2 text-right">g</th>
                    <th className="py-1 px-2 text-right">P</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {effectiveDishes.map((line: any, idx: number) => (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="py-1 px-2 text-emerald-400 font-bold">
                        {line.scored !== false ? '✓' : ''}
                      </td>
                      <td className="py-1 px-2 font-medium text-white">{line.name}</td>
                      <td className="py-1 px-2 text-right text-amber-200">{line.calories ?? '—'}</td>
                      <td className="py-1 px-2 text-right text-emerald-200">{line.weightGrams ?? '—'}</td>
                      <td className="py-1 px-2 text-right text-blue-200">{line.protein ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pane: Scout identity */}
      {activeTab === 'scout' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
            Scout Journey — {journey.filter((j: any) => j.identityPass).length}/{journey.length} identified
          </div>

          {journey.length === 0 ? (
            <p className="text-[11px] text-white/50 italic">No scout journey items available.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {groupJourneyByDish(journey).map((g) => (
                <div key={g.dish} className="space-y-0.5">
                  <p className="text-[11px] font-bold text-indigo-200">{g.dish}</p>
                  <div className="space-y-0.5 pl-2">
                    {g.rows.map((j: any) => (
                      <div
                        key={j.id}
                        className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/5 last:border-0"
                      >
                        <span className="text-white/80">{j.query}</span>
                        <span
                          className={`text-[10px] font-bold ${
                            j.identityPass ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {PHASE_LABEL[j.phase as keyof typeof PHASE_LABEL] || j.phase}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pane: Balance */}
      {activeTab === 'balance' && (
        <div className="bg-[#0f172a] border border-slate-700/80 rounded-xl p-3 space-y-2.5 text-xs text-white">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-violet-300">
              Meal Journey / Trial Balance
            </span>
            {ledger && (
              <span
                className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${
                  ledger.compiler === 'green'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {ledger.compiler === 'green' ? 'balanced' : 'unbalanced'}
              </span>
            )}
          </div>

          {!ledger ? (
            <p className="text-[11px] text-white/50 italic">No ledger compile data available for this meal.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(ledger.books || []).map((b: any) => (
                  <div key={b.id} className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-[10px]">
                    <p className="text-white/50">{b.label?.replace(/ \(.*/, '')}</p>
                    <p className="font-bold text-white text-xs">{b.kcal == null ? '—' : `${b.kcal} kcal`}</p>
                  </div>
                ))}
              </div>

              {(ledger.imbalances || []).length > 0 && (
                <div className="space-y-1 bg-rose-950/30 p-2 rounded-lg border border-rose-500/30">
                  {ledger.imbalances.map((imb: any) => (
                    <p key={imb.id} className="text-[10px] text-rose-200">
                      <strong>{imb.signal}:</strong> {imb.label}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
