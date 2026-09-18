import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Upload, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight, Trash2, Download, Copy } from 'lucide-react';
import { PHASE_LABEL, groupJourneyByDish, mealLineNamesMatch } from '../utils/goldenScoreboard';
import { buildGoldenChecklist, classifyStudioRed, formatGoldenShare, replayTapeBanner, studioLoopPlan } from '../utils/goldenStudio';
import { fetchPhotosAsDataUrls, requestGoldenNewAnalyze, sameOriginPhotoUrl } from '../utils/goldenIngestClient';

type CaseRow = {
  id: string;
  title: string;
  status: string;
  job_id?: string;
  photo_url?: string;
  pass_count: number;
  fail_count: number;
  iteration: number;
  all_green: boolean;
  updated_at: string;
};

function formatLabelText(val: any): string {
  if (!val) return '';
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/(\.)([A-Z])/g, '$1 $2')
    .replace(/:\s*/g, ': ');
}

export default function GoldenInboxPanel() {
  const [domainTab, setDomainTab] = useState<'food' | 'biomarkers'>('food');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/golden/cases');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setCases(j.cases || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load golden cases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refreshCase = async (id: string) => {
    setOpenId(id);
    const r = await fetch(`/api/golden/cases/${id}`);
    setDetail(await r.json());
  };

  const openCase = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    await refreshCase(id);
  };

  const [loopMsg, setLoopMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const isBusy = (id: string, action?: string) =>
    !!busy && busy.id === id && (!action || busy.action === action);

  const replay = async (id: string, mode: 'log' | 'catalog' | 'pipeline' = 'log') => {
    setBusy({ id, action: mode });
    setLoopMsg(null);
    setError(null);
    try {
      const r = await fetch(`/api/golden/cases/${id}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.pipelineError || j.error || 'replay failed');
      const label =
        mode === 'log'
          ? 'Replayed saved tape (no agent)'
          : mode === 'catalog'
            ? 'Replayed catalog (dictionary only, no agent)'
            : 'Pipeline finished (may have called Curator/Diet)';
      setLoopMsg(`${label} · ${j.passCount ?? '—'} pass / ${j.failCount ?? '—'} fail`);
      await load();
      await refreshCase(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const deleteCase = async (id: string) => {
    setBusy({ id, action: 'delete' });
    setConfirmDeleteId(null);
    setError(null);
    try {
      const r = await fetch(`/api/golden/cases/${id}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'delete failed');
      if (openId === id) {
        setOpenId(null);
        setDetail(null);
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runAnalyze = async (id: string) => {
    if (busy?.action === 'analyze') return;
    setBusy({ id, action: 'analyze' });
    setLoopMsg(null);
    setError(null);
    try {
      let d = openId === id ? detail : null;
      if (!d) {
        const r = await fetch(`/api/golden/cases/${id}`);
        d = await r.json();
      }
      const rawPhotos: string[] = (d?.fixture?.photos || []).filter(Boolean);
      if (!rawPhotos.length) {
        throw new Error('No saved photos on this case. Snapshot again so photos are stored.');
      }
      const query = String(d?.fixture?.query || 'Analyze this meal photo.');
      setLoopMsg('Loading saved photos…');
      const photos = await fetchPhotosAsDataUrls(rawPhotos);
      requestGoldenNewAnalyze({ caseId: id, query, photos });
      setLoopMsg('NEW Analyze started. Inbox stays open — the board will rescore when the job finishes.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runLoop = async (id: string) => {
    setBusy({ id, action: 'loop' });
    setLoopMsg(null);
    setError(null);
    try {
      const r = await fetch(`/api/golden/cases/${id}/loop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok && !j.stopReason) throw new Error(j.error || 'loop failed');
      setLoopMsg(
        ['Run until green', j.message, j.pipelineError && j.pipelineError !== j.message ? j.pipelineError : '']
          .filter(Boolean)
          .join(' — ') || (j.allGreen ? 'Run until green · All green' : 'Run until green · Still red')
      );
      await load();
      await refreshCase(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const promote = async (id: string) => {
    setBusy({ id, action: 'promote' });
    try {
      const r = await fetch(`/api/golden/cases/${id}/promote`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'promote failed');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const copyStudioPrompt = async (id: string) => {
    const r = await fetch(`/api/golden/cases/${id}/studio-brief`);
    const md = await r.text();
    await navigator.clipboard.writeText(
      `Check this golden bug and fix it.\n\nDo NOT POST /loop. Do not replay the meal until all_green. Do not edit catalog, aliases, or expected numbers to paint green.\n\n1. Classify the reds (FALSE_FRIEND / DISH_DROP / OPENING_WRONG / SILENT_REPAIR / CALL_BUDGET). Several bugs = several jobs; do independent classes in this same turn when files do not collide.\n2. Each job: hypothesis + predicted unit test + one allowed file. Predicted test does not flip → hypothesis burned. Two burns → STOP that job (blocked_human) and start the next.\n3. Inner loop = named vitest. Outer = one pipeline replay after the class test is green.\n4. Forbidden: server_food_db.ts, food_aliases, expected.json, agent prompt bloat, POST /api/golden/cases/${id}/loop.\n\n---\n${md}`
    );
    setCopied(`studio:${id}`);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyJobShare = async (row: CaseRow) => {
    let d = openId === row.id ? detail : null;
    if (!d) {
      const r = await fetch(`/api/golden/cases/${row.id}`);
      d = await r.json();
    }
    const board = d?.board || {};
    const pending = uniquePending(board);
    const md = formatGoldenShare({
      id: row.id,
      title: d?.title || row.title,
      jobId: row.job_id,
      replayMode: board.replayMode,
      query: d?.fixture?.query,
      photoCount: Array.isArray(d?.fixture?.photos) ? d.fixture.photos.length : undefined,
      pending: buildGoldenChecklist(board).map((p) => ({
        group: p.status,
        label: p.label,
        youDo: p.youDo,
      })),
      mealLines: (board.expectedMeal || []).map((exp: any, idx: number) => {
        const obs = findMealObs(board, exp, idx);
        return {
          name: exp.name,
          expected: exp.calories != null ? `${exp.calories} kcal` : 'N/A',
          current: obs ? `${obs.calories ?? 0} kcal` : 'missing',
          status: mealLineStatus(board, exp, obs).label,
        };
      }),
    });
    await navigator.clipboard.writeText(md);
    setCopied(`job:${row.id}`);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-bold text-white">Golden Inbox</p>
            <div className="flex bg-slate-800 rounded-lg p-0.5 border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setDomainTab('food')}
                className={`px-2.5 py-0.5 rounded-md font-medium transition ${domainTab === 'food' ? 'bg-indigo-600 text-white shadow' : 'text-white/60 hover:text-white'}`}
              >
                Food
              </button>
              <button
                type="button"
                onClick={() => setDomainTab('biomarkers')}
                className={`px-2.5 py-0.5 rounded-md font-medium transition ${domainTab === 'biomarkers' ? 'bg-indigo-600 text-white shadow' : 'text-white/60 hover:text-white'}`}
              >
                Biomarkers
              </button>
            </div>
          </div>
          <p className="text-[11px] text-white/60">
            {domainTab === 'food' ? (
              <>
                <span className="text-emerald-300 font-semibold">No agent:</span> Replay log (re-score the saved tape) · Replay catalog (dictionary only).{' '}
                <span className="text-amber-300 font-semibold">May call Curator/Diet (quota):</span> Pipeline · Run until green.
              </>
            ) : (
              <>
                <span className="text-emerald-300 font-semibold">Class-first verification:</span> Unit conformance, identity resolution, review modification locks, and ingest trace audits.
              </>
            )}
          </p>
        </div>
        <button type="button" onClick={load} className="p-2 rounded-lg bg-slate-800 border border-white/15 text-white">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {domainTab === 'biomarkers' && (
        <div className="space-y-3">
          {[
            {
              classId: 'APPLY_MISS',
              title: 'Unit Scale & Review Apply',
              badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
              description: 'Guards against unit conversion loss and ensures historical SI rows remain untouched without silent rewrites.',
              cases: [
                {
                  id: 'G-B1',
                  name: 'Five Locked Unit Conversions',
                  desc: 'HDL 50→1.293, TG 125→1.411, LDL 130→3.362, Creatinine 0.9→79.56, Total Bilirubin 0.8→13.68.',
                  frozen: true,
                  metrics: [
                    { label: 'HDL', val: '50 → 1.293' },
                    { label: 'TG', val: '125 → 1.411' },
                    { label: 'LDL', val: '130 → 3.362' },
                    { label: 'Creatinine', val: '0.9 → 79.56' },
                    { label: 'Bilirubin', val: '0.8 → 13.68' },
                  ]
                }
              ]
            },
            {
              classId: 'CONFORMANCE_SHAPE',
              title: 'Table Shape & Format Ingestion',
              badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
              description: 'Validates multiline/single-line EMIS prints, shifted column tables, and non-medical vision aborts.',
              cases: [
                { id: 'G-B2', name: 'EMIS / NHS Print Table', desc: '140-row print table lexing & batch ingestion' },
                { id: 'G-B3', name: 'Shifted Columns & UK Units', desc: 'Exponential units and panel header detection' },
                { id: 'G-B9', name: 'Vision N/A Abort', desc: 'Non-medical image vision abort handling' },
              ]
            },
            {
              classId: 'IDENTITY_FALSE_FRIEND',
              title: 'Specimen Isolation',
              badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
              description: 'Prevents cross-mapping urine, stool, or saliva analytes into serum/blood catalog records.',
              cases: [
                { id: 'G-B4', name: 'Specimen Guard', desc: 'Urine/stool specimen analyte isolation' },
              ]
            },
            {
              classId: 'WRONG_DOOR',
              title: 'Routing & Door Classifier',
              badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
              description: 'Ensures dietary food entries and symptom diaries sent to medical analyze route to correct specialists.',
              cases: [
                { id: 'G-B5', name: 'Dietary in Medical Door', desc: 'Food logging input routed to food domain' },
                { id: 'G-B6', name: 'Symptom Log Entry', desc: 'Symptom diary input routed to symptom domain' },
              ]
            },
            {
              classId: 'COMPLETENESS',
              title: 'Incomplete Data Handling',
              badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
              description: 'Guards against fragmented readings and truncated inputs without valid numeric values.',
              cases: [
                { id: 'G-B7', name: 'Fragmented Reading', desc: 'Incomplete truncated table abort guard' },
              ]
            },
            {
              classId: 'UPSERT_IDENTITY',
              title: 'Report Deduplication',
              badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
              description: 'Detects re-pasted identical laboratory reports and prevents duplicate observation rows.',
              cases: [
                { id: 'G-B8', name: 'Repaste Identity', desc: 'Identical report re-paste deduplication' },
              ]
            }
          ].map((group) => (
            <div key={group.classId} className="rounded-2xl border border-white/10 bg-slate-800/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{group.title}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${group.badgeClass}`}>
                  {group.classId}
                </span>
              </div>
              <p className="text-[11px] text-white/70">{group.description}</p>
              <div className="space-y-2 pt-1">
                {group.cases.map((c: any) => (
                  <div key={c.id} className="p-2 rounded-lg bg-black/30 border border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white font-mono text-xs">{c.id} — {c.name}</span>
                      {c.frozen && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          Frozen
                        </span>
                      )}
                    </div>
                    <div className="text-white/60 text-[10px]">{c.desc}</div>
                    {c.metrics && (
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1 text-[10px]">
                        {c.metrics.map((m: any) => (
                          <div key={m.label} className="bg-black/40 p-1 rounded border border-white/5">
                            <div className="text-white/50 text-[9px]">{m.label}</div>
                            <div className="font-mono text-emerald-300 font-bold text-[10px]">{m.val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {domainTab === 'food' && error && (
        <div className="p-2.5 rounded-xl bg-rose-900/60 text-xs text-white flex gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
      {domainTab === 'food' && loopMsg && (
        <div
          className={`p-2.5 rounded-xl border text-xs ${
            /no agent/i.test(loopMsg)
              ? 'bg-emerald-900/40 border-emerald-500/30 text-emerald-100'
              : 'bg-amber-900/50 border-amber-500/30 text-amber-100'
          }`}
        >
          {loopMsg}
        </div>
      )}

      {domainTab === 'food' && cases.length === 0 && !loading && (
        <p className="text-xs text-white/60">No golden cases yet. Snapshot a meal and tick “Save as golden meal”.</p>
      )}

      {domainTab === 'food' && cases.map((c) => (
        <div key={c.id} className="rounded-2xl border border-white/15 bg-slate-800/80 overflow-hidden">
          <button
            type="button"
            onClick={() => openCase(c.id)}
            className="w-full text-left p-3 flex items-start gap-2"
          >
            {openId === c.id ? <ChevronDown className="w-4 h-4 mt-0.5 text-white/50" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-white/50" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-white truncate">{c.title}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.all_green ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                  {c.status}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  Fix Iteration #{openId === c.id && detail ? (detail.iteration || c.iteration || 1) : (c.iteration || 1)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-black/40 overflow-hidden flex">
                <div className="bg-emerald-500" style={{ width: `${pct(c.pass_count, c.pass_count + c.fail_count)}%` }} />
                <div className="bg-rose-500" style={{ width: `${pct(c.fail_count, c.pass_count + c.fail_count)}%` }} />
              </div>
              <p className="text-[10px] text-white/60 mt-1 flex items-center gap-2">
                <span className="text-emerald-300 font-semibold">{c.pass_count} Fixed so far</span>
                <span>·</span>
                <span className="text-rose-300 font-semibold">{c.fail_count} Still pending</span>
                <span>·</span>
                <span>job {c.job_id || '—'}</span>
              </p>
            </div>
          </button>
          <div
            className="px-3 pb-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-300/80">No agent — never calls Gemini</p>
              <div className="flex flex-wrap gap-2">
                <InboxAction
                  label="Replay log"
                  hint="Re-score the saved backend.log. No Gemini, no search."
                  tone="safe"
                  busy={isBusy(c.id, 'log')}
                  disabled={!!busy}
                  onClick={() => replay(c.id, 'log')}
                />
                <InboxAction
                  label="Replay catalog"
                  hint="Dictionary lookup only. Does not change green/pending on the card. Cannot promote."
                  tone="safe"
                  busy={isBusy(c.id, 'catalog')}
                  disabled={!!busy}
                  onClick={() => replay(c.id, 'catalog')}
                />
              </div>
            </div>
            <div className="space-y-1 pt-1 border-t border-white/10">
              <p className="text-[9px] font-bold uppercase tracking-wide text-amber-300/80">Calls Gemini — saved photos + query, no re-upload</p>
              <div className="flex flex-wrap gap-2">
                <InboxAction
                  label="NEW Analyze"
                  hint="Opens the food job with saved photos + query. Full scout + checks. New bugs are added when it finishes."
                  tone="agent"
                  icon="play"
                  busy={isBusy(c.id, 'analyze')}
                  disabled={!!busy}
                  onClick={() => runAnalyze(c.id)}
                />
              </div>
              <details className="pt-1">
                <summary className="text-[9px] font-bold uppercase tracking-wide text-white/40 cursor-pointer">
                  Advanced — skipScout only (no new photos)
                </summary>
                <div className="flex flex-wrap gap-2 mt-1">
                <InboxAction
                  label="Pipeline"
                  hint="Live skipScout analyze. No Vision Scout. May use quota."
                  tone="agent"
                  busy={isBusy(c.id, 'pipeline')}
                  disabled={!!busy}
                  onClick={() => replay(c.id, 'pipeline')}
                />
                <InboxAction
                  label="Run until green"
                  hint="Disabled (L14). Do not /loop. Use Pipeline once after a class unit test is green."
                  tone="agent"
                  icon="play"
                  busy={isBusy(c.id, 'loop')}
                  disabled
                  onClick={() => runLoop(c.id)}
                />
                </div>
              </details>
              <div className="flex flex-wrap gap-2 pt-1">
                <InboxAction
                  label="Promote"
                  hint="Copy this case into official goldens after it is all-green."
                  tone="ok"
                  icon="check"
                  busy={isBusy(c.id, 'promote')}
                  disabled={!c.all_green || !!busy}
                  onClick={() => promote(c.id)}
                />
                <InboxAction
                  label={copied === `job:${c.id}` ? 'Copied job' : 'Copy job'}
                  hint="Copy a short highlight of this case to paste in chat."
                  tone="neutral"
                  icon="copy"
                  disabled={!!busy}
                  onClick={() => copyJobShare(c)}
                />
                <InboxAction
                  label={copied === `studio:${c.id}` ? 'Copied prompt' : 'Copy AI Studio prompt'}
                  hint="Copy a brief for Studio. Does not run anything."
                  tone="neutral"
                  icon="upload"
                  disabled={!!busy}
                  onClick={() => copyStudioPrompt(c.id)}
                />
                {confirmDeleteId === c.id ? (
                  <div className="flex items-center gap-1">
                    <InboxAction
                      label="Confirm Delete"
                      hint="Permanently remove this golden case."
                      tone="danger"
                      icon="trash"
                      busy={isBusy(c.id, 'delete')}
                      disabled={!!busy}
                      onClick={() => deleteCase(c.id)}
                    />
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-white/80 border border-white/20"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <InboxAction
                    label="Delete"
                    hint="Remove this golden case."
                    tone="danger"
                    icon="trash"
                    busy={isBusy(c.id, 'delete')}
                    disabled={!!busy}
                    onClick={() => setConfirmDeleteId(c.id)}
                  />
                )}
              </div>
            </div>
            {isBusy(c.id) && (
              <p className="text-[10px] text-white/70">
                {busy?.action === 'log' && 'Replaying saved tape… no agent.'}
                {busy?.action === 'catalog' && 'Replaying catalog… no agent.'}
                {busy?.action === 'analyze' && 'NEW Analyze: Vision Scout on saved photos…'}
                {busy?.action === 'pipeline' && 'Running live pipeline… may call an agent.'}
                {busy?.action === 'loop' && 'Run until green… may call an agent.'}
                {busy?.action === 'promote' && 'Promoting…'}
                {busy?.action === 'delete' && 'Deleting…'}
              </p>
            )}
          </div>
          {openId === c.id && detail && (
            <div className="px-3 pb-3 space-y-3 border-t border-white/10 pt-2 text-xs">
              <div className="flex flex-wrap gap-2 mb-2">
                {detail.logUrl && (
                  <a href={detail.logUrl} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-emerald-900/40 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-800/60">
                    <Download className="w-3 h-3" />
                    Download Logs
                  </a>
                )}
                {detail.scoutUrl && (
                  <a href={detail.scoutUrl} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded-lg bg-indigo-900/40 border border-indigo-500/40 text-indigo-300 text-[10px] font-bold flex items-center gap-1 hover:bg-indigo-800/60">
                    <Download className="w-3 h-3" />
                    Download Prompt (Scout)
                  </a>
                )}
              </div>
              {/* Iteration & Fix Actions */}
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-300 text-[11px]">Fix Iteration Progress</span>
                  <span className="text-[10px] text-indigo-200 bg-indigo-900/60 px-2 py-0.5 rounded border border-indigo-400/30 font-semibold">
                    Iteration #{detail.iteration || c.iteration || 1}
                  </span>
                </div>
                {(detail.attempts || []).length > 0 ? (
                  <div className="space-y-1 text-[11px] text-white/80">
                    <p className="font-semibold text-indigo-200">What was done to fix it:</p>
                    {detail.attempts.slice(-3).map((a: any) => (
                      <div key={a.n} className="bg-black/30 p-1.5 rounded border border-white/10 space-y-0.5">
                        <p className="text-emerald-300 font-medium">Attempt #{a.n} ({a.actor || 'studio'})</p>
                        <p className="text-white/90"><span className="text-white/60">Action taken:</span> {a.tried}</p>
                        <p className="text-amber-200"><span className="text-white/60">Learned:</span> {a.learned}</p>
                        {a.replaySummary && <p className="text-indigo-200"><span className="text-white/60">Result:</span> {a.replaySummary}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-white/50 italic">No explicit fix attempts logged yet for this iteration. Re-run after code edits.</p>
                )}
                <AttemptBox
                  id={c.id}
                  onSaved={async () => {
                    await load();
                    const r = await fetch(`/api/golden/cases/${c.id}`);
                    setDetail(await r.json());
                  }}
                />
              </div>

              {detail.board?.replayMode && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold">
                    {detail.board.replayMode === 'catalog' || detail.board.replayMode === 'log' ? (
                      <span className="text-emerald-300">
                        Last replay: {detail.board.replayMode === 'catalog' ? 'catalog (dictionary only)' : 'log (saved tape)'} · no agent
                      </span>
                    ) : detail.board.replayMode === 'analyze' ? (
                      <span className="text-amber-300">
                        Last run: NEW Analyze · Vision Scout on saved photos · same reds re-checked automatically
                      </span>
                    ) : (
                      <span className="text-amber-300">
                        Last replay: {detail.board.replayMode} (live resolve) · may have called Curator/Diet
                      </span>
                    )}
                  </p>
                  {detail.board.replayMode === 'log' && (
                    <p className="text-[10px] text-amber-200/90 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2 py-1">
                      {replayTapeBanner(uniquePending(detail.board))}
                    </p>
                  )}
                </div>
              )}

              {detail.board?.ledger && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-950/30 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-violet-200 text-[11px]">Meal journey / trial balance</p>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${detail.board.ledger.compiler === 'green' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-200'}`}>
                      {detail.board.ledger.compiler === 'green' ? 'balanced' : 'unbalanced'}
                      {detail.board.ledger.primaryClass ? ` · ${detail.board.ledger.primaryClass}` : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/60">
                    Scout → foundation → reconcile → ledger payload → saved table → narrative.
                    A backend or agent correction stays red — it does not promote.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(detail.board.ledger.books || []).map((b: any) => (
                      <div key={b.id} className="px-1.5 py-1 rounded bg-black/30 border border-white/10 text-[10px]">
                        <p className="text-white/50">{b.label.replace(/ \(.*/, '')}</p>
                        <p className="font-bold text-white">{b.kcal == null ? '—' : `${b.kcal}`}</p>
                      </div>
                    ))}
                  </div>
                  {(detail.board.ledger.imbalances || []).length > 0 && (
                    <div className="space-y-0.5">
                      {detail.board.ledger.imbalances.map((i: any) => (
                        <p key={i.id} className="text-[10px] text-rose-100">
                          <span className="font-bold">{i.signal}</span>
                          {' · '}
                          {i.label}
                        </p>
                      ))}
                    </div>
                  )}
                  {!detail.board.ledger.mayPromote && (
                    <p className="text-[10px] text-amber-200">Compiler: do not claim fixed_meal / do not Promote.</p>
                  )}
                </div>
              )}

              {Array.isArray(detail.board?.journey) && detail.board.journey.length > 0 && (
                <div className="rounded-xl border border-white/15 bg-slate-900/80 p-2.5 space-y-1.5">
                  <p className="font-bold text-white text-[11px]">
                    Scout journey — {detail.board.journey.filter((j: any) => j.identityPass).length}/{detail.board.journey.length} identified
                  </p>
                  {groupJourneyByDish(detail.board.journey).map((g) => (
                    <div key={g.dish} className="space-y-0.5">
                      <p className="text-[10px] font-semibold text-white/90 truncate">{g.dish}</p>
                      {g.rows.map((j: any) => (
                        <div key={j.id} className="flex items-baseline justify-between gap-2 text-[10px] pl-3">
                          <span className="text-white/70 truncate">{j.query}</span>
                          <span className={`font-bold shrink-0 ${j.identityPass ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {PHASE_LABEL[j.phase as keyof typeof PHASE_LABEL] || j.phase}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const stats = detail.board?.resolutionStats;
                if (!stats || !stats.sampled) return null;
                return (
                  <div className="text-[10px] text-sky-200/90 space-y-1 rounded-xl border border-sky-500/20 bg-sky-950/30 p-2">
                    <p className="font-bold text-sky-300">Food Resolution Diagnostics</p>
                    <p>
                      <span className="font-medium text-white">Sampled Components:</span> {stats.sampled}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                      <span title="Live USDA/OFF"><span className="text-sky-400 font-bold">USDA:</span> {stats.usda}</span>
                      <span title="Internal catalog"><span className="text-indigo-400 font-bold">Catalog:</span> {stats.catalog}</span>
                      <span title="Printed label / official brand"><span className="text-emerald-400 font-bold">Label/brand:</span> {stats.curator}</span>
                      <span title="Category fallback"><span className="text-amber-400 font-bold">Fallback:</span> {stats.fallback}</span>
                    </div>
                  </div>
                );
              })()}

              {detail.fixture && (
                <div className="text-[10px] text-emerald-200/90 space-y-1 rounded-xl border border-emerald-500/20 bg-emerald-950/30 p-2">
                  <p className="font-bold text-emerald-300">Meal Picture & Query (from food log)</p>
                  <p>Query: {detail.fixture.query ? `“${detail.fixture.query}”` : '(photo only)'}</p>
                  {(() => {
                    const rawPhotos = detail.fixture.photos || detail.fixture.photoList || detail.fixture.imageRefs;
                    const photoList: string[] = Array.isArray(rawPhotos) && rawPhotos.length > 0
                      ? rawPhotos
                      : ([detail.fixture.photo, detail.fixture.photoUrl, detail.fixture.imageUrl, c.photo_url].filter(Boolean) as string[]);
                    return photoList.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {photoList.map((u: string, i: number) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                            <img src={sameOriginPhotoUrl(u)} alt={`meal photo ${i + 1}`} className="h-14 w-14 object-cover rounded border border-emerald-400/40" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-white/40 italic mt-0.5">No image attached</p>
                    );
                  })()}
                </div>
              )}

              {/* Top Dishes / Meal Lines Expected vs Current Iteration Comparison */}
              {Array.isArray(detail.board?.expectedMeal) && detail.board.expectedMeal.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-white/15 bg-slate-900/80 p-2.5">
                  <p className="font-bold text-white text-[11px] flex items-center justify-between">
                    <span>Meal Dishes / Lines — Expected vs Current Iteration</span>
                  </p>
                  <div className="space-y-1 text-[10px]">
                    {detail.board.expectedMeal.map((exp: any, idx: number) => {
                      const obs = findMealObs(detail.board, exp, idx);
                      const st = mealLineStatus(detail.board, exp, obs);
                      return (
                        <div key={idx} className={`p-1.5 rounded border flex flex-wrap items-center justify-between gap-1 ${st.tone === 'warn' ? 'bg-amber-950/30 border-amber-500/30' : st.tone === 'ok' ? 'bg-emerald-950/30 border-emerald-500/30' : 'bg-rose-950/30 border-rose-500/30'}`}>
                          <div>
                            <p className="font-semibold text-white">{exp.name}</p>
                            <p className="text-white/60">Expected: {exp.calories != null ? `${exp.calories} kcal` : 'N/A'} · {exp.weightGrams != null ? `${exp.weightGrams}g` : 'N/A'}</p>
                          </div>
                          <div className="text-right">
                            <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${st.tone === 'warn' ? 'bg-amber-500/20 text-amber-200' : st.tone === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                              {st.label}
                            </span>
                            <p className="text-white/70 mt-0.5">
                              Current: {obs ? `${obs.calories ?? 0} kcal (${obs.weightGrams ?? 0}g)` : 'Missing in current run'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const board = detail.board || {};
                const mealMisses = (board.expectedMeal || [])
                  .map((exp: any, idx: number) => {
                    const obs = findMealObs(board, exp, idx);
                    if (!obs) return `missing item "${exp.name}"`;
                    return '';
                  })
                  .filter(Boolean);
                const plan = studioLoopPlan(board.outcomes, { mealMisses, replayMode: board.replayMode });
                const checks = buildGoldenChecklist(board);
                const counts = {
                  not_fixed: checks.filter((c) => c.status === 'not_fixed').length,
                  need_analyze: checks.filter((c) => c.status === 'need_analyze').length,
                  accept: checks.filter((c) => c.status === 'accept').length,
                  fixed: checks.filter((c) => c.status === 'fixed').length,
                };
                return (
                  <div className="rounded-xl border border-white/15 bg-slate-900/80 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="font-bold text-white text-[11px]">Bug list</p>
                      <p className="text-[10px] text-white/60">
                        {counts.not_fixed} not fixed · {counts.need_analyze} need analyze · {counts.fixed} fixed
                        {counts.accept ? ` · ${counts.accept} accept` : ''}
                      </p>
                    </div>
                    <p className="text-[10px] text-white/60">{plan.instructions}</p>
                    {checks.length === 0 ? (
                      <p className="text-[10px] text-white/50 italic">No checks recorded yet. Replay log or NEW Analyze.</p>
                    ) : (
                      checks.map((p) => (
                        <div
                          key={p.id}
                          className={`text-[10px] p-1.5 rounded border space-y-0.5 ${
                            p.status === 'fixed'
                              ? 'bg-emerald-950/30 border-emerald-500/20 text-emerald-100'
                              : p.status === 'need_analyze'
                                ? 'bg-amber-950/30 border-amber-500/30 text-amber-100'
                                : p.status === 'accept'
                                  ? 'bg-slate-800/60 border-white/10 text-white/80'
                                  : 'bg-rose-950/30 border-rose-500/20 text-rose-100'
                          }`}
                        >
                          <p className="font-medium flex items-center justify-between gap-2">
                            <span className="min-w-0">{formatLabelText(p.label)}</span>
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/30">
                              {p.status === 'fixed'
                                ? 'Fixed'
                                : p.status === 'need_analyze'
                                  ? 'Need Analyze'
                                  : p.status === 'accept'
                                    ? 'Accept'
                                    : 'Not fixed'}
                            </span>
                          </p>
                          {(p.expected || p.actual) && p.status !== 'fixed' && (
                            <p className="text-white/60">
                              {p.expected != null ? `Expected: ${formatLabelText(p.expected)}` : ''}
                              {p.expected != null && p.actual != null ? ' · ' : ''}
                              {p.actual != null ? `Current: ${formatLabelText(p.actual)}` : ''}
                            </p>
                          )}
                          {p.youDo && p.status !== 'fixed' && (
                            <p className="text-white/70">{p.youDo}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}

              {(detail.board?.tensions || []).length > 0 && (
                <div className="text-[10px] text-amber-200/90 space-y-1 rounded-xl border border-amber-500/30 bg-amber-950/30 p-2">
                  <p className="font-bold text-amber-300">Tensions / Warnings</p>
                  {detail.board.tensions.map((t: any) => (
                    <p key={t.id}>
                      {t.left} ↔ {t.right} — {t.note}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InboxAction({
  label,
  hint,
  tone,
  icon,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  tone: 'safe' | 'agent' | 'ok' | 'neutral' | 'danger';
  icon?: 'play' | 'check' | 'upload' | 'trash' | 'copy';
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'safe'
      ? 'bg-slate-700'
      : tone === 'agent'
        ? 'bg-amber-700'
        : tone === 'ok'
          ? 'bg-emerald-700'
          : tone === 'danger'
            ? 'bg-rose-700'
            : 'bg-slate-700';
  const Icon =
    icon === 'play'
      ? Play
      : icon === 'check'
        ? CheckCircle2
        : icon === 'upload'
          ? Upload
          : icon === 'trash'
            ? Trash2
            : icon === 'copy'
              ? Copy
              : null;
  return (
    <button
      type="button"
      title={hint}
      disabled={disabled}
      data-golden-action={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={`px-2.5 py-1 rounded-lg ${toneClass} disabled:opacity-30 text-[10px] font-bold text-white flex items-center gap-1`}
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : Icon ? <Icon className="w-3 h-3" /> : null}
      {label}
      {tone === 'safe' && (
        <span className="text-[8px] font-bold uppercase tracking-wide text-emerald-300">no agent</span>
      )}
      {tone === 'agent' && (
        <span className="text-[8px] font-bold uppercase tracking-wide text-amber-100">may call agent</span>
      )}
    </button>
  );
}

function AttemptBox({ id, onSaved }: { id: string; onSaved: () => Promise<void> }) {
  const [tried, setTried] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="pt-1.5 space-y-1">
      <p className="text-[10px] text-indigo-200/80">After a code/catalog change, log it so the loop can run again:</p>
      <div className="flex gap-1">
        <input
          className="flex-1 bg-slate-900 border border-white/20 rounded px-1.5 py-0.5 text-[10px] text-white"
          placeholder="What you changed (unlocks the next run)"
          value={tried}
          onChange={(e) => setTried(e.target.value)}
        />
        <button
          type="button"
          disabled={!tried.trim() || busy}
          className="px-2 py-0.5 rounded bg-indigo-700 disabled:opacity-30 text-[10px] font-bold text-white"
          onClick={async () => {
            setBusy(true);
            try {
              const r = await fetch(`/api/golden/cases/${id}/attempt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor: 'human', tried: tried.trim(), learned: '', next: 'Run until green' }),
              });
              if (!r.ok) throw new Error('attempt failed');
              setTried('');
              await onSaved();
            } finally {
              setBusy(false);
            }
          }}
        >
          Log attempt
        </button>
      </div>
    </div>
  );
}

function findMealObs(board: any, exp: any, idx: number) {
  const list = board?.observedMeal || [];
  const presenceOnly = exp.calories == null;
  return (
    list.find((o: any) => mealLineNamesMatch(exp.name, o.name, presenceOnly)) ||
    (presenceOnly ? undefined : list[idx])
  );
}

function mealLineStatus(board: any, exp: any, obs: any): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  const blob = (board?.invariants || [])
    .filter((i: any) => !i.pass)
    .map((i: any) => `${i.id} ${i.label}`)
    .join(' ');
  const name = String(exp.name || '').toLowerCase();
  if (/weight_anchor|overwrote the first/.test(blob) && name && blob.toLowerCase().includes(name)) {
    return { label: 'UNSCORED (buggy snapshot)', tone: 'warn' };
  }
  if (/label_merge|merged into/.test(blob) && /serrano|reformed ham|gran reserva/.test(name)) {
    return { label: 'UNSCORED (glued label)', tone: 'warn' };
  }
  if (!obs) return { label: '✗ PENDING', tone: 'bad' };
  if (exp.calories == null || exp.scored === false) {
    return { label: '✓ PRESENT', tone: 'ok' };
  }
  if (Math.abs((obs.calories ?? 0) - (exp.calories ?? 0)) < 30) {
    return { label: '✓ PASSED', tone: 'ok' };
  }
  return { label: '✗ PENDING', tone: 'bad' };
}

function uniquePending(board: any): Array<{
  id: string;
  group: string;
  label: string;
  expected?: any;
  actual?: any;
  next?: string;
  youDo?: string;
  kind?: string;
}> {
  const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const topic = (s: string) => {
    const b = norm(s);
    if (/weight_anchor|overwrote the first|portion weight|500.*1000/.test(b)) return 'weight';
    if (/food\s*data|empty nutrition|comparison mode|empty_foodlog/.test(b)) return 'compare';
    if (/brand\s*guard|generic token|sugar.*brand/.test(b)) return 'brand';
    if (/label_merge|merged into/.test(b)) return 'label_merge';
    if (/truth_merge|246.*102|150.*102|rejected vs ocr/.test(b)) return 'truth_merge';
    return norm(s).slice(0, 80);
  };
  const hamMissing = (board?.expectedMeal || []).some((exp: any) => {
    if (!/^ham$/i.test(String(exp.name || '').trim()) || exp.calories != null) return false;
    return !findMealObs(board, exp, -1);
  });
  const invs = (board?.invariants || []).filter((i: any) => {
    if (i.pass || !i.label) return false;
    if (hamMissing && /truth_merge|rejected vs ocr|102 kcal/.test(`${i.id} ${i.label}`)) return false;
    return true;
  });
  const outs = (board?.outcomes || []).filter((o: any) => {
    if (o.enabled === false || o.pass === true || !o.label) return false;
    if (hamMissing && /truth_merge|rejected vs ocr|102 kcal/.test(`${o.id} ${o.label}`)) return false;
    return true;
  });
  const rows: Array<{
    id: string;
    group: string;
    label: string;
    expected?: any;
    actual?: any;
    next?: string;
    youDo?: string;
    kind?: string;
  }> = [];
  const seen = new Set<string>();
  const push = (id: string, group: string, label: string, expected?: any, actual?: any) => {
    const k = topic(label);
    if (!k || seen.has(k) || seen.has(norm(label))) return;
    seen.add(k);
    seen.add(norm(label));
    const how = classifyStudioRed(id, label);
    rows.push({ id, group, label, expected, actual, next: how.next, youDo: how.youDo, kind: how.kind });
  };
  outs.forEach((o: any) => {
    const inv = invs.find((i: any) => i.id === o.id || norm(i.label) === norm(o.label));
    push(o.id, inv?.group || o.kind || 'check', o.label, o.expected, o.actual ?? inv?.actual);
  });
  invs.forEach((i: any) => push(i.id, i.group || 'check', i.label, i.expected, i.actual));
  return rows;
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}
