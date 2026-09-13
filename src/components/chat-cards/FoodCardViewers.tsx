import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, ChevronUp, Copy, Download, Loader2, Sparkles } from 'lucide-react';
import { translations } from '../../utils/translations';
import { getAgentRequestLogs } from '../../utils/agentLogsTracker';
import { JobStore } from '../../jobs/JobStore';
import { PositionedTooltip } from '../ui/PositionedTooltip';

/**
 * F-6 viewer cluster extracted from chat-cards/FoodCard.tsx.
 * Debug/log/thought renderers shared by FoodCard, LogChat, and HealthBaselineCard.
 * No product logic moved — presentation only.
 */

export const InfoTooltipBadge: React.FC<{ title?: string }> = ({ title }) => {
  if (!title) return null;

  const decodedTitle = title.replace(/&quot;/g, '"');
  const parts = decodedTitle.split(/\s*;;;\s*|\s*;;\s*/);

  const content = parts.length > 1 ? (
    <div className="space-y-1 font-sans">
      {parts.map((part, idx) => {
        const trimmed = part.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith('classification:')) {
          return (
            <div key={idx} className="font-mono font-bold text-[10px] text-cyan-300 border-b border-slate-700/80 pb-1 tracking-wider">
              {trimmed}
            </div>
          );
        }
        if (lower.startsWith('matched keywords:')) {
          const kwVal = trimmed.substring(trimmed.indexOf(':') + 1).trim();
          return (
            <div key={idx} className="text-[10px] text-slate-300">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Matched Keywords: </span>
              <span className="font-mono text-emerald-300">{kwVal}</span>
            </div>
          );
        }
        if (idx === 1 || trimmed.startsWith('"') || trimmed.startsWith("'")) {
          const rawName = trimmed.replace(/^["']|["']$/g, '');
          return (
            <div key={idx} className="font-semibold text-indigo-300 text-[11px]">
              "{rawName}"
            </div>
          );
        }
        return (
          <div key={idx} className="pt-0.5 border-t border-slate-700/60 text-[9px] font-mono text-slate-400">
            {trimmed}
          </div>
        );
      })}
    </div>
  ) : (
    <div className="text-[11px] leading-relaxed">{decodedTitle}</div>
  );

  return (
    <span className="inline-block ml-1">
      <PositionedTooltip
        trigger={
          <div
            className="inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/80 hover:bg-indigo-200 dark:hover:bg-indigo-800 rounded-full cursor-pointer transition-all select-none border border-indigo-300/50 dark:border-indigo-700/50 focus:outline-none"
            aria-label="Info explanation"
          >
            ℹ️
          </div>
        }
        content={content}
        contentClassName="bg-slate-900/95 dark:bg-slate-800/95 text-white border-slate-700/80"
      />
    </span>
  );
};

function build31NutrientsMarkdownClient(nutrients: Record<string, any>): string {
  if (!nutrients || typeof nutrients !== 'object') return '';

  const coreList = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g' },
    { key: 'totalFat', label: 'Total Fat', unit: 'g' },
    { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g' },
    { key: 'transFat', label: 'Trans Fat', unit: 'g' },
    { key: 'sugar', label: 'Total Sugar', unit: 'g' },
    { key: 'addedSugar', label: 'Added Sugar', unit: 'g' },
    { key: 'sodium', label: 'Sodium', unit: 'mg' },
    { key: 'potassium', label: 'Potassium', unit: 'mg' },
    { key: 'totalFibre', label: 'Total Fibre', unit: 'g' },
    { key: 'solubleFibre', label: 'Soluble Fibre', unit: 'g' },
  ];

  const additionalList = [
    { key: 'unsaturatedFat', label: 'Unsaturated Fat', unit: 'g' },
    { key: 'omega3', label: 'Omega-3', unit: 'g' },
    { key: 'salt', label: 'Salt', unit: 'g' },
    { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
    { key: 'calcium', label: 'Calcium', unit: 'mg' },
    { key: 'iron', label: 'Iron', unit: 'mg' },
    { key: 'zinc', label: 'Zinc', unit: 'mg' },
    { key: 'selenium', label: 'Selenium', unit: 'mcg' },
    { key: 'iodine', label: 'Iodine', unit: 'mcg' },
    { key: 'phosphorus', label: 'Phosphorus', unit: 'mg' },
    { key: 'vitaminD', label: 'Vitamin D', unit: 'IU' },
    { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg' },
    { key: 'folate', label: 'Folate (B9)', unit: 'mcg' },
    { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
    { key: 'vitaminE', label: 'Vitamin E', unit: 'mg' },
    { key: 'vitaminK', label: 'Vitamin K', unit: 'mcg' },
    { key: 'vitaminA', label: 'Vitamin A', unit: 'mcg' },
    { key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg' },
    { key: 'thiamine', label: 'Thiamine (B1)', unit: 'mg' },
    { key: 'riboflavin', label: 'Riboflavin (B2)', unit: 'mg' },
    { key: 'niacin', label: 'Niacin (B3)', unit: 'mg' },
  ];

  const fmt = (v: any, unit: string, key?: string, isAdditionalTrace?: boolean) => {
    if (key === 'salt' && (v === undefined || v === null || isNaN(Number(v)))) {
      if (nutrients && nutrients.sodium !== undefined && nutrients.sodium !== null && !isNaN(Number(nutrients.sodium))) {
        const saltGrams = (Number(nutrients.sodium) * 2.54) / 1000;
        const roundedSalt = Math.round(saltGrams * 100) / 100;
        return roundedSalt === 0 && saltGrams > 0 ? '<0.01 g' : `${roundedSalt} g`;
      }
    }
    if (v === undefined || v === null || isNaN(Number(v))) return '--';
    const num = Math.round(Number(v) * 100) / 100;
    // The 20 "additional" trace nutrients (selenium, riboflavin, niacin, B6, B12,
    // phosphorus, etc.) are currently only ever populated from sources that supply a real
    // measured value — nothing in the pipeline computes a genuine, non-zero 0 for these.
    // So an exact 0 here means "not measured," not "confirmed zero," and showing a bare
    // "0" would misleadingly imply the food has none of that nutrient. Core nutrients
    // (calories, protein, etc.) are unaffected — they're always populated.
    if (isAdditionalTrace && num === 0) return 'N/A';
    return unit ? `${num} ${unit}` : `${num}`;
  };

  const coreRows = coreList.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit, item.key)} |`);
  const addRows = additionalList.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit, item.key, true)} |`);

  return [
    "\n### 📋 Comprehensive Nutrient Values (31 Nutrients)\n",
    "#### Core Nutrients (11)",
    "| Nutrient | Value |",
    "|---|---|",
    ...coreRows,
    "\n#### Additional Nutrients (20)",
    "| Nutrient | Value |",
    "|---|---|",
    ...addRows
  ].join("\n");
}

export const ScratchpadMarkdownViewer: React.FC<{ content: any; className?: string; showCopyButton?: boolean; nutrients?: Record<string, any>; msg?: any; pendingFoodLog?: any; language?: string }> = ({ content, className = '', showCopyButton = false, nutrients, msg, pendingFoodLog, language = 'en' }) => {
  const t = translations[language || 'en'] || translations.en;
  const [isCopied, setIsCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const strContent = typeof content === 'string' ? content : (content && typeof content === 'object' ? (content.text || content.message || JSON.stringify(content)) : String(content || ''));
  if (!strContent || !strContent.trim()) return null;
  const cleanContent = strContent.replace(/\\\|/g, '•');

  // Strip duplicate 31-nutrient table from screen rendering if legacy/stream text has it
  const localizeReceiptChrome = (md: string) => {
    if (!md) return md;
    return md
      .replace(/Nutrition calculation/g, t.nutritionCalculation || 'Nutrition calculation')
      .replace(/ITEM \/ INGREDIENT/g, t.itemIngredientHeader || 'ITEM / INGREDIENT')
      .replace(/Item \/ Ingredient/g, t.itemIngredientHeader || 'ITEM / INGREDIENT')
      .replace(/GRAND MEAL TOTAL/g, t.grandMealTotal || 'GRAND MEAL TOTAL');
  };
  const displayContent = localizeReceiptChrome(
    cleanContent.includes('### 📋 Comprehensive Nutrient Values')
      ? cleanContent.split('### 📋 Comprehensive Nutrient Values')[0].trim()
      : cleanContent
  );

  const buildFullMarkdownText = () => {
    let fullTextToCopy = localizeReceiptChrome(cleanContent.trim());
    if (!fullTextToCopy.includes('Comprehensive Nutrient Values') && nutrients) {
      const nutMd = build31NutrientsMarkdownClient(nutrients);
      if (nutMd) {
        fullTextToCopy = fullTextToCopy + '\n\n' + nutMd.trim();
      }
    }

    if (!fullTextToCopy.includes('Nutrition calculation') && !fullTextToCopy.includes(t.nutritionCalculation || '') && (fullTextToCopy.startsWith('|') || fullTextToCopy.includes('Item / Ingredient'))) {
      fullTextToCopy = `### 🧾 ${t.nutritionCalculation || 'Nutrition calculation'}\n\n${fullTextToCopy}`;
    }

    const footnotes: string[] = [];
    const infoLinkPattern = /\[ℹ️\]\(#info "([^"]*)"\)/g;
    let footnoteIndex = 0;
    const textForClipboard = fullTextToCopy.replace(infoLinkPattern, (_match, tooltipText) => {
      footnoteIndex += 1;
      footnotes.push(`[${footnoteIndex}] ${tooltipText}`);
      return `(ℹ️ see note ${footnoteIndex})`;
    });
    const finalText = footnotes.length > 0
      ? `${textForClipboard}\n\nNotes (what each calculation step means):\n${footnotes.join('\n')}`
      : textForClipboard;

    return finalText;
  };

  const handleCopyTable = () => {
    const finalText = buildFullMarkdownText();
    navigator.clipboard.writeText(finalText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(() => {
      setIsCopied(false);
    });
  };

  const handleDownloadTableAndLogs = async () => {
    setIsDownloading(true);
    try {
      const tableMarkdown = buildFullMarkdownText();

      // Helper to safely stringify logs (whether string, array of objects, or array of strings)
      const extractLogString = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') return val.trim();
        if (Array.isArray(val)) {
          return val.map((l: any) => typeof l === 'string' ? l : (l.message ? (l.timestamp ? `[${l.timestamp}] ${l.message}` : l.message) : JSON.stringify(l))).join('\n').trim();
        }
        return '';
      };

      // Gather full log history without cropping
      let fullLogsText = '';
      const foodLog = pendingFoodLog || msg?.data?.pendingFoodLog || msg?.pendingFoodLog;
      const candidateJobId = msg?.data?.jobId || foodLog?.jobId || (msg?.id?.startsWith('msg_assistant_job_') ? msg.id.replace('msg_assistant_job_', 'job_') : '') || (msg?.id?.startsWith('msg_assistant_') && !msg.id.includes('fail') && !msg.id.includes('clarify') && !/^\d+$/.test(msg.id.replace('msg_assistant_', '')) ? msg.id.replace('msg_assistant_', '') : '');
      const job = candidateJobId ? JobStore.getJob(candidateJobId) : null;
      const targetReqId = msg?.data?.requestId || job?.requestId || candidateJobId || foodLog?.id || '';

      // 1. Check inline logs on msg object, foodLog object, or JobStore first
      fullLogsText =
        extractLogString(msg?.data?.agentResult?.backendLogs) ||
        extractLogString(msg?.data?.agentResult?.globalLiveLogs) ||
        extractLogString(msg?.data?.backendLogs) ||
        extractLogString(msg?.agentResult?.backendLogs) ||
        extractLogString(foodLog?.backendLogs) ||
        extractLogString(foodLog?.rawLogs) ||
        extractLogString(foodLog?.globalLiveLogs) ||
        extractLogString(msg?.data?.debugLogs) ||
        extractLogString(job?.result?.backendLogs) ||
        extractLogString((job as any)?.clean_result?.backendLogs) ||
        extractLogString(job?.liveThoughts?.backendLogs) ||
        extractLogString(job?.liveThoughts?.globalLiveLogs) ||
        extractLogString((job as any)?.accumulatedLogs);

      // 2. If logs are an R2 reference, fetch the full content
      if (fullLogsText && (fullLogsText.startsWith('[Logs stored in R2') || fullLogsText.includes('.r2.dev/logs/'))) {
        const urlMatch = fullLogsText.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) ||
                         fullLogsText.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
        if (urlMatch) {
          const r2Url = urlMatch[1] || urlMatch[0];
          try {
            let r2Res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(r2Url)}`);
            if (!r2Res.ok) {
              r2Res = await fetch(r2Url);
            }
            if (r2Res.ok) {
              const fetchedText = await r2Res.text();
              if (fetchedText && fetchedText.trim() && !fetchedText.startsWith('[Logs stored in R2')) {
                fullLogsText = fetchedText.trim();
              }
            }
          } catch (e) {
            console.warn('[FoodCard] Failed fetching R2 logs for download:', e);
          }
        }
      }

      // 3. Try server endpoints using the specific job/request ID (NOT generic sessionId)
      if (!fullLogsText.trim() && targetReqId) {
        try {
          // Check server-job endpoint first
          const url1 = `/api/gemini/debug-logs?sessionId=${encodeURIComponent(`server-job-${targetReqId}`)}`;
          let res = await fetch(url1, { headers: { 'X-Session-ID': targetReqId } });
          if (!res.ok) {
            const url2 = `/api/gemini/debug-logs?sessionId=${encodeURIComponent(targetReqId)}`;
            res = await fetch(url2, { headers: { 'X-Session-ID': targetReqId } });
          }
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.logs) && data.logs.length > 0) {
              fullLogsText = data.logs.map((l: any) => {
                if (typeof l === 'string') return l;
                if (l.message) return l.timestamp ? `[${l.timestamp}] ${l.message}` : l.message;
                return JSON.stringify(l);
              }).join('\n').trim();
            }
          }
        } catch {
          /* ignore server fetch errors and fall back to local logs */
        }
      }

      // 4. Fallback to localStorage request logs tracker ONLY if matching specific job/request/msg ID
      if (!fullLogsText.trim() && (targetReqId || msg?.id || foodLog?.id)) {
        try {
          const savedLogs = getAgentRequestLogs();
          if (savedLogs && savedLogs.length > 0) {
            const matched = savedLogs.find(r =>
              (targetReqId && r.id === targetReqId) ||
              (targetReqId && r.id === `server-job-${targetReqId}`) ||
              (candidateJobId && r.id === candidateJobId) ||
              (msg?.id && r.id === msg.id) ||
              (foodLog?.id && r.id === foodLog.id)
            );
            if (matched && Array.isArray(matched.logs) && matched.logs.length > 0) {
              fullLogsText = matched.logs.map(l => typeof l === 'string' ? l : (l.timestamp ? `[${l.timestamp}] ${l.message}` : (l.message || JSON.stringify(l)))).join('\n').trim();
            }
          }
        } catch (e) {
          /* ignore */
        }
      }

      // Combine table markdown and full log history
      const combinedOutput = fullLogsText.trim()
        ? `${tableMarkdown}\n\n\n${fullLogsText.trim()}\n`
        : tableMarkdown;

      // Calculate filename parts: e.g. "17:43 - chicken wrap 10s - 2i.md"
      let timeStr = '12:00';
      const msgTime = foodLog?.date || msg?.timestamp;
      if (msgTime) {
        const d = new Date(msgTime);
        if (!isNaN(d.getTime())) {
          timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      }
      if ((timeStr === '12:00' || !msgTime) && fullLogsText) {
        const timeMatch = fullLogsText.match(/\[(\d{1,2}:\d{2})(?::\d{2})?\]/) || fullLogsText.match(/\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
        if (timeMatch) {
          timeStr = timeMatch[1];
        } else {
          const d = new Date();
          timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      }

      const rawDishName = foodLog?.name || (foodLog?.itemsBreakdown?.[0]?.canonicalDbName || foodLog?.itemsBreakdown?.[0]?.originalName || foodLog?.itemsBreakdown?.[0]?.keyword) || 'nutrition calculation';
      let cleanDish = rawDishName
        .toLowerCase()
        .replace(/^mcdonald'?s\s*/i, '')
        .replace(/[^a-z0-9\s-]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanDish) cleanDish = 'nutrition calculation';

      // Duration estimation in seconds
      let durationSec = 10;
      if (fullLogsText) {
        const lines = fullLogsText.split('\n');
        let startMs = 0;
        let endMs = 0;
        for (const line of lines) {
          const isoMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/);
          if (isoMatch) {
            const t = new Date(isoMatch[1]).getTime();
            if (!isNaN(t)) {
              if (!startMs) startMs = t;
              endMs = t;
            }
          }
        }
        if (startMs && endMs && endMs > startMs) {
          durationSec = Math.max(1, Math.round((endMs - startMs) / 1000));
        }
      }

      // Image count
      let imageCount = 0;
      if (Array.isArray(foodLog?.imageUrls)) imageCount = foodLog.imageUrls.length;
      else if (Array.isArray(foodLog?.images)) imageCount = foodLog.images.length;
      else if (Array.isArray(msg?.data?.scoutItems)) imageCount = 1;

      if (imageCount === 0 && fullLogsText) {
        const imgMatch = fullLogsText.match(/Received (\d+) image\(s\)/i);
        if (imgMatch) imageCount = parseInt(imgMatch[1], 10);
      }

      const filename = `${timeStr} - ${cleanDish} ${durationSec}s - ${imageCount}i.md`;

      // Trigger download
      const blob = new Blob([combinedOutput], { type: 'text/markdown;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`relative text-xs text-theme-text-secondary leading-relaxed bg-indigo-50/5 dark:bg-indigo-950/10 rounded-lg p-2 border border-indigo-200/10 dark:border-indigo-800/10 overflow-x-auto max-w-full ${className}`}>
      {showCopyButton && (
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyTable}
            className="inline-flex items-center justify-center p-1.5 text-[10px] font-medium rounded-md border border-indigo-200/40 dark:border-indigo-800/40 bg-white/80 dark:bg-slate-900/80 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
            aria-label={t.copyTableForSharing}
            title={isCopied ? t.copiedTable : t.copyTable}
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleDownloadTableAndLogs}
            disabled={isDownloading}
            className="inline-flex items-center justify-center p-1.5 text-[10px] font-medium rounded-md border border-indigo-200/40 dark:border-indigo-800/40 bg-white/80 dark:bg-slate-900/80 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer disabled:opacity-50"
            aria-label={t.downloadTableAndHistory}
            title={t.downloadTableAndHistory}
          >
            {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
      <Markdown 
        remarkPlugins={[remarkGfm]}
        components={{
          h3: ({ children }) => (
            <h3 className="text-[12px] font-bold text-indigo-500 dark:text-indigo-400 my-1 flex items-center gap-1 font-sans">
              {children}
            </h3>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-xl border border-indigo-200/40 dark:border-indigo-800/40 bg-white dark:bg-slate-900 shadow-sm font-sans">
              <table className="w-full text-[11px] text-left border-collapse min-w-[500px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-indigo-50/90 dark:bg-indigo-950/80 border-b border-indigo-200/60 dark:border-indigo-800/60 text-indigo-900 dark:text-indigo-200 font-bold text-[10px] uppercase tracking-wider">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 border-r border-indigo-200/40 dark:border-indigo-800/40 last:border-r-0 whitespace-nowrap">
              {children}
            </th>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 transition-colors">
              {children}
            </tr>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-200 border-r border-slate-100 dark:border-slate-800/40 last:border-r-0 leading-snug">
              {children}
            </td>
          ),
          p: ({ children }) => (
            <p className="my-1 font-sans text-[11px] leading-relaxed whitespace-pre-wrap">
              {children}
            </p>
          ),
          a: ({ href, title, children }) => {
            if (href === '#info' || href?.startsWith('#')) {
              return <InfoTooltipBadge title={title || (typeof children === 'string' ? children : '')} />;
            }
            return (
              <>
                {children}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.viewSourceUsda || "View source on USDA FoodData Central"}
                  className="inline-flex items-center ml-1 text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 transition-colors align-middle"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </>
            );
          }
        }}
      >
        {displayContent}
      </Markdown>
    </div>
  );
};

const LiveBackendStreamViewer = ({ logs }: { logs: string }) => {
  const [activeTab, setActiveTab] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const matchRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isFirstStreamRef = React.useRef(true);
  const [fetchedR2Logs, setFetchedR2Logs] = React.useState<string | null>(null);
  const [isFetchingR2, setIsFetchingR2] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!logs) return;
    const urlMatch = logs.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) || logs.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
    if (urlMatch) {
      const url = urlMatch[1] || urlMatch[0];
      if (url && !fetchedR2Logs && !isFetchingR2) {
        setIsFetchingR2(true);
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error(`R2 direct fetch HTTP ${res.status}`);
            return res.text();
          })
          .then(text => {
            if (text && text.trim().length > 0) {
              setFetchedR2Logs(text);
            }
          })
          .catch(async (err) => {
            console.warn('[LiveBackendStreamViewer] Direct R2 fetch failed, trying proxy:', err);
            try {
              const proxyRes = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(url)}`);
              if (proxyRes.ok) {
                const proxyText = await proxyRes.text();
                if (proxyText && proxyText.trim().length > 0) {
                  setFetchedR2Logs(proxyText);
                }
              }
            } catch (proxyErr) {
              console.warn('[LiveBackendStreamViewer] Proxy R2 log fetch failed:', proxyErr);
            }
          })
          .finally(() => setIsFetchingR2(false));
      }
    }
  }, [logs, fetchedR2Logs, isFetchingR2]);

  const effectiveLogs = fetchedR2Logs || logs || '';

  React.useEffect(() => {
    // Scroll internal log container to bottom without scrolling browser viewport
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    // Set browser viewport scroll to top (below header) when stream starts
    if (effectiveLogs && isFirstStreamRef.current) {
      isFirstStreamRef.current = false;
      const mainContainer = document.getElementById('main-scroll-container');
      if (mainContainer) {
        mainContainer.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [effectiveLogs]);

  const ERROR_PATTERN = /error|exception|failed to/i;
  const WARNING_PATTERN = /warn|quota exceeded|429|timed out|retry/i;
  // Tag chars now include spaces, hyphens, and colons — real backend tags like
  // "Vision Scout", "UnifiedLLM-Prompt", and "Database Search" have these and
  // were previously never matching at all, so they never got tabbed.
  const TAG_PATTERN = /^\[([A-Za-z0-9_ \-:]+)\](?:\[(\d+)\])?\s?(.*)$/;

  const lines = React.useMemo(() => (effectiveLogs || '').split('\n'), [effectiveLogs]);

  // Parse the [logType][timestamp] tag embedded by the client SSE parser.
  // A single logical log entry (e.g. a full system instruction) can span many
  // physical lines — only the first physical line carries the tag. Carry the
  // last-seen tag forward onto untagged continuation lines so the rest of that
  // entry is still attributed to the right tab instead of only showing in "All".
  const parsedLines = React.useMemo(() => {
    let currentLogType: string | undefined;
    let currentTimestamp: number | undefined;
    return lines.map((line) => {
      const match = line.match(TAG_PATTERN);
      if (match) {
        currentLogType = match[1];
        currentTimestamp = match[2] ? parseInt(match[2], 10) : undefined;
        return { logType: currentLogType, timestamp: currentTimestamp, display: match[3] || '' };
      }
      return { logType: currentLogType, timestamp: currentTimestamp, display: line };
    });
  }, [lines]);

  // Classify a raw logType into one of the three agent buckets used for tabs.
  // Substring-based so it recognizes both Stream 2's curated tags
  // (scout_instruction, db_search, diet_answer, ...) and Stream 1's own
  // raw tags (Vision Scout, Database Search, RouteAgent Chat, Nutrient,
  // First-Principles Injection, and any future "UnifiedLLM-Prompt:scout" /
  // "...:diet" style tags) without keeping two lists in sync.
  // Old `dietitian*` tags (Supabase history) classify into the same bucket.
  const classifyLogType = (logType?: string): 'scout' | 'db' | 'resolver' | 'diet' | 'other' => {
    if (!logType) return 'other';
    const t = logType.toLowerCase();
    if (t.includes('scout') || t.includes('vision')) return 'scout';
    if (t.includes('db_') || t.includes('database') || t.includes('usda') || t.includes('openfoodfacts')) return 'db';
    if (t.includes('resolver') || t.includes('food_resolver')) return 'resolver';
    if (t.includes('dietitian') || t === 'diet' || t.includes('diet_') || t.includes('routeagent') || t.includes('nutrient') || t.includes('first-principles') || t.includes('first_principles')) return 'diet';
    return 'other';
  };

  const dynamicTabs = React.useMemo(() => {
    const tabs = [{ id: 'all', label: 'All' }];
    const hasScout = parsedLines.some((l) => classifyLogType(l.logType) === 'scout');
    const hasDb = parsedLines.some((l) => classifyLogType(l.logType) === 'db');
    const hasResolver = parsedLines.some((l) => classifyLogType(l.logType) === 'resolver');
    const hasDiet = parsedLines.some((l) => classifyLogType(l.logType) === 'diet');
    const hasErrors = parsedLines.some((l) => ERROR_PATTERN.test(l.display));
    const hasWarnings = parsedLines.some((l) => WARNING_PATTERN.test(l.display));
    if (hasScout) tabs.push({ id: 'scout', label: 'Vision Scout' });
    if (hasDb) tabs.push({ id: 'db', label: 'DB Search' });
    if (hasResolver) tabs.push({ id: 'resolver', label: 'Food Resolver' });
    if (hasDiet) tabs.push({ id: 'diet', label: 'Diet' });
    if (hasErrors) tabs.push({ id: 'errors', label: 'Errors' });
    if (hasWarnings) tabs.push({ id: 'warnings', label: 'Warnings' });

    return tabs;
  }, [parsedLines]);

  // Tab filtering — matches on the classified agent bucket so every line
  // belonging to a stage is captured, not just ones containing a keyword.
  const tabFilteredDisplayLines = React.useMemo(() => {
    const filtered = parsedLines.filter((l) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'scout') return classifyLogType(l.logType) === 'scout';
      if (activeTab === 'db') return classifyLogType(l.logType) === 'db';
      if (activeTab === 'diet') return classifyLogType(l.logType) === 'diet';
      if (activeTab === 'errors') return ERROR_PATTERN.test(l.display);
      if (activeTab === 'warnings') return WARNING_PATTERN.test(l.display);
      return true;
    });
    return filtered.map((l) => l.display);
  }, [parsedLines, activeTab]);

  // Total elapsed time across the visible stream (earliest to latest timestamp).
  const elapsedLabel = React.useMemo(() => {
    const timestamps = parsedLines.map((l) => l.timestamp).filter((t): t is number => typeof t === 'number');
    if (timestamps.length < 2) return null;
    const elapsedMs = Math.max(...timestamps) - Math.min(...timestamps);
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  }, [parsedLines]);

  // Keyword search matching line indices
  const matchingLineIndices = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    const indices: number[] = [];
    tabFilteredDisplayLines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) {
        indices.push(idx);
      }
    });
    return indices;
  }, [tabFilteredDisplayLines, searchQuery]);

  React.useEffect(() => {
    if (matchingLineIndices.length > 0 && matchRefs.current[currentMatchIndex]) {
      matchRefs.current[currentMatchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentMatchIndex, matchingLineIndices]);

  React.useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, activeTab]);

  const handleNextMatch = () => {
    if (matchingLineIndices.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matchingLineIndices.length);
  };

  const handlePrevMatch = () => {
    if (matchingLineIndices.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + matchingLineIndices.length) % matchingLineIndices.length);
  };

  const handleCopy = () => {
    const textToCopy = tabFilteredDisplayLines.join('\n');
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    try {
      const textToDownload = tabFilteredDisplayLines.join('\n');
      const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const tabName = activeTab === 'all' ? 'all' : activeTab;
      const timeStr = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
      a.download = `logs-${tabName}-${timeStr}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download logs failed:', err);
    }
  };

  const renderHighlightedLine = (line: string, lineIndex: number) => {
    if (!searchQuery.trim() || !line.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
      return <span>{line}</span>;
    }

    const q = searchQuery.trim();
    const parts = line.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    const isCurrentMatch = matchingLineIndices[currentMatchIndex] === lineIndex;

    return (
      <span
        ref={(el) => {
          if (matchingLineIndices.includes(lineIndex)) {
            const matchPos = matchingLineIndices.indexOf(lineIndex);
            matchRefs.current[matchPos] = el;
          }
        }}
      >
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark
              key={i}
              className={`px-0.5 rounded font-bold ${
                isCurrentMatch ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300' : 'bg-yellow-500/40 text-yellow-200'
              }`}
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div className="p-2.5 bg-slate-950 text-white font-mono text-[10px] rounded-xl border border-slate-700 shadow-inner flex flex-col gap-2">
      {/* Toolbar Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800 text-[10px]">
        {/* Dynamic Agent Tabs */}
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 flex-wrap">
          {dynamicTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-0.5 rounded-md text-[9px] font-semibold transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-slate-700/60 text-white border border-slate-500'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {elapsedLabel && (
            <span className="ml-1 px-2 py-0.5 text-[9px] text-slate-400 font-mono whitespace-nowrap">
              Total: {elapsedLabel}
            </span>
          )}
        </div>

        {/* Search Controls + Navigation + Copy */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) handlePrevMatch(); else handleNextMatch();
                }
              }}
              className="bg-slate-900 border border-slate-800 text-slate-200 px-2 py-0.5 rounded-md text-[9px] focus:outline-none focus:border-slate-500/50 w-28 sm:w-36"
            />
            {searchQuery.trim() && (
              <span className="text-[8px] text-slate-400 ml-1 whitespace-nowrap font-mono">
                {matchingLineIndices.length > 0
                  ? `${currentMatchIndex + 1}/${matchingLineIndices.length}`
                  : '0/0'}
              </span>
            )}
          </div>

          {searchQuery.trim() && matchingLineIndices.length > 0 && (
            <div className="flex items-center gap-0.5 bg-slate-900 rounded border border-slate-800">
              <button
                type="button"
                onClick={handlePrevMatch}
                className="px-1.5 py-0.5 text-slate-300 hover:text-white text-[9px] cursor-pointer"
                title="Previous match"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                className="px-1.5 py-0.5 text-slate-300 hover:text-white text-[9px] cursor-pointer"
                title="Next match"
              >
                ▼
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[9px] border border-slate-700 transition-colors cursor-pointer"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[9px] border border-slate-700 transition-colors cursor-pointer"
            title="Download logs"
          >
            <Download className="w-2.5 h-2.5 text-slate-300" />
            Download
          </button>
        </div>
      </div>

      {/* Log Output Body */}
      <div ref={scrollContainerRef} className="max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed flex flex-col gap-0.5">
        {tabFilteredDisplayLines.length > 0 ? (
          tabFilteredDisplayLines.map((line, idx) => (
            <div key={idx}>{renderHighlightedLine(line, idx)}</div>
          ))
        ) : (
          <span className="text-slate-600 italic">No matching logs found.</span>
        )}
      </div>
    </div>
  );
};

export const AgentThoughtBox = ({
  language = "en",
  scoutScratchpad,
  dietScratchpad,
  dietitianScratchpad: dietitianScratchpadLegacy,
  isLive,
  placeholderStep,
  hasImage,
  scoutInstruction,
  scoutAnswer,
  dbSearchLog,
  dietInstruction,
  dietitianInstruction: dietitianInstructionLegacy,
  dietAnswer,
  dietitianAnswer: dietitianAnswerLegacy,
  activeStage,
  stageStatus,
  backendLogs,
  globalLiveLogs,
  warnings
}: {
  scoutScratchpad?: string,
  dietScratchpad?: string,
  dietitianScratchpad?: string,
  isLive?: boolean,
  placeholderStep?: string,
  hasImage?: boolean,
  scoutInstruction?: string,
  scoutAnswer?: string,
  dbSearchLog?: string,
  dietInstruction?: string,
  dietitianInstruction?: string,
  dietAnswer?: string,
  dietitianAnswer?: string,
  activeStage?: string,
  stageStatus?: string;
  language?: string;
  backendLogs?: string;
  globalLiveLogs?: string;
  warnings?: string[];
}) => {
  // Dual-accept: new `diet*` props win, legacy `dietitian*` props (stored history) fall back.
  const dietitianScratchpad = dietScratchpad ?? dietitianScratchpadLegacy;
  const dietitianInstruction = dietInstruction ?? dietitianInstructionLegacy;
  const dietitianAnswer = dietAnswer ?? dietitianAnswerLegacy;
  const t = translations[language || "en"] || translations.en;
  const [isExpanded, setIsExpanded] = React.useState(!!isLive);

  React.useEffect(() => {
    setIsExpanded(!!isLive);
  }, [isLive]);

  const hasScratchpad = !!scoutScratchpad || !!dietitianScratchpad || !!activeStage || !!backendLogs || !!globalLiveLogs;
  if (!hasScratchpad && !placeholderStep && !isLive && (!warnings || warnings.length === 0)) return null;

  const isImageAnalysis = hasImage ?? (!!scoutScratchpad || (placeholderStep && placeholderStep.toLowerCase().includes("photo")));

  // Derive step states
  let step1Status: 'completed' | 'active' | 'pending' = 'pending';
  let step2Status: 'completed' | 'active' | 'pending' = 'pending';
  let step3Status: 'completed' | 'active' | 'pending' = 'pending';
  let step4Status: 'completed' | 'active' | 'pending' = 'pending';

  if (!isLive) {
    step1Status = 'completed';
    step2Status = 'completed';
    step3Status = 'completed';
    step4Status = 'completed';
  } else {
    const currentStage = activeStage || (dietitianScratchpad ? 'diet' : (dbSearchLog && dbSearchLog.includes('[Database Search]')) ? 'db_search' : 'scout');
    if (isImageAnalysis) {
      if (currentStage === 'scout') {
        step1Status = stageStatus === 'completed' ? 'completed' : 'active';
        step2Status = 'pending';
        step3Status = 'pending';
        step4Status = 'pending';
      } else if (currentStage === 'db_search') {
        step1Status = 'completed'; // 🟢 Step 1 Completed
        step2Status = 'active';    // 🔵 Step 2 Active
        step3Status = 'pending';
        step4Status = 'pending';
      } else if (currentStage === 'dietitian' || currentStage === 'finalize') {
        step1Status = 'completed';
        step2Status = 'completed';
        step3Status = 'completed';
        step4Status = 'active';
      }
    } else {
      if (currentStage === 'db_search') {
        step1Status = 'completed';
        step2Status = 'active';
        step3Status = 'pending';
        step4Status = 'pending';
      } else if (currentStage === 'dietitian' || currentStage === 'finalize') {
        step1Status = 'completed';
        step2Status = 'completed';
        step3Status = 'completed';
        step4Status = 'active';
      }
    }
  }

  return (
    <div className="px-1 py-2 my-2 min-w-[250px] bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl p-3 border border-slate-150 dark:border-slate-800/40 font-sans transition-all">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-theme-neutral flex items-center justify-between font-medium hover:text-indigo-600 transition-colors w-full focus:outline-none cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">{t.agentsThought}</span>
          </span>
          {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </button>
        {isExpanded && (
          <div className="flex flex-col gap-3 mt-2.5 pt-2 border-t border-slate-200/50 dark:border-slate-800/50 text-left">
            {warnings && warnings.length > 0 && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs font-bold text-yellow-800 mb-1">⚠️ Nutrient Warnings</p>
                <ul className="list-disc pl-4 text-xs text-yellow-700">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {/* STREAM 1: RAW UNFILTERED LIVE STREAM — same LiveBackendStreamViewer component as Stream 2, fed globalLiveLogs instead of backendLogs */}
            {globalLiveLogs && (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-green-500/80 uppercase tracking-wider px-0.5">⚡ Unfiltered Live Stream</span>
                <LiveBackendStreamViewer logs={globalLiveLogs} />
              </div>
            )}
            {/* STREAM 2: LIVE BACKEND STREAM VIEWER WITH TOOLBAR, TABS & COPY.
                Only shown when Stream 1's unfiltered view isn't available (e.g.
                its SSE connection failed to establish) — otherwise it's a
                strictly worse duplicate of what's already shown above. */}
            {!hasScratchpad && isLive ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                <span>{t.startingAnalysis}</span>
              </div>
            ) : backendLogs && !globalLiveLogs ? (
              <LiveBackendStreamViewer logs={backendLogs} />
            ) : isImageAnalysis ? (
              <>
                {/* Render live streaming progress chunks cleanly without generic titles */}
                {scoutInstruction && (
                  <div className="flex flex-col gap-1 mt-1 mb-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.visionScoutInstruction}</span>
                    <ScratchpadMarkdownViewer content={scoutInstruction} />
                  </div>
                )}
                {scoutScratchpad && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.visionScoutScratchpad}</span>
                    <ScratchpadMarkdownViewer content={scoutScratchpad} />
                  </div>
                )}
                {scoutAnswer && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.visionScoutResult}</span>
                    <ScratchpadMarkdownViewer content={scoutAnswer} />
                  </div>
                )}

                {dbSearchLog && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.databaseLog}</span>
                    <ScratchpadMarkdownViewer content={dbSearchLog} />
                  </div>
                )}

                {dietitianInstruction && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietInstruction}</span>
                    <ScratchpadMarkdownViewer content={dietitianInstruction} />
                  </div>
                )}

                {dietitianScratchpad && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietScratchpad}</span>
                    <ScratchpadMarkdownViewer content={dietitianScratchpad} />
                  </div>
                )}
                {dietitianAnswer && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianResult}</span>
                    <ScratchpadMarkdownViewer content={dietitianAnswer} />
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Render live streaming progress chunks cleanly without generic titles */}
                {dietitianInstruction && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietInstruction}</span>
                    <ScratchpadMarkdownViewer content={dietitianInstruction} />
                  </div>
                )}
                {dietitianScratchpad && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietScratchpad}</span>
                    <ScratchpadMarkdownViewer content={dietitianScratchpad} />
                  </div>
                )}
                {dietitianAnswer && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianResult}</span>
                    <ScratchpadMarkdownViewer content={dietitianAnswer} />
                  </div>
                )}
              </>
            )}

          </div>
        )}
      </div>
    </div>
  );
};
