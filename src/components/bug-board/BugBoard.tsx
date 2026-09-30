import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Bug,
  X,
  RefreshCw,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  AlertCircle,
  Plus,
  Edit2,
  Save,
  FileText,
  Sparkles,
  Download,
  Loader2,
  Eye,
  ArrowRight,
  Terminal,
  ExternalLink,
  Flame,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Clock,
  Play,
} from 'lucide-react';
import { FlagIssueForm, CATEGORY_OPTIONS, saveBugTrackerCache } from '../FlagIssueModal';
import { BugCategory } from '../../utils/issueBacklog';
import GoldenInboxPanel from '../GoldenInboxPanel';
import { bugArtifactUrl, bugShotName, evidencePhotoSrc } from '../../utils/bugSnapshot';
import {
  hydrateWorkItem,
  linePhotosForText,
  publicId,
  collectAttempts,
  triesMatchingLine,
  formatTriedAttempt,
  buildContinueJob,
  formatContinuePrompt,
  sortReadyQueue,
  getLastActionedDate,
  sortByLastActioned,
  formatLastActioned,
  CLASS_SEVERITY,
  BURN_BUDGET,
  BugWorkItem,
  BugCommit,
  BugAttempt,
  BugEvidence,
  BugNow,
} from '../../utils/bugWorkItem';
import { queueKpis, tagIsFixed } from '../../utils/bugQueueKpis';
import { FoodDetailTabs } from '../bugQueue';
import {
  buildTapeReplayBody,
  reanalyzeJobId,
  tapeFromJobRecord,
  scoreLocalTape,
  pickTapeBoard,
  tapeJobCandidatesFromDetail,
  isSyntheticTapeJobId,
  tapeBoardIsHydrated,
} from '../../utils/bugTapeReplay';
import { overlayAutoRemaining, isHumanCheckLine } from '../../utils/bugTapeReview';
import { t } from '../../utils/i18n';

/**
 * Shared bug-board presentational component (packet bug-board-miniapp, Node 2).
 * Verbatim extraction of the BugTrackerModal board markup. One writer:
 * the site modal and the Telegram mini app render this same component.
 */
import { useBugBoard } from './useBugBoard';

export type BugBoardProps = ReturnType<typeof useBugBoard> & {
  onClose: () => void;
  onViewJob?: (jobId: string) => void;
  language?: string;
};

export function BugBoard({
  loading,
  setLoading,
  error,
  setError,
  data,
  activeTab,
  setActiveTab,
  boardMode,
  setBoardMode,
  statusFilter,
  setStatusFilter,
  sortOrder,
  setSortOrder,
  isFlagFormOpen,
  setIsFlagFormOpen,
  selectedTagId,
  setSelectedTagId,
  selectedTagDetail,
  detailLoading,
  editingBugField,
  setEditingBugField,
  editBugDraft,
  setEditBugDraft,
  editingRemaining,
  setEditingRemaining,
  editRemainingDraft,
  setEditRemainingDraft,
  savingField,
  showAddAttempt,
  setShowAddAttempt,
  attemptHyp,
  setAttemptHyp,
  attemptFile,
  setAttemptFile,
  attemptTest,
  setAttemptTest,
  attemptResult,
  setAttemptResult,
  attemptBurned,
  setAttemptBurned,
  attemptNote,
  setAttemptNote,
  submittingAttempt,
  trackerDetailTab,
  setTrackerDetailTab,
  selectedRemainingLine,
  setSelectedRemainingLine,
  openSnapCommitIds,
  setOpenSnapCommitIds,
  openPreBlocks,
  setOpenPreBlocks,
  lightboxImage,
  setLightboxImage,
  searchQuery,
  setSearchQuery,
  purgingDone,
  copiedTagId,
  copiedHandoffId,
  deletingTagId,
  zippingTagId,
  makingGoldenId,
  replayingLogId,
  replayingCatalogId,
  reanalyzingTagId,
  busy,
  lastUpdated,
  triageModelByTag,
  setTriageModelByTag,
  triagingTagId,
  triageStatus,
  analyzeModalTag,
  analyzeElapsed,
  viewingArtifact,
  setViewingArtifact,
  artifactLoading,
  artifactUrl,
  reportShotSrcs,
  viewTextArtifact,
  downloadTagZip,
  load,
  loadPreviewBoard,
  handleReplayLog,
  handleReplayCatalog,
  handleReanalyze,
  fetchTagDetail,
  handleSelectTag,
  handleNextBug,
  saveBugField,
  handleUnblockBug,
  handleUpdateClass,
  toggleRemainingDone,
  handleMakeGolden,
  saveRemainingItems,
  handleLogAttempt,
  runBugTriageAgent,
  deleteTag,
  hardDeleteTag,
  handlePurgeDoneBugs,
  pruneReport,
  copyTagSummary,
  copyHandoff,
  bugTags,
  sortedQueueTags,
  kpis,
  readyCount,
  blockedCount,
  doneCount,
  openBugCount,
  selectedTag,
  selectedTagItem,
  selectedPubId,
  selectedBugNow,
  selectedCommits,
  selectedReports,
  topReadyTag,
  topReadyPubId,
  snapshotIdentity,
  onClose,
  onViewJob,
  language,
}: BugBoardProps) {
  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[10050] bg-[#0b1220] flex flex-col w-full h-full p-0 text-[#f8fafc] font-sans antialiased overflow-hidden select-text">
          {/* Top Header */}
          <header className="px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3 bg-[#111827]/80 backdrop-blur shrink-0 border-b border-white/5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0">
                <h1 className="text-base font-bold tracking-tight flex items-center gap-1.5">
                  <span>Bug queue</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-white/10 text-white/70 font-normal">
                    Q-6
                  </span>
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Next bug Button (Icon-only with pub id badge) */}
              <button
                type="button"
                onClick={handleNextBug}
                className="p-2 rounded-xl bg-gradient-to-r from-amber-600 via-indigo-600 to-indigo-700 hover:from-amber-500 hover:to-indigo-600 text-white shadow-md flex items-center gap-1 transition-all cursor-pointer border border-white/20 active:scale-95"
                title={`Next bug (${topReadyPubId || 'Top Ready'})`}
              >
                <ArrowRight className="w-4 h-4" />
                <span className="text-[10px] font-mono px-1 rounded bg-black/40 text-amber-200 font-bold">
                  {topReadyPubId || 'Ready'}
                </span>
              </button>

              {/* Refresh button */}
              <button
                type="button"
                disabled={loading || busy}
                onClick={() => load()}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 transition-colors cursor-pointer"
                title="Refresh bug queue"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {lastUpdated && (
                <span className="text-[10px] font-mono text-white/50 whitespace-nowrap" title={`Last refreshed. Showing ${sortedQueueTags.length} of ${bugTags.length} cards under filter ${statusFilter} / ${activeTab} — switch to All Statuses to see done cards. Snapshot ${snapshotIdentity || '…'}`}>
                  {lastUpdated} · {sortedQueueTags.length}/{bugTags.length} · {statusFilter}{snapshotIdentity ? ` · ${snapshotIdentity}` : ''}
                </span>
              )}

              {/* Flag issue button (Icon-only) */}
              <button
                type="button"
                onClick={() => setIsFlagFormOpen(!isFlagFormOpen)}
                className="p-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white border border-rose-400/40 shadow-sm transition-all shrink-0 cursor-pointer"
                title="Flag issue"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white/80 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Main Content Area — naturally scrollable without sticky trapping */}
          <div className="flex-1 overflow-y-auto flex flex-col p-2 sm:p-3 space-y-3 min-h-0 bg-[#0b1220]">
            {error && (
              <div className="p-2.5 rounded-xl bg-rose-600/90 text-white text-xs font-semibold flex items-center gap-2 shrink-0 shadow-md">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* KPIs Carousel (Horizontal Slider) */}
            <section className="flex overflow-x-auto gap-2 snap-x pb-1 scrollbar-none shrink-0">
              <div
                onClick={() => setStatusFilter('ready')}
                className={`snap-start shrink-0 min-w-[125px] sm:min-w-[150px] bg-[#111827] hover:bg-[#1a2336] cursor-pointer transition-colors rounded-xl p-2.5 border ${
                  statusFilter === 'ready' ? 'border-emerald-500 bg-emerald-950/20' : 'border-transparent hover:border-emerald-500/30'
                }`}
              >
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-white/50 block truncate">Ready now</span>
                <b className="text-lg font-extrabold text-emerald-400 mt-0.5 block">{readyCount}</b>
              </div>
              <div
                onClick={() => setStatusFilter('stuck')}
                className={`snap-start shrink-0 min-w-[125px] sm:min-w-[150px] bg-[#111827] hover:bg-[#1a2336] cursor-pointer transition-colors rounded-xl p-2.5 border ${
                  statusFilter === 'stuck' ? 'border-rose-500 bg-rose-950/20' : 'border-transparent hover:border-rose-500/30'
                }`}
              >
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-white/50 block truncate">Stuck / 2 Burns</span>
                <b className="text-lg font-extrabold text-rose-400 mt-0.5 block">{blockedCount}</b>
              </div>
              <div
                onClick={() => setStatusFilter('active')}
                className={`snap-start shrink-0 min-w-[125px] sm:min-w-[150px] bg-[#111827] hover:bg-[#1a2336] cursor-pointer transition-colors rounded-xl p-2.5 border ${
                  statusFilter === 'active' ? 'border-amber-500 bg-amber-950/20' : 'border-transparent hover:border-amber-500/30'
                }`}
              >
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-white/50 block truncate">Bugs open</span>
                <b className="text-lg font-extrabold text-amber-300 mt-0.5 block">{openBugCount}</b>
              </div>
              <div
                onClick={() => setStatusFilter('done')}
                className={`snap-start shrink-0 min-w-[125px] sm:min-w-[150px] bg-[#111827] hover:bg-[#1a2336] cursor-pointer transition-colors rounded-xl p-2.5 border ${
                  statusFilter === 'done' ? 'border-slate-400 bg-slate-800/40' : 'border-transparent hover:border-slate-500/30'
                }`}
              >
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-white/50 block truncate">Done this week</span>
                <b className="text-lg font-extrabold text-slate-300 mt-0.5 block">{doneCount}</b>
              </div>
            </section>

            {/* Dropdown Filters, Search & Actions */}
            <div className="flex items-center gap-2 shrink-0 py-1 flex-wrap">
              <select
                value={boardMode}
                onChange={(e) => setBoardMode(e.target.value as any)}
                className="bg-[#111827] text-white border border-white/15 rounded-xl px-2.5 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
              >
                <option value="bugs">Bugs Queue ({bugTags.length})</option>
                <option value="golden">Golden Inbox</option>
              </select>

              {boardMode === 'bugs' && (
                <>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="bg-[#111827] text-white border border-white/15 rounded-xl px-2.5 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="active">Active ({openBugCount})</option>
                    <option value="ready">Ready now ({readyCount})</option>
                    <option value="unactioned">Un-actioned ({bugTags.filter((t) => !tagIsFixed(t) && !hydrateWorkItem(t).commits?.some(c => c.kind === 'agent' || c.actor !== 'you')).length})</option>
                    <option value="pending_review">Human to do ({bugTags.filter((t) => {
                      const item = hydrateWorkItem(t);
                      if (tagIsFixed(t)) return false;
                      const last = item.commits?.[item.commits.length - 1];
                      return last && (last.kind === 'agent' || last.actor !== 'you');
                    }).length})</option>
                    <option value="stuck">Stuck / 2 Burns ({blockedCount})</option>
                    <option value="done">Done / Fixed ({kpis.doneAll})</option>
                    <option value="all">All Statuses ({bugTags.length})</option>
                  </select>

                  <select
                    value={activeTab}
                    onChange={(e) => setActiveTab(e.target.value as any)}
                    className="bg-[#111827] text-white border border-white/15 rounded-xl px-2.5 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Categories ({bugTags.length})</option>
                    {CATEGORY_OPTIONS.map((c) => {
                      const count = bugTags.filter((t: any) => (t.category || 'foodcart') === c.key).length;
                      return (
                        <option key={c.key} value={c.key}>
                          {c.label} ({count})
                        </option>
                      );
                    })}
                  </select>

                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as any)}
                    className="bg-[#111827] text-white border border-white/15 rounded-xl px-2.5 py-1.5 text-xs font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="last_actioned">Sort: Last Actioned</option>
                    <option value="priority">Sort: Ready Priority</option>
                    <option value="oldest">Sort: Oldest First</option>
                  </select>

                  {/* Search box */}
                  <div className="relative flex-1 min-w-[130px] max-w-[220px]">
                    <input
                      type="text"
                      placeholder="Search bugs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#111827] text-white border border-white/15 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-indigo-500 placeholder-white/30"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Purge Done bugs button to reclaim DB space */}
                  {kpis.doneAll > 0 && (
                    <button
                      type="button"
                      disabled={purgingDone}
                      onClick={handlePurgeDoneBugs}
                      className="bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 text-rose-300 rounded-xl px-2.5 py-1.5 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                      title="Permanently delete all done/fixed bugs to free up database storage"
                    >
                      {purgingDone ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      )}
                      <span>Delete Done ({kpis.doneAll})</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Flag issue dropdown panel */}
            {boardMode === 'bugs' && isFlagFormOpen && (
              <div className="p-3 rounded-xl bg-[#111827] border border-rose-500/40 shrink-0 shadow-xl max-h-[40vh] overflow-y-auto">
                <FlagIssueForm
                  initialCategory={activeTab === 'all' ? 'foodcart' : activeTab}
                  existingBugTags={bugTags}
                  onSuccess={() => {
                    setIsFlagFormOpen(false);
                    load();
                  }}
                  onCancel={() => setIsFlagFormOpen(false)}
                />
              </div>
            )}

            {/* Golden Inbox Mode */}
            {boardMode === 'golden' && (
              <div className="min-h-0">
                <GoldenInboxPanel />
              </div>
            )}

            {/* Bugs Queue Accordion View */}
            {boardMode === 'bugs' && (
              <div className="space-y-2 pb-6">
                {sortedQueueTags.length === 0 ? (
                  <div className="p-8 text-center text-white/50 text-xs bg-[#111827]/40 rounded-xl border border-white/5 space-y-2">
                    <p>No bug cards found matching current filters ({statusFilter} / {activeTab}).</p>
                    {(statusFilter !== 'active' || activeTab !== 'all' || searchQuery) && (
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('active');
                          setActiveTab('all');
                          setSearchQuery('');
                        }}
                        className="px-3 py-1 rounded-lg bg-indigo-600/40 hover:bg-indigo-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                ) : (
                  sortedQueueTags.map((tag) => {
                    const item = hydrateWorkItem(tag);
                    const pub = publicId(item, tag.id);
                    const isSelected = selectedTagId === tag.id;
                    const burnedCount = item.burns.filter((b) => b.burned).length;
                    const lastActionedDate = getLastActionedDate(tag);

                    const hasAgentCommits = item.commits && item.commits.some((c) => c.kind === 'agent' || c.actor !== 'you');

                    return (
                      <div
                        key={tag.id}
                        className={`rounded-xl overflow-hidden transition-all bg-[#111827] ${
                          isSelected ? 'ring-1 ring-indigo-500' : 'hover:bg-white/5'
                        }`}
                      >
                        {/* Accordion Row Header (Compact) */}
                        <div
                          onClick={() => handleSelectTag(tag.id)}
                          className="px-2.5 py-1.5 cursor-pointer flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[11px] font-extrabold text-indigo-300 shrink-0">
                              {pub}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-xs text-white truncate leading-tight">
                                {tag.title}
                              </div>
                              <div className="text-[10px] text-white/50 truncate flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span>{tag.category || 'auto'} · {tag.linked_count || tag.linked_issues?.length || 1} {tag.category === 'biomarker' ? 'biomarker(s)' : tag.category === 'foodcart' ? 'meal(s)' : 'item(s)'}</span>
                                <span className="text-slate-300 font-medium flex items-center gap-0.5">
                                  · <Clock className="w-2.5 h-2.5 inline text-indigo-400" /> {formatLastActioned(lastActionedDate)}
                                </span>
                                {burnedCount > 0 && (
                                  <span className="text-amber-400 font-semibold">· burn {burnedCount}/{BURN_BUDGET}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Action state indicator */}
                            {item.queue === 'done' || tag.status === 'fixed' ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold border bg-slate-500/20 text-slate-300 border-slate-500/30">
                                fixed
                              </span>
                            ) : item.queue === 'blocked' ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold border bg-red-500/15 text-red-400 border-red-500/30">
                                stuck
                              </span>
                            ) : (item.remaining || []).filter((r) => !isHumanCheckLine(r)).length > 0 ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold border bg-indigo-500/15 text-indigo-300 border-indigo-500/30">
                                agent to do
                              </span>
                            ) : hasAgentCommits || (item.remaining || []).length > 0 ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold border bg-amber-500/15 text-amber-300 border-amber-500/30">
                                human to do
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                                un-actioned
                              </span>
                            )}

                            {/* Delete bin button - shown ONCE per card in the header row */}
                            <button
                              type="button"
                              disabled={deletingTagId === tag.id}
                              onClick={(e) => hardDeleteTag(tag.id, tag.title, e)}
                              className="p-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 text-rose-300 transition-colors cursor-pointer shrink-0"
                              title="Permanently delete bug from database"
                            >
                              {deletingTagId === tag.id ? (
                                <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                              ) : (
                                <Trash2 className="w-3 h-3 text-rose-400" />
                              )}
                            </button>

                            <ChevronDown
                              className={`w-3.5 h-3.5 text-white/50 transition-transform ${
                                isSelected ? 'rotate-180 text-indigo-400' : ''
                              }`}
                            />
                          </div>
                        </div>

                        {/* Accordion Expanded Detail Body */}
                        {isSelected && (
                          <div className="p-3 border-t border-white/10 bg-[#0c121e] space-y-4 text-xs">
                            {/* Action Bar */}
                            <div className="flex items-center justify-end gap-2 flex-wrap pb-2 border-b border-white/5">
                              <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto overflow-x-auto no-scrollbar justify-end">
                                {/* AI Triage */}
                                <button
                                  type="button"
                                  disabled={busy || triagingTagId === selectedTag.id}
                                  onClick={() => runBugTriageAgent(selectedTag)}
                                  className="px-2 py-1 text-[10px] font-bold text-violet-200 bg-violet-950/60 hover:bg-violet-900 border border-violet-500/40 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                                  title="Run AI Triage Agent"
                                >
                                  {triagingTagId === selectedTag.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                                  ) : (
                                    <Sparkles className="w-3 h-3 text-violet-400" />
                                  )}
                                  <span className="hidden sm:inline">Triage</span>
                                </button>
                                 {/* Make Golden Case */}
                                {(selectedTag.category === 'foodcart' || selectedTag.category === 'Home') && (
                                  <button
                                    type="button"
                                    disabled={makingGoldenId === selectedTag.id}
                                    onClick={(e) => handleMakeGolden(selectedTag, e)}
                                    className="px-2 py-1 text-[10px] font-bold text-amber-200 bg-amber-950/60 hover:bg-amber-900 border border-amber-500/40 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                                    title="Promote later — Create Golden Case in tests/golden_meal/inbox/"
                                  >
                                    {makingGoldenId === selectedTag.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                    ) : (
                                      <Sparkles className="w-3 h-3 text-amber-400" />
                                    )}
                                    <span className="hidden sm:inline">Make Golden</span>
                                    <span className="text-[9px] text-amber-400/70 font-normal hidden md:inline">(Promote later)</span>
                                  </button>
                                )}

                                {/* Zip Download */}
                                <button
                                  type="button"
                                  disabled={zippingTagId === selectedTag.id}
                                  onClick={() => downloadTagZip(selectedTag)}
                                  className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition-colors shrink-0"
                                  title="Download Bug Zip"
                                >
                                  {zippingTagId === selectedTag.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                 {/* Unblock Bug / Reset Burns */}
                                {burnedCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleUnblockBug(selectedTag.id, e)}
                                    className="px-2 py-1 text-[10px] font-bold text-amber-300 bg-amber-950/70 hover:bg-amber-900 border border-amber-500/40 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                                    title="Reset Burns & Unblock Bug"
                                  >
                                    <Flame className="w-3 h-3 text-amber-400" />
                                    <span>Unblock ({burnedCount})</span>
                                  </button>
                                )}

                                {/* Hand Off */}
                                <button
                                  type="button"
                                  onClick={(e) => copyHandoff(selectedTag, e)}
                                  className="px-2 py-1 text-[10px] font-bold text-amber-100 bg-amber-950/70 hover:bg-amber-900 border border-amber-500/40 rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                                  title="Copy continue job (one remaining line) for Gemini"
                                >
                                  {copiedHandoffId === selectedTag.id ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  <span className="hidden sm:inline">{copiedHandoffId === selectedTag.id ? 'Copied' : 'Hand off'}</span>
                                </button>

                                {/* Copy Summary */}
                                <button
                                  type="button"
                                  onClick={(e) => copyTagSummary(selectedTag, e)}
                                  className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
                                  title="Copy Summary"
                                >
                                  {copiedTagId === selectedTag.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {/* Mark fixed */}
                                <button
                                  type="button"
                                  disabled={deletingTagId === selectedTag.id}
                                  onClick={(e) => deleteTag(selectedTag.id, selectedTag.title, e)}
                                  className="p-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 transition-colors cursor-pointer"
                                  title="Mark Fixed"
                                >
                                  {deletingTagId === selectedTag.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Q-6.4 G1/G2: 5-Tab Bar for Food Cards (Checks / Dishes / Scout identity / Balance / History) */}
                            {(() => {
                              const isFoodCard =
                                (selectedTag.category || '').toLowerCase() === 'foodcart' ||
                                (selectedTag.category || '').toLowerCase() === 'golden';
                              const foodEvidence =
                                (selectedTagDetail as any)?.now?.current_evidence ||
                                (selectedTag as any)?.now?.current_evidence ||
                                (selectedTagDetail as any)?.reports?.[0]?.payload ||
                                selectedTag.reports?.[0]?.payload ||
                                selectedTag.reports?.[0];
                              const foodJobId =
                                foodEvidence?.job_id ||
                                foodEvidence?.jobId ||
                                selectedTag.jobId ||
                                (selectedTagDetail as any)?.jobId ||
                                (selectedTagDetail as any)?.board?.jobId ||
                                selectedTag.board?.jobId ||
                                null;

                              return isFoodCard ? (
                                <FoodDetailTabs
                                  activeTab={trackerDetailTab}
                                  onTabChange={setTrackerDetailTab}
                                  board={(selectedTagDetail as any)?.board || selectedTag.board}
                                  goldenLines={(selectedTagDetail as any)?.expectedMeal || selectedTag.expectedMeal || []}
                                  jobId={foodJobId}
                                  onReplayLog={() => handleReplayLog(selectedTag)}
                                  replayingLog={replayingLogId === selectedTag.id}
                                  onReplayCatalog={() => handleReplayCatalog(selectedTag)}
                                  replayingCatalog={replayingCatalogId === selectedTag.id}
                                  onReanalyze={() => handleReanalyze(selectedTag)}
                                  reanalyzing={reanalyzingTagId === selectedTag.id}
                                  canReanalyze={Boolean(
                                    reanalyzeJobId(
                                      selectedTagDetail?.now?.current_evidence ||
                                        selectedTagDetail?.bug?.current_evidence ||
                                        hydrateWorkItem(selectedTag).current_evidence
                                    )
                                  )}
                                />
                              ) : null;
                            })()}

                            <>
                                {/* NOW Section — always on. Food tape tabs sit above; do not hide chrome. */}
                                <div className="bg-[#0f172a] rounded-xl p-3 space-y-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
                                      NOW — what the next agent sees first
                                    </h3>
                                {/* Class assignment dropdown */}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-extrabold text-slate-400 uppercase">Class:</span>
                                  <select
                                    value={selectedBugNow?.class || selectedTag?.class || ''}
                                    onChange={(e) => handleUpdateClass(selectedTag.id, e.target.value)}
                                    className="bg-black/60 text-indigo-200 text-[10px] font-bold border border-indigo-500/30 rounded px-1.5 py-0.5 focus:outline-none cursor-pointer"
                                  >
                                    <option value="">(No Class)</option>
                                    <option value="APPLY_MISS">APPLY_MISS</option>
                                    <option value="FALSE_FRIEND">FALSE_FRIEND</option>
                                    <option value="DISH_DROP">DISH_DROP</option>
                                    <option value="OPENING_WRONG">OPENING_WRONG</option>
                                    <option value="SILENT_REPAIR">SILENT_REPAIR</option>
                                    <option value="CALL_BUDGET">CALL_BUDGET</option>
                                    <option value="INFRA_LATENCY">INFRA_LATENCY</option>
                                    <option value="F_1">F_1</option>
                                    <option value="IDENTITY_FALSE_FRIEND">IDENTITY_FALSE_FRIEND</option>
                                    <option value="CLONE_UI">CLONE_UI</option>
                                  </select>
                                </div>
                              </div>

                              {(selectedCommits[selectedCommits.length - 1] || selectedTag.last_commit) && (
                                <div className="text-[10px] rounded-lg border border-indigo-500/30 bg-indigo-950/40 p-2 text-indigo-100">
                                  <div className="font-extrabold uppercase text-[9px] text-indigo-300 mb-0.5">
                                    Last loop
                                  </div>
                                  {(() => {
                                    const last = selectedCommits[selectedCommits.length - 1] || selectedTag.last_commit;
                                    return (
                                      <div>
                                        <span className="font-bold">{last.actor}</span> · {last.summary}
                                        {last.attempt ? (
                                          <div className="font-mono text-[9px] mt-0.5 text-indigo-200/90">
                                            {last.attempt.result} · {last.attempt.file} · {last.attempt.test}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}

                              {/* Pinned Bug Field */}
                              <div className="bg-[#1c1917] rounded-xl p-2.5 space-y-1.5 border border-amber-600/40">
                                <div className="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-wider text-amber-400">
                                  <span>Pinned Bug Context</span>
                                  {!editingBugField && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingBugField(true)}
                                      className="text-amber-300 hover:text-amber-200 p-0.5 cursor-pointer"
                                      title="Edit Bug Instruction"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>

                                {editingBugField ? (
                                  <div className="space-y-1.5">
                                    <textarea
                                      rows={3}
                                      value={editBugDraft}
                                      onChange={(e) => setEditBugDraft(e.target.value)}
                                      className="w-full text-xs rounded-lg p-2 bg-black/60 border border-amber-500/40 text-white font-sans focus:outline-none"
                                      placeholder="Describe the bug instruction..."
                                    />
                                    <div className="flex gap-1.5 justify-end">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingBugField(false);
                                          setEditBugDraft(selectedBugNow?.bug || selectedTag.identified_problems || '');
                                        }}
                                        className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-white cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={savingField}
                                        onClick={saveBugField}
                                        className="px-2.5 py-0.5 text-[10px] rounded bg-amber-600 font-bold text-white flex items-center gap-1 cursor-pointer"
                                      >
                                        {savingField ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                        Save Bug
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-xs font-semibold text-white/95 leading-relaxed whitespace-pre-wrap">
                                    {selectedBugNow?.bug ||
                                      selectedTag.identified_problems ||
                                      selectedTag.title ||
                                      '(No bug instruction recorded)'}
                                  </p>
                                )}
                              </div>

                              {/* Remaining Bullets */}
                              <div className="text-xs text-white/80 py-0.5 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <strong className="text-white block">Remaining:</strong>
                                  {!editingRemaining && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingRemaining(true)}
                                      className="text-amber-300 hover:text-amber-200 p-0.5 cursor-pointer text-[10px] flex items-center gap-1"
                                      title="Edit Remaining list"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                      <span>Edit</span>
                                    </button>
                                  )}
                                </div>
                                {editingRemaining ? (
                                  <div className="space-y-1.5">
                                    <textarea
                                      rows={2}
                                      value={editRemainingDraft}
                                      onChange={(e) => setEditRemainingDraft(e.target.value)}
                                      className="w-full text-xs rounded-lg p-2 bg-black/60 border border-amber-500/40 text-white font-sans focus:outline-none"
                                      placeholder="Remaining items (comma-separated)..."
                                    />
                                    <div className="flex gap-1.5 justify-end">
                                      <button
                                        type="button"
                                        onClick={() => setEditingRemaining(false)}
                                        className="px-2 py-0.5 text-[10px] rounded bg-slate-700 text-white cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={savingField}
                                        onClick={saveRemainingItems}
                                        className="px-2.5 py-0.5 text-[10px] rounded bg-amber-600 font-bold text-white flex items-center gap-1 cursor-pointer"
                                      >
                                        {savingField ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : selectedBugNow?.remaining && selectedBugNow.remaining.length > 0 ? (
                                  <div className="space-y-1">
                                    {selectedBugNow.remaining.map((remItem, rIdx) => {
                                      const pinned = linePhotosForText(selectedBugNow.current_evidence, remItem);
                                      return (
                                      <div
                                        key={rIdx}
                                        className={`flex items-start justify-between gap-2 p-1.5 rounded-lg bg-black/40 border text-amber-200/90 text-[11px] cursor-pointer ${
                                          selectedRemainingLine === remItem ? 'border-indigo-400' : 'border-white/5'
                                        }`}
                                        onClick={() => setSelectedRemainingLine(remItem)}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <span className="leading-relaxed">{remItem}</span>
                                          {pinned?.photo_urls?.length ? (
                                            <div className="flex gap-1 mt-1">
                                              {pinned.photo_urls.slice(0, 3).map((p, i) => (
                                                <img
                                                  key={i}
                                                  src={evidencePhotoSrc(selectedTag.id, p)}
                                                  alt=""
                                                  className="w-10 h-8 rounded object-cover border border-white/20"
                                                />
                                              ))}
                                            </div>
                                          ) : null}
                                          {pinned?.comment ? (
                                            <p className="text-[10px] text-white/50 mt-0.5">{pinned.comment}</p>
                                          ) : null}
                                          {triesMatchingLine(
                                            collectAttempts({
                                              ...selectedTagItem,
                                              commits: selectedCommits.length
                                                ? selectedCommits
                                                : selectedTagItem.commits,
                                            }),
                                            remItem
                                          ).map((a, ti) => (
                                            <p
                                              key={ti}
                                              className="text-[10px] text-amber-200/80 mt-1 leading-snug"
                                              title={formatTriedAttempt(a)}
                                            >
                                              tried: {a.hyp.slice(0, 72)}
                                              {a.hyp.length > 72 ? '…' : ''}
                                              {' · '}
                                              {/pass|green/i.test(a.result || '') ? 'claimed pass' : a.result || 'attempt'}
                                              {a.file ? ` · ${a.file}` : ''}
                                            </p>
                                          ))}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleRemainingDone(selectedTag.id, remItem);
                                          }}
                                          className="px-1.5 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer shrink-0"
                                          title="Mark item done"
                                        >
                                          <Check className="w-2.5 h-2.5" />
                                          <span>Done</span>
                                        </button>
                                      </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="leading-relaxed text-white/50">
                                    {selectedBugNow?.done?.length
                                      ? 'None — Re-analyze this meal, then Mark fixed. Do not Promote from chat.'
                                      : '—'}
                                  </span>
                                )}
                              </div>

                              {/* Done Bullets */}
                              <div className="text-xs text-emerald-300 py-0.5">
                                <strong className="text-white block mb-1">Done:</strong>
                                <span className="leading-relaxed">
                                  {selectedBugNow?.done?.length
                                    ? selectedBugNow.done.join(' · ')
                                    : selectedTag.status === 'fixed'
                                    ? selectedTag.resolution_note || 'Resolved'
                                    : '—'}
                                </span>
                              </div>

                              {/* Current Context / Evidence */}
                              <div className="text-xs text-white/80 py-0.5">
                                <strong className="text-white block mb-1">Context:</strong>
                                <span className="font-mono text-[10px] bg-black/40 text-indigo-200 px-2 py-1.5 rounded block break-all whitespace-pre-wrap">
                                  {selectedBugNow?.current_evidence?.job_id ||
                                    (selectedReports[0]?.dish_query
                                      ? `${selectedReports[0].dish_query} (${selectedReports[0].id.slice(0, 8)})`
                                      : 'None')}
                                </span>
                              </div>

                              {/* Tried / Previous Tentatives */}
                              {((selectedBugNow?.tried && selectedBugNow.tried.length > 0) ||
                                (selectedCommits && selectedCommits.some((c) => c.attempt))) && (
                                <div className="text-xs py-0.5 space-y-1">
                                  <strong className="text-white block">
                                    Tried / Previous Tentatives:
                                  </strong>
                                  <p className="text-[10px] text-white/40 font-sans">
                                    Grouped by remaining line. Agents only work the first remaining row.
                                  </p>
                                  <div className="space-y-1.5 font-mono text-[11px]">
                                    {(() => {
                                      const attempts = collectAttempts({
                                        ...selectedTagItem,
                                        commits: selectedCommits.length
                                          ? selectedCommits
                                          : selectedTagItem.commits,
                                      });
                                      const lines = [
                                        ...(selectedBugNow?.remaining || []),
                                        ...(selectedBugNow?.done || []),
                                      ];
                                      const grouped = lines
                                        .map((ln) => ({ ln, tries: triesMatchingLine(attempts, ln) }))
                                        .filter((g) => g.tries.length);
                                      const orphans = attempts.filter(
                                        (a) => !lines.some((ln) => triesMatchingLine([a], ln).length)
                                      );
                                      const blocks: string[] = [];
                                      for (const g of grouped) {
                                        blocks.push(`▸ ${g.ln}`);
                                        for (const a of g.tries) blocks.push(formatTriedAttempt(a));
                                      }
                                      if (orphans.length) {
                                        blocks.push('▸ unscoped');
                                        for (const a of orphans) blocks.push(formatTriedAttempt(a));
                                      }
                                      return blocks;
                                    })().map((t, idx) => {
                                      const isDoNotRetry = t.includes('DO NOT RETRY') || t.includes('burned');
                                      const isHead = t.startsWith('▸ ');
                                      return (
                                        <div
                                          key={idx}
                                          className={`border p-2 rounded-lg leading-relaxed whitespace-pre-wrap ${
                                            isHead
                                              ? 'border-indigo-500/30 text-indigo-200 font-sans font-bold'
                                              : isDoNotRetry
                                              ? 'bg-rose-950/40 border-rose-500/30 text-rose-200'
                                              : 'bg-indigo-950/40 border-indigo-500/30 text-indigo-200'
                                          }`}
                                        >
                                          {t}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>

                        {/* Commits / History Timeline */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                              History — one commit per loop (click to view that snap)
                            </h3>
                            <button
                              type="button"
                              onClick={() => setShowAddAttempt(!showAddAttempt)}
                              className="text-[11px] font-bold text-indigo-300 hover:text-indigo-200 flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Log attempt / note</span>
                            </button>
                          </div>

                          {/* Add Attempt Form */}
                          {showAddAttempt && (
                            <form
                              onSubmit={handleLogAttempt}
                              className="p-3.5 bg-slate-900 border border-indigo-500/40 rounded-2xl space-y-2.5 text-xs text-white shadow-md"
                            >
                              <div className="font-bold text-indigo-200 text-xs">Record Attempt or Loop Commit</div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-white/60">Hypothesis *</label>
                                  <input
                                    required
                                    value={attemptHyp}
                                    onChange={(e) => setAttemptHyp(e.target.value)}
                                    placeholder="e.g. tesco includes()"
                                    className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-white/60">File *</label>
                                  <input
                                    required
                                    value={attemptFile}
                                    onChange={(e) => setAttemptFile(e.target.value)}
                                    placeholder="e.g. FoodCard.tsx"
                                    className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-white/60">Test *</label>
                                  <input
                                    required
                                    value={attemptTest}
                                    onChange={(e) => setAttemptTest(e.target.value)}
                                    placeholder="e.g. NutritionLabelTable brand"
                                    className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-white/60">Result</label>
                                  <select
                                    value={attemptResult}
                                    onChange={(e) => {
                                      setAttemptResult(e.target.value);
                                      setAttemptBurned(!/pass|green/i.test(e.target.value));
                                    }}
                                    className="w-full text-xs rounded-lg p-1.5 bg-slate-800 border border-white/20 text-white"
                                  >
                                    <option value="still_red">still_red (Burn)</option>
                                    <option value="pass">pass (Green)</option>
                                    <option value="failed">failed (Burn)</option>
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] text-white/60">Note (optional)</label>
                                <input
                                  value={attemptNote}
                                  onChange={(e) => setAttemptNote(e.target.value)}
                                  placeholder="Observations..."
                                  className="w-full text-xs rounded-lg p-1.5 bg-black/40 border border-white/20 text-white"
                                />
                              </div>
                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setShowAddAttempt(false)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 text-white/80"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={submittingAttempt}
                                  className="px-3.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-white flex items-center gap-1"
                                >
                                  {submittingAttempt ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                  Record Attempt
                                </button>
                              </div>
                            </form>
                          )}

                          {/* Commits List */}
                          <ul className="space-y-4 list-none p-0 m-0">
                            {selectedCommits.length === 0 ? (
                              <li className="text-white/50 text-xs italic pl-4">No commits logged yet.</li>
                            ) : (
                              [...selectedCommits].reverse().map((commit, idx) => {
                                const isCur = idx === 0;
                                const isFail = commit.attempt?.burned;
                                const snapOpen = Boolean(openSnapCommitIds[commit.id || `c${idx}`]);
                                const evidence = commit.evidence || selectedBugNow?.current_evidence;
                                const photos = evidence?.photo_urls || [];

                                return (
                                  <li
                                    key={commit.id || idx}
                                    className="relative pl-6 border-l-2 border-slate-700 last:border-transparent pb-4 space-y-1.5"
                                  >
                                    {/* Circle marker */}
                                    <span
                                      className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-slate-900 ${
                                        isCur
                                          ? 'bg-indigo-400 shadow-xs shadow-indigo-400'
                                          : isFail
                                          ? 'bg-rose-500'
                                          : 'bg-slate-500'
                                      }`}
                                    />

                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <span className="font-mono text-[11px] text-indigo-300 font-bold mr-2">
                                          {commit.id || `c${idx + 1}`}
                                        </span>
                                        <strong className="text-xs text-white">
                                          {commit.actor || 'You'} · {commit.summary || 'Snapshot update'}
                                        </strong>
                                      </div>
                                      <span className="text-[10px] text-white/50 font-mono">
                                        {commit.at ? commit.at.slice(0, 16).replace('T', ' ') : ''}
                                      </span>
                                    </div>

                                    {commit.attempt && (
                                      <div className="text-[11px] font-mono text-white/80 bg-black/40 p-2 rounded-lg border border-white/10">
                                        <span className={isFail ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                                          {isFail ? 'BURN: ' : 'PASS: '}
                                        </span>
                                        {commit.attempt.hyp} ({commit.attempt.file}) · {commit.attempt.result}
                                        {commit.attempt.note ? ` — ${commit.attempt.note}` : ''}
                                      </div>
                                    )}

                                    <div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setOpenSnapCommitIds((prev) => ({
                                            ...prev,
                                            [commit.id || `c${idx}`]: !prev[commit.id || `c${idx}`],
                                          }))
                                        }
                                        className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-white/10 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                                      >
                                        <Eye className="w-3 h-3" />
                                        <span>{snapOpen ? 'Hide this snap' : 'View this snap'}</span>
                                      </button>
                                    </div>

                                    {/* Snap Evidence Panel */}
                                    {snapOpen && (
                                      <div className="p-3 bg-slate-950/80 rounded-xl border border-white/10 space-y-2 text-xs">
                                        {/* Clickable photos list */}
                                        {photos.length > 0 ? (
                                          <div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-white/60 block mb-1.5">
                                              Clickable Evidence Photos ({photos.length})
                                            </span>
                                            <div className="flex gap-2 flex-wrap">
                                              {photos.map((p, pIdx) => (
                                                <div
                                                  key={pIdx}
                                                  onClick={() =>
                                                    setLightboxImage({
                                                      url: evidencePhotoSrc(selectedTag.id, p),
                                                      caption: `Photo ${pIdx + 1} for ${commit.id || 'snap'}`,
                                                    })
                                                  }
                                                  className="w-20 h-20 rounded-xl bg-slate-800 border-2 border-indigo-500/40 hover:border-indigo-400 overflow-hidden cursor-pointer relative group flex items-end p-1 shadow-sm transition-transform active:scale-95"
                                                >
                                                  <img
                                                    src={evidencePhotoSrc(selectedTag.id, p)}
                                                    alt="evidence"
                                                    className="absolute inset-0 w-full h-full object-cover"
                                                  />
                                                  <span className="relative text-[9px] font-bold bg-black/70 text-white px-1 rounded z-10">
                                                    {pIdx + 1}/{photos.length}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}

                                        {/* Debug and Log Toggle Buttons */}
                                        <div className="flex flex-wrap gap-2 pt-1">
                                          {evidence?.job_id && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOpenPreBlocks((prev) => ({
                                                  ...prev,
                                                  [`${commit.id}_dbg`]: !prev[`${commit.id}_dbg`],
                                                }))
                                              }
                                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-indigo-950/80 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-900 cursor-pointer"
                                            >
                                              Debug {evidence.job_id}
                                            </button>
                                          )}

                                          {(evidence?.browser_log || evidence?.last_actions) && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOpenPreBlocks((prev) => ({
                                                  ...prev,
                                                  [`${commit.id}_act`]: !prev[`${commit.id}_act`],
                                                }))
                                              }
                                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-800 text-white/80 border border-white/10 hover:bg-slate-700 cursor-pointer"
                                            >
                                              Browser + last actions
                                            </button>
                                          )}
                                        </div>

                                        {/* Pre blocks */}
                                        {openPreBlocks[`${commit.id}_dbg`] && (
                                          <pre className="p-2.5 bg-black/70 text-indigo-200 text-[10px] font-mono rounded-lg border border-indigo-500/30 overflow-x-auto whitespace-pre-wrap">
                                            {JSON.stringify(evidence, null, 2)}
                                          </pre>
                                        )}

                                        {openPreBlocks[`${commit.id}_act`] && (
                                          <pre className="p-2.5 bg-black/70 text-white/90 text-[10px] font-mono rounded-lg border border-white/10 overflow-x-auto whitespace-pre-wrap">
                                            {evidence?.last_actions || evidence?.browser_log || '(No actions recorded)'}
                                          </pre>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                );
                              })
                            )}
                          </ul>
                        </div>
                        </>

                        {/* Linked Reports List */}
                        {selectedReports.length > 0 && (
                          <div className="space-y-2 border-t border-white/10 pt-3">
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                              Linked Reports & Evidence Packs ({selectedReports.length})
                            </h3>
                            <div className="space-y-2">
                              {selectedReports.map((rep: any) => {
                                const shotSrcs = reportShotSrcs(selectedTag.id, rep);
                                return (
                                <div
                                  key={rep.id}
                                  className="p-3 bg-slate-900/90 rounded-xl border border-white/10 flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold text-white truncate">
                                      {rep.dish_query || rep.user_note || `Report ${rep.id.slice(0, 8)}`}
                                    </div>
                                    <div className="text-[10px] text-white/50 mt-0.5">
                                      {rep.created_at ? rep.created_at.slice(0, 16).replace('T', ' ') : ''} ·{' '}
                                      {rep.shot_count || 0} screenshot(s) {rep.obsolete ? '· (obsolete)' : ''}
                                    </div>

                                    {/* The screenshot itself. This row used to say
                                        "1 screenshot(s)" and offer no way to open it,
                                        so a phone-reported bug could not be seen from
                                        the tracker at all. */}
                                    {shotSrcs.length > 0 && (
                                      <div className="flex gap-2 flex-wrap mt-2">
                                        {shotSrcs.map((s, sIdx) => (
                                          <div
                                            key={sIdx}
                                            onClick={() =>
                                              setLightboxImage({
                                                url: s.url,
                                                caption: `${t(language, 'bugReportScreenshot')} — ${rep.dish_query || rep.user_note || rep.id}`,
                                              })
                                            }
                                            className="w-20 h-20 rounded-xl bg-slate-800 border-2 border-indigo-500/40 hover:border-indigo-400 overflow-hidden cursor-pointer relative group flex items-end p-1 shadow-sm transition-transform active:scale-95"
                                          >
                                            <img
                                              src={s.url}
                                              alt={t(language, 'bugReportScreenshot')}
                                              className="absolute inset-0 w-full h-full object-cover"
                                              loading="lazy"
                                            />
                                            <span className="relative text-[9px] font-bold bg-black/70 text-white px-1 rounded z-10">
                                              {sIdx + 1}/{shotSrcs.length}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {!shotSrcs.length && rep.shot_upload_error && (
                                      <div className="text-[10px] text-rose-300/80 mt-1">
                                        {t(language, 'bugReportShotUploadFailed')}: {rep.shot_upload_error}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        viewTextArtifact(selectedTag.id, rep.reportId || rep.id, 'payload.json')
                                      }
                                      className="px-2 py-1 text-[10px] rounded-lg bg-slate-800 text-white/80 hover:bg-slate-700"
                                    >
                                      Payload
                                    </button>
                                    {!rep.obsolete && (
                                      <button
                                        type="button"
                                        onClick={() => pruneReport(selectedTag.id, rep.id)}
                                        className="px-2 py-1 text-[10px] rounded-lg bg-rose-950/60 text-rose-300 border border-rose-500/30 hover:bg-rose-900/80"
                                      >
                                        Prune R2
                                      </button>
                                    )}
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

          {/* Lightbox Modal */}
          {lightboxImage && (
            <div
              onClick={() => setLightboxImage(null)}
              className="fixed inset-0 z-[10100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-w-3xl max-h-[85vh] bg-[#111827] border border-white/20 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
              >
                <div className="p-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-bold text-white">{lightboxImage.caption || 'Evidence Snapshot'}</span>
                  <button
                    onClick={() => setLightboxImage(null)}
                    className="p-1 rounded-lg hover:bg-white/10 text-white/70"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 overflow-auto flex items-center justify-center bg-black/60">
                  <img
                    src={lightboxImage.url}
                    alt="evidence enlarged"
                    className="max-h-[70vh] max-w-full object-contain rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Text Artifact Viewer Modal */}
          {viewingArtifact && (
            <div
              onClick={() => setViewingArtifact(null)}
              className="fixed inset-0 z-[10100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl max-h-[85vh] bg-[#111827] border border-white/20 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
              >
                <div className="p-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-bold font-mono text-indigo-300">{viewingArtifact.name}</span>
                  <button
                    onClick={() => setViewingArtifact(null)}
                    className="p-1 rounded-lg hover:bg-white/10 text-white/70"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-white/90 overflow-auto bg-black/50 flex-1 whitespace-pre-wrap">
                  {viewingArtifact.content}
                </pre>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
