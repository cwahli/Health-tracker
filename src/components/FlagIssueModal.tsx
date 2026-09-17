import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bug, Camera, Check, ClipboardPaste, ListPlus, Plus, Trash2, Upload, X } from 'lucide-react';
import { BugCategory, ISSUE_TYPE_LABELS, IssueType } from '../utils/issueBacklog';
import { hydrateWorkItem, publicId } from '../utils/bugWorkItem';
import { parseBatchBugs } from '../utils/bugBatchParser';

export interface IssueEntry {
  id: string;
  selectedTagId: string; // '' | 'new_bug' | bugTag.id
  newBugTitle: string;
  issueType: IssueType;
  customIssueType: string;
  userNote: string;
  officialUrl: string;
  screenshotDataUrl?: string;
}

export interface FlagIssueFormProps {
  initialCategory?: BugCategory;
  contextPayload?: Record<string, unknown>;
  getPayload?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  chainKey?: string;
  dishQuery?: string;
  countryCode?: string;
  firebaseUid?: string;
  sessionId?: string;
  existingBugTags?: any[];
  onSuccess?: (lastSubmittedId?: string) => void;
  onCancel?: () => void;
}

export const CATEGORY_OPTIONS: { key: BugCategory; label: string }[] = [
  { key: 'foodcart', label: 'Food Cart' },
  { key: 'biomarker', label: 'Biomarker' },
  { key: 'database', label: 'Database' },
  { key: 'Home', label: 'Home' },
  { key: 'Other', label: 'Other' },
];

const createEmptyEntry = (): IssueEntry => ({
  id: Math.random().toString(36).slice(2, 9),
  selectedTagId: '',
  newBugTitle: '',
  issueType: 'incorrect_answer',
  customIssueType: '',
  userNote: '',
  officialUrl: '',
  screenshotDataUrl: '',
});

export function saveBugTrackerCache(json: any) {
  try {
    if (!json || typeof json !== 'object') return;
    const nowStr = new Date().toLocaleTimeString();
    const prunedBugTags = Array.isArray(json.bugTags)
      ? json.bugTags.slice(0, 100).map((t: any) => ({
          id: t.id,
          title: t.title,
          category: t.category,
          status: t.status,
          whats_still_open: t.whats_still_open,
          resolution_note: t.resolution_note,
          comments: Array.isArray(t.comments) ? t.comments.slice(-5) : [],
          work_item: t.work_item || null,
          public_n: t.public_n || 0,
          public_id: t.public_id || null,
          last_commit: t.last_commit || null,
          linked_count: t.linked_count,
        }))
      : [];
    const pruned = {
      bugTags: prunedBugTags,
      _cachedAt: json._cachedAt || nowStr
    };
    localStorage.setItem('bug_tracker_local_cache', JSON.stringify(pruned));
  } catch (_) {
    try {
      localStorage.removeItem('bug_tracker_local_cache');
    } catch (_) {}
  }
}

export function FlagIssueForm({
  initialCategory = 'foodcart',
  contextPayload = {},
  getPayload,
  chainKey,
  dishQuery,
  countryCode = 'GB',
  firebaseUid,
  sessionId,
  existingBugTags,
  onSuccess,
  onCancel,
}: FlagIssueFormProps) {
  const [category, setCategory] = useState<BugCategory>(initialCategory);
  const [entries, setEntries] = useState<IssueEntry[]>([createEmptyEntry()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const [bugTags, setBugTags] = useState<any[]>(existingBugTags || []);

  const loadOverview = () => {
    try {
      const saved = localStorage.getItem('bug_tracker_local_cache');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.bugTags) && parsed.bugTags.length > 0) {
          setBugTags(parsed.bugTags);
        }
      }
    } catch {}

    fetch('/api/bug-tracker/overview')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.bugTags)) {
          setBugTags(data.bugTags);
          saveBugTrackerCache(data);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (existingBugTags && existingBugTags.length > 0) {
      setBugTags(existingBugTags);
    } else {
      loadOverview();
    }
  }, [existingBugTags]);

  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);

  const activeBugsForCategory = bugTags.filter(
    (t: any) => (t.category || 'foodcart') === category && t.status !== 'fixed'
  );

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchRawText, setBatchRawText] = useState('');
  const parsedBatchItems = parseBatchBugs(batchRawText);

  const handleBatchAdd = (bugTexts: string[]) => {
    if (!bugTexts.length) return;
    const newItems: IssueEntry[] = bugTexts.map((text) => ({
      id: Math.random().toString(36).slice(2, 9),
      selectedTagId: 'new_bug',
      newBugTitle: text,
      issueType: 'incorrect_answer',
      customIssueType: '',
      userNote: '',
      officialUrl: '',
      screenshotDataUrl: '',
    }));

    setEntries((prev) => {
      // If the first entry is empty/unconfigured, replace it
      if (
        prev.length === 1 &&
        !prev[0].selectedTagId &&
        !prev[0].newBugTitle &&
        !prev[0].userNote
      ) {
        return newItems;
      }
      return [...prev, ...newItems];
    });
  };

  const handleTitlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const parsed = parseBatchBugs(text);
    if (parsed.length > 1) {
      e.preventDefault();
      updateEntry(index, { newBugTitle: parsed[0] });
      const additional: IssueEntry[] = parsed.slice(1).map((item) => ({
        id: Math.random().toString(36).slice(2, 9),
        selectedTagId: 'new_bug',
        newBugTitle: item,
        issueType: 'incorrect_answer',
        customIssueType: '',
        userNote: '',
        officialUrl: '',
        screenshotDataUrl: '',
      }));
      setEntries((prev) => {
        const next = [...prev];
        next.splice(index + 1, 0, ...additional);
        return next;
      });
    }
  };

  const updateEntry = (index: number, patch: Partial<IssueEntry>) => {
    setEntries((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, createEmptyEntry()]);
  };

  const removeEntry = (index: number) => {
    if (entries.length <= 1) return;
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Validation
    for (let i = 0; i < entries.length; i++) {
      const ent = entries[i];
      if (ent.selectedTagId === 'new_bug' && !ent.newBugTitle.trim()) {
        setError(`Please enter a title for the new bug in issue #${i + 1}.`);
        setSubmitting(false);
        return;
      }
      if (false) {
        // removed
        setSubmitting(false);
        return;
      }
    }

    try {
      let resolvedPayload = contextPayload;
      if (getPayload) {
        resolvedPayload = await Promise.resolve(getPayload());
      }

      let firstCreatedId: string | undefined = undefined;

      for (const ent of entries) {
        const body = {
          issue_type: 'general_bug',
          
          category,
          tag_id: ent.selectedTagId && ent.selectedTagId !== 'new_bug' ? ent.selectedTagId : undefined,
          new_bug_title: ent.selectedTagId === 'new_bug' ? ent.newBugTitle.trim() : undefined,
          chain_key: chainKey,
          dish_query: dishQuery,
          user_note: ent.userNote.trim() || undefined,
          register_source_url: ent.officialUrl.trim() || undefined,
          source_url: ent.officialUrl.trim() || undefined,
          country_code: countryCode,
          firebase_uid: firebaseUid,
          payload: {
            ...resolvedPayload,
            modalTitle: 'Flag food analysis issue',
            flaggedAt: new Date().toISOString(),
            screenshot_data: ent.screenshotDataUrl || undefined,
            screenshot_url: ent.screenshotDataUrl || undefined,
          },
        };

        const res = await fetch('/api/issues/flag', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionId ? { 'X-Session-ID': sessionId } : {}),
          },
          body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }

        if (!firstCreatedId && json.id) {
          firstCreatedId = json.id;
        }
      }

      loadOverview();
      setSuccessMsg(true);
      setTimeout(() => {
        setSuccessMsg(false);
        setEntries([createEmptyEntry()]);
        if (onSuccess) onSuccess(firstCreatedId);
      }, 900);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit issue report');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full text-xs rounded-xl px-3 py-2 bg-slate-950/80 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-indigo-400 transition-colors';

  return (
    <form onSubmit={handleSubmit} className="space-y-5 text-white text-xs">
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/90 border border-rose-500/50 text-rose-200 flex items-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 flex items-center gap-2 font-bold text-xs">
          <Check className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>Issue(s) submitted to backlog successfully!</span>
        </div>
      )}

      {/* Category selector */}
      <div className="space-y-1.5 bg-slate-900/60 p-3 rounded-2xl border border-white/10">
        <label className="block text-[11px] font-bold text-white/90">Category</label>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as BugCategory);
            setEntries((prev) =>
              prev.map((ent) => ({ ...ent, selectedTagId: '' }))
            );
          }}
          className={inputCls}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.key} value={c.key} className="bg-slate-900 text-white">
              {c.label} ({bugTags.filter((t: any) => (t.category || 'foodcart') === c.key).length} active bugs)
            </option>
          ))}
        </select>
      </div>

      {/* Entry Cards */}
      <div className="space-y-4">
        {entries.map((entry, idx) => {
          const selectedBugTag = activeBugsForCategory.find(
            (t: any) => t.id === entry.selectedTagId
          );

          return (
            <div
              key={entry.id}
              className="p-4 rounded-2xl bg-slate-900/80 border border-white/15 space-y-3.5 shadow-md relative"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <span className="font-bold text-xs text-indigo-300 flex items-center gap-1.5">
                  <Bug className="w-3.5 h-3.5 text-rose-400" /> Issue #{idx + 1}
                </span>

                {entries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEntry(idx)}
                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition-colors"
                    title="Remove issue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Identified Bugs Dropdown */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-white/90">
                  Identified Bugs ({activeBugsForCategory.length})
                </label>
                <select
                  value={entry.selectedTagId}
                  onChange={(e) => updateEntry(idx, { selectedTagId: e.target.value })}
                  className={inputCls}
                >
                  <option value="" className="bg-slate-900 text-white">
                    -- Select open #n or create new --
                  </option>
                  <option value="new_bug" className="bg-indigo-900 text-amber-300 font-bold">
                    + Create new bug...
                  </option>
                  {activeBugsForCategory.map((t: any) => {
                    const pubId = publicId(hydrateWorkItem(t), t.id);
                    return (
                      <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                        Open {pubId}: {t.title}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* If "new bug" selected -> input for new bug title */}
              {entry.selectedTagId === 'new_bug' && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-1.5">
                  <label className="block text-[11px] font-bold text-amber-300">
                    New Bug Title (will be #{bugTags.reduce((max, t) => Math.max(max, hydrateWorkItem(t).public_n || 0), 0) + 1}) *
                  </label>
                  <input
                    type="text"
                    value={entry.newBugTitle}
                    onChange={(e) => updateEntry(idx, { newBugTitle: e.target.value })}
                    onPaste={(e) => handleTitlePaste(e, idx)}
                    placeholder="Enter descriptive title or paste multiple bugs (auto-splits)..."
                    className={inputCls}
                  />
                </div>
              )}

              {/* If existing bug tag selected -> show pinned bug status, progress, open points, comments */}
              {selectedBugTag && (() => {
                const item = hydrateWorkItem(selectedBugTag);
                const pubId = publicId(item, selectedBugTag.id);
                return (
                  <div className="p-3.5 rounded-xl bg-indigo-950/50 border border-indigo-500/40 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-indigo-200 text-xs flex items-center gap-1.5">
                        <Bug className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        Identified Bug: Open {pubId} — {selectedBugTag.title}
                      </p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-200 border border-indigo-400/30 shrink-0">
                        Queue: {item.queue || selectedBugTag.status || 'ready'}
                      </span>
                    </div>

                    {item.bug && (
                      <div className="text-[11px] bg-black/60 p-2.5 rounded-lg text-white/95 whitespace-pre-wrap border border-amber-500/30">
                        <span className="font-bold text-amber-300">Pinned Bug Instruction: </span>
                        {item.bug}
                      </div>
                    )}

                    {selectedBugTag.resolution_note ? (
                      <div className="text-[11px] bg-black/50 p-2.5 rounded-lg text-white/90 whitespace-pre-wrap border border-white/10">
                        <span className="font-bold text-emerald-300">Progress / Attempts: </span>
                        {selectedBugTag.resolution_note}
                      </div>
                    ) : null}

                    {item.remaining.length > 0 && (
                      <div className="text-[11px] bg-black/50 p-2.5 rounded-lg text-amber-200 whitespace-pre-wrap border border-white/10">
                        <span className="font-bold text-amber-400">Remaining open items: </span>
                        {item.remaining.join(' · ')}
                      </div>
                    )}

                    {Array.isArray(selectedBugTag.comments) && selectedBugTag.comments.length > 0 && (
                      <div className="space-y-1 text-[11px] bg-black/50 p-2.5 rounded-lg border border-white/10">
                        <span className="font-bold text-indigo-200">Additional Notes / Comments ({selectedBugTag.comments.length}):</span>
                        <div className="max-h-28 overflow-y-auto space-y-1 mt-1 pr-1">
                          {selectedBugTag.comments.map((c: any, cIdx: number) => (
                            <div key={c.id || cIdx} className="text-white/80 border-b border-white/10 pb-1">
                              <span className="text-[9px] text-white/50 font-mono">
                                [{c.created_at ? c.created_at.slice(0, 16).replace('T', ' ') : 'note'}]
                              </span>{' '}
                              {c.body}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-indigo-200/80 italic">
                      Note entered below will attach directly to this identified bug.
                    </p>
                  </div>
                );
              })()}

              {/* Note */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-white/90">
                  Identified problem (optional)
                </label>
                <textarea
                  rows={2}
                  value={entry.userNote}
                  onChange={(e) => updateEntry(idx, { userNote: e.target.value })}
                  placeholder="What is wrong? Expected calories, wrong dish name, etc."
                  className={inputCls}
                />
              </div>

              {/* Official menu URL */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-white/90">
                  Official Menu / Nutrition URL (optional)
                </label>
                <input
                  type="url"
                  value={entry.officialUrl}
                  onChange={(e) => updateEntry(idx, { officialUrl: e.target.value })}
                  placeholder="https://... nutrition PDF or menu page"
                  className={inputCls}
                />
              </div>

              {/* Screenshot Upload */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-[11px] font-bold text-white/90 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-indigo-300" />
                  <span>Include Screenshot (optional)</span>
                </label>
                {entry.screenshotDataUrl ? (
                  <div className="relative group rounded-xl overflow-hidden border border-white/20 bg-black/40 p-2 max-w-xs">
                    <img
                      src={entry.screenshotDataUrl}
                      alt="Issue Screenshot"
                      className="w-full h-32 object-contain rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => updateEntry(idx, { screenshotDataUrl: '' })}
                      className="absolute top-3 right-3 p-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-md transition-transform hover:scale-105"
                      title="Remove screenshot"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-3 border border-dashed border-white/20 hover:border-indigo-400 rounded-xl cursor-pointer bg-slate-950/50 hover:bg-slate-900/80 transition-colors group">
                    <div className="flex items-center gap-2 text-white/70 group-hover:text-indigo-200 text-xs font-semibold">
                      <Upload className="w-4 h-4 text-indigo-400" />
                      <span>Click to upload or attach a screenshot</span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (evt) => {
                            const res = evt.target?.result as string;
                            if (res) updateEntry(idx, { screenshotDataUrl: res });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={addEntry}
          className="py-2.5 rounded-xl border border-dashed border-indigo-400/50 hover:border-indigo-400 bg-indigo-950/30 hover:bg-indigo-900/40 text-indigo-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add another issue</span>
        </button>

        <button
          type="button"
          onClick={() => setShowBatchModal((prev) => !prev)}
          className="py-2.5 rounded-xl border border-dashed border-amber-400/50 hover:border-amber-400 bg-amber-950/30 hover:bg-amber-900/40 text-amber-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
        >
          <ClipboardPaste className="w-4 h-4" />
          <span>Paste set of bugs</span>
        </button>
      </div>

      {/* Batch Paste Box in FlagIssueForm */}
      {showBatchModal && (
        <div className="p-3.5 rounded-2xl border border-amber-500/40 bg-[#161224] space-y-2.5 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs">
              <ListPlus className="w-4 h-4 text-amber-400" />
              <span>Paste multiple bugs at once</span>
            </div>
            <button
              type="button"
              onClick={() => setShowBatchModal(false)}
              className="text-slate-400 hover:text-white p-0.5 rounded-md hover:bg-white/10 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[11px] text-white/70 leading-relaxed">
            Paste any list of bugs (lines, bullet points, numbers, or paragraphs). Each item will be added as an individual bug card in this form.
          </p>

          <textarea
            rows={4}
            value={batchRawText}
            onChange={(e) => setBatchRawText(e.target.value)}
            placeholder={"Paste bugs here, for example:\n• Micronutrient null handling: Differentiate zero-values\n• Cheddar cheese profile: Correct database macros\n• Totals synchronization: Propagate post-analysis rules"}
            className="w-full text-xs rounded-lg px-2.5 py-2 bg-black/60 border border-amber-500/30 text-white placeholder:text-white/35 focus:outline-none focus:border-amber-400 transition-colors font-mono"
            autoFocus
          />

          {parsedBatchItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-3 h-3" /> {parsedBatchItems.length} individual bug{parsedBatchItems.length === 1 ? '' : 's'} identified:
              </div>

              <div className="max-h-28 overflow-y-auto space-y-1 p-2 rounded-lg bg-black/40 border border-white/10 text-[11px]">
                {parsedBatchItems.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-white/80">
                    <span className="font-mono text-amber-400 shrink-0 text-[10px] pt-0.5">{idx + 1}.</span>
                    <span className="line-clamp-2">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setBatchRawText('');
                setShowBatchModal(false);
              }}
              className="px-2.5 py-1 text-xs text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={parsedBatchItems.length === 0}
              onClick={() => {
                handleBatchAdd(parsedBatchItems);
                setBatchRawText('');
                setShowBatchModal(false);
              }}
              className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white flex items-center gap-1.5 shadow-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add {parsedBatchItems.length > 0 ? `${parsedBatchItems.length} bugs` : 'bugs'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Footer submit action */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white font-bold text-xs disabled:opacity-50 flex items-center gap-2 shadow-lg transition-all"
        >
          {submitting ? (
            <>
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
              <span>Submitting to backlog...</span>
            </>
          ) : (
            <span>Submit to backlog</span>
          )}
        </button>
      </div>
    </form>
  );
}

export interface FlagIssueModalProps extends FlagIssueFormProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

export function FlagIssueModal({
  isOpen,
  onClose,
  title = 'Flag food analysis issue',
  ...formProps
}: FlagIssueModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10060] bg-slate-950/95 backdrop-blur-md flex flex-col h-screen w-screen overflow-hidden text-white font-sans">
      {/* Fixed Full-Screen Header */}
      <div className="px-6 py-4 border-b border-white/15 flex items-center justify-between bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-2.5">
          <Bug className="w-5 h-5 text-rose-400 shrink-0" />
          <h2 className="text-base font-bold text-white">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white/80 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable Full-Screen Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-4">
        {/* Dish context banner directly under header */}
        {(formProps.dishQuery || formProps.chainKey) && (
          <div className="p-4 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 text-xs text-white/90 shadow-md">
            <p className="font-semibold">
              Dish: <strong className="text-white text-sm">{formProps.dishQuery || '—'}</strong>
              {formProps.chainKey ? (
                <> · Brand guess: <strong className="text-indigo-300 text-sm">{formProps.chainKey}</strong></>
              ) : null}
            </p>
          </div>
        )}

        <FlagIssueForm {...formProps} onSuccess={onClose} onCancel={onClose} />
      </div>
    </div>,
    document.body
  );
}
