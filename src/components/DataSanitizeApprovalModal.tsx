/**
 * Approval UI: review auto-detected sync/telemetry/food sanitize proposals before apply.
 */
import React, { useMemo, useState } from 'react';
import { UniversalModal } from './UniversalModal';
import { CheckCircle, Zap, Trash2, RefreshCw, Merge } from 'lucide-react';
import { buildDataSanitizePlan, SanitizeProposal } from '../utils/dataSanitize';
import { UserProfile, BiomarkerLog, FoodLog } from '../types';
import { t, interpolate } from '../utils/i18n';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  foodLogs?: FoodLog[];
  onApply: (selected: SanitizeProposal[]) => void | Promise<void>;
};

const kindIcon = (kind: SanitizeProposal['kind']) => {
  if (kind === 'fix_value' || kind === 'backfill_canonical_range') return <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />;
  if (kind === 'merge_food' || kind === 'merge_transposed_dates') return <Merge className="w-3.5 h-3.5 text-indigo-500" />;
  return <Trash2 className="w-3.5 h-3.5 text-rose-500" />;
};

export default function DataSanitizeApprovalModal({
  isOpen,
  onClose,
  profile,
  biomarkers,
  biomarkerHistory,
  foodLogs = [],
  onApply,
}: Props) {
  const plan = useMemo(
    () =>
      buildDataSanitizePlan({
        profile,
        biomarkers,
        biomarkerHistory,
        foodLogs,
      }),
    [profile, biomarkers, biomarkerHistory, foodLogs]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [initialized, setInitialized] = useState(false);
  const [applying, setApplying] = useState(false);

  // Reset selection when plan changes / opens
  React.useEffect(() => {
    if (!isOpen) {
      setInitialized(false);
      return;
    }
    if (!initialized) {
      setSelectedIds(new Set(plan.proposals.filter((p) => p.selected !== false).map((p) => p.id)));
      setInitialized(true);
    }
  }, [isOpen, plan, initialized]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === plan.proposals.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(plan.proposals.map((p) => p.id)));
  };

  if (!isOpen) return null;

  if (plan.proposals.length === 0) {
    return (
      <UniversalModal isOpen={isOpen} onClose={onClose} title={t(profile.language, 'sanitizeTitle')}>
        <div className="p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-theme-neutral">{t(profile.language, 'sanitizeNothing')}</h3>
          <p className="text-xs text-theme-text-secondary">
            {t(profile.language, 'sanitizeNoPhantoms')}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 cursor-pointer"
          >
            {t(profile.language, 'close')}
          </button>
        </div>
      </UniversalModal>
    );
  }

  const { summary } = plan;

  return (
    <UniversalModal isOpen={isOpen} onClose={onClose} title={t(profile.language, 'sanitizeApprovalTitle')}>
      <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-amber-50 to-indigo-50 dark:from-amber-950/30 dark:to-indigo-950/30 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-3.5 flex items-start gap-3">
          <Zap className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1 text-slate-700 dark:text-slate-200">
            <div className="font-bold text-amber-900 dark:text-amber-200">{t(profile.language, 'sanitizeReview')}</div>
            <p>
              Sync and multi-device merge can leave unit-scale errors (e.g. cholesterol 195 mmol/L), duplicate meals, and junk
              dictionary keys. Select what to apply — nothing changes until you approve.
            </p>
            <p className="text-[10px] font-mono text-slate-500 pt-1">
              Fixes: {summary.valueFixes} · Drops: {summary.valueDrops} · Dup logs: {summary.historyDrops} · Junk keys:{' '}
              {summary.customKeyDrops} · Food merges: {summary.foodMerges}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs font-bold text-theme-neutral border-b border-theme-border pb-2">
          <span>
            Proposals ({selectedIds.size} of {plan.proposals.length} selected)
          </span>
          <button type="button" onClick={toggleAll} className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
            {selectedIds.size === plan.proposals.length ? t(profile.language, 'sanitizeDeselect') : t(profile.language, 'sanitizeSelect')}
          </button>
        </div>

        <div className="space-y-2.5">
          {plan.proposals.map((p) => {
            const checked = selectedIds.has(p.id);
            return (
              <label
                key={p.id}
                className={`flex gap-3 border rounded-xl p-3 cursor-pointer transition-all ${
                  checked
                    ? 'border-indigo-300 dark:border-indigo-700/60 bg-white dark:bg-slate-800/80'
                    : 'border-theme-border bg-slate-50/50 dark:bg-slate-900/30 opacity-70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  className="mt-0.5 w-4 h-4 rounded text-indigo-600"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-theme-neutral">
                    {kindIcon(p.kind)}
                    <span className="truncate">{p.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.detail}</p>
                  {(p.oldValue != null || p.newValue != null) && (
                    <p className="text-[11px] font-mono">
                      <span className="text-slate-400 line-through mr-2">{String(p.oldValue ?? '—')}</span>
                      {p.newValue != null && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">→ {String(p.newValue)}</span>
                      )}
                    </p>
                  )}
                  {p.key && (
                    <span className="inline-block text-[9px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {p.key}
                    </span>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-theme-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-theme-border text-theme-neutral hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold cursor-pointer"
          >
            {t(profile.language, 'cancel')}
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0 || applying}
            onClick={async () => {
              setApplying(true);
              try {
                const selected = plan.proposals.filter((p) => selectedIds.has(p.id));
                await onApply(selected);
                onClose();
              } finally {
                setApplying(false);
              }
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            {applying ? t(profile.language, 'sanitizeApplying') : interpolate(t(profile.language, 'sanitizeApplyN'), { n: selectedIds.size })}
          </button>
        </div>
      </div>
    </UniversalModal>
  );
}
