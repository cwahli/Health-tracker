// @ts-nocheck
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Send, Check, AlertTriangle, Search, ChevronDown, ChevronUp, Trash2, Download, Loader } from 'lucide-react';
import { getAgentRequestLogs, deleteAgentRequestLog, AgentRequestLog } from '../utils/agentLogsTracker';
import { translations } from '../utils/translations';

interface FullScreenLogViewerProps {
  language?: string;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  logsText: string;
  logsArray?: string[];
  onSendToAdmin?: () => Promise<void>;
  isSendingLogs?: boolean;
  logsSendStatus?: 'idle' | 'success' | 'error';
  onClearLogs?: () => void;
  eventsCount?: number;
  conversationsList?: { id: string; title: string }[];
  activeConversationId?: string;
  showFilters?: boolean;
}

interface AgentDef {
  id: string;
  name: string;
  test: (lower: string) => boolean;
}

const ALL_AGENT_DEFS: AgentDef[] = [
  {
    id: 'front_desk',
    name: 'Front Desk',
    test: (l) => l.includes('agenttype: front_desk') || l.includes('agenttype:front_desk') || l.includes('[frontdesk') || l.includes('front-desk') || l.includes('health preparation agent')
  },
  {
    id: 'agent1',
    name: 'Lab Parser',
    test: (l) => l.includes('agenttype: agent1') || l.includes('agenttype:agent1') || l.includes('standardize units agent') || l.includes('clinical calibration agent') || l.includes('[agent1]')
  },
  {
    id: 'data_review',
    name: 'Range Calibrator',
    test: (l) => l.includes('agenttype: data_review') || l.includes('agenttype:data_review') || l.includes('data accuracy agent') || l.includes('clinical data accuracy agent') || l.includes('[data_review]')
  },
  {
    id: 'health_baseline',
    name: 'Health Coach',
    test: (l) => l.includes('agenttype: health_baseline') || l.includes('agenttype:health_baseline') || l.includes('health baseline') || l.includes('[health_baseline]')
  },
  {
    id: 'agent7',
    name: 'Literature',
    test: (l) => l.includes('agenttype: agent7') || l.includes('agenttype:agent7') || l.includes('health report agent') || l.includes('medical insights') || l.includes('[agent7]')
  },
  {
    id: 'db_search',
    name: 'Database Search & Resolution',
    test: (l) => l.includes('querying usda') || l.includes('openfoodfacts') || l.includes('[database search]') || l.includes('[component resolution diagnostic]') || l.includes('database search')
  },
  {
    id: 'scout',
    name: 'Visual Food Scout',
    test: (l) => l.includes('scout') || l.includes('vision scout') || l.includes('image payload')
  },
  {
    id: 'medical_extract',
    name: 'Lab Parser',
    test: (l) => l.includes('agenttype: medical_extract') || l.includes('agenttype:medical_extract') || l.includes('clinical data parser') || l.includes('[medical_extract]')
  },
  {
    id: 'agent2',
    name: 'Categoriser',
    test: (l) => l.includes('agenttype: agent2') || l.includes('agenttype:agent2') || l.includes('clinical assessment agent') || l.includes('medical categorisation agent') || l.includes('[agent2]')
  },
  {
    id: 'agent3',
    name: 'Name Deduper',
    test: (l) => l.includes('agenttype: agent3') || l.includes('agenttype:agent3') || l.includes('clinical harmonization agent') || l.includes('name consolidation agent') || l.includes('[agent3]')
  },
  {
    id: 'agent4',
    name: 'Test Planner',
    test: (l) => l.includes('agenttype: agent4') || l.includes('agenttype:agent4') || l.includes('health planning agent') || l.includes('diagnostic agent (agent4)') || l.includes('biomarker synthesis agent') || l.includes('[agent4]')
  },
  {
    id: 'agent5',
    name: 'Range Calibrator',
    test: (l) => l.includes('agenttype: agent5') || l.includes('agenttype:agent5') || l.includes('holistic review agent') || l.includes('[agent5]')
  },
  {
    id: 'food_idea',
    name: 'Culinary Ideation Agent',
    test: (l) => l.includes('agenttype: food_idea') || l.includes('agenttype:food_idea') || l.includes('culinary ideation agent') || l.includes('[food_idea]')
  },
  {
    id: 'daily_recommendation',
    name: 'Daily Actions Agent',
    test: (l) => l.includes('agenttype: daily_recommendation') || l.includes('agenttype:daily_recommendation') || l.includes('daily actions agent') || l.includes('[daily_recommendation]')
  },
  {
    id: 'medical',
    name: 'Medical Diagnostics Agent',
    test: (l) => l.includes('agenttype: medical') || l.includes('agenttype:medical') || l.includes('medical diagnostics agent') || l.includes('[medical]')
  },
  {
    id: 'food_resolver',
    name: 'Food Resolver Agent',
    test: (l) =>
      l.includes('food_resolver') ||
      l.includes('[food resolver') ||
      l.includes('food resolver agent') ||
      l.includes('unifiedllm:food_resolver') ||
      l.includes('unifiedllm-prompt:food_resolver') ||
      l.includes('unifiedllm-response:food_resolver')
  },
  {
    id: 'food',
    name: 'Diet',
    test: (l) => (l.includes('agenttype: food') || l.includes('agenttype:food') || l.includes('meal agent') || l.includes('clinical dietitian ai') || l.includes('food & nutrition agent') || l.includes('[food_analysis]') || l.includes('food analyze agent') || l.includes('dietitian') || l.includes('diet_answer') || l.includes('diet_instruction')) && !l.includes('food_resolver')
  }
];

export const AGENT_COLOR_MAP: Record<string, {
  textColor: string;
  borderColor: string;
  bgBadge: string;
  dotColor: string;
  name: string;
}> = {
  food_resolver: {
    textColor: 'text-orange-300 dark:text-orange-300',
    borderColor: 'border-orange-500/40',
    bgBadge: 'bg-orange-950/70 text-orange-300 border-orange-500/40',
    dotColor: 'bg-orange-400',
    name: 'Food Resolver Agent'
  },
  food_resolver_ai: {
    textColor: 'text-orange-300 dark:text-orange-300',
    borderColor: 'border-orange-500/40',
    bgBadge: 'bg-orange-950/70 text-orange-300 border-orange-500/40',
    dotColor: 'bg-orange-400',
    name: 'Food Resolver Agent'
  },
  front_desk: {
    textColor: 'text-sky-300 dark:text-sky-300',
    borderColor: 'border-sky-500/40',
    bgBadge: 'bg-sky-950/70 text-sky-300 border-sky-500/40',
    dotColor: 'bg-sky-400',
    name: 'Health Preparation Agent'
  },
  agent1: {
    textColor: 'text-amber-300 dark:text-amber-300',
    borderColor: 'border-amber-500/40',
    bgBadge: 'bg-amber-950/70 text-amber-300 border-amber-500/40',
    dotColor: 'bg-amber-400',
    name: 'Lab Parser'
  },
  data_review: {
    textColor: 'text-emerald-300 dark:text-emerald-300',
    borderColor: 'border-emerald-500/40',
    bgBadge: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40',
    dotColor: 'bg-emerald-400',
    name: 'Data Accuracy Agent'
  },
  health_baseline: {
    textColor: 'text-teal-300 dark:text-teal-300',
    borderColor: 'border-teal-500/40',
    bgBadge: 'bg-teal-950/70 text-teal-300 border-teal-500/40',
    dotColor: 'bg-teal-400',
    name: 'Health Coach'
  },
  agent7: {
    textColor: 'text-violet-300 dark:text-violet-300',
    borderColor: 'border-violet-500/40',
    bgBadge: 'bg-violet-950/70 text-violet-300 border-violet-500/40',
    dotColor: 'bg-violet-400',
    name: 'Health Report Agent'
  },
  db_search: {
    textColor: 'text-rose-300 dark:text-rose-300',
    borderColor: 'border-rose-500/40',
    bgBadge: 'bg-rose-950/70 text-rose-300 border-rose-500/40',
    dotColor: 'bg-rose-400',
    name: 'Database Search & Resolution'
  },
  scout: {
    textColor: 'text-pink-300 dark:text-pink-300',
    borderColor: 'border-pink-500/40',
    bgBadge: 'bg-pink-950/70 text-pink-300 border-pink-500/40',
    dotColor: 'bg-pink-400',
    name: 'Visual Food Scout'
  },
  medical_extract: {
    textColor: 'text-indigo-300 dark:text-indigo-300',
    borderColor: 'border-indigo-500/40',
    bgBadge: 'bg-indigo-950/70 text-indigo-300 border-indigo-500/40',
    dotColor: 'bg-indigo-400',
    name: 'Lab Parser'
  },
  agent2: {
    textColor: 'text-blue-300 dark:text-blue-300',
    borderColor: 'border-blue-500/40',
    bgBadge: 'bg-blue-950/70 text-blue-300 border-blue-500/40',
    dotColor: 'bg-blue-400',
    name: 'Categoriser'
  },
  agent3: {
    textColor: 'text-purple-300 dark:text-purple-300',
    borderColor: 'border-purple-500/40',
    bgBadge: 'bg-purple-950/70 text-purple-300 border-purple-500/40',
    dotColor: 'bg-purple-400',
    name: 'Name Deduper'
  },
  agent4: {
    textColor: 'text-yellow-300 dark:text-yellow-300',
    borderColor: 'border-yellow-500/40',
    bgBadge: 'bg-yellow-950/70 text-yellow-300 border-yellow-500/40',
    dotColor: 'bg-yellow-400',
    name: 'Health Planning Agent'
  },
  agent5: {
    textColor: 'text-lime-300 dark:text-lime-300',
    borderColor: 'border-lime-500/40',
    bgBadge: 'bg-lime-950/70 text-lime-300 border-lime-500/40',
    dotColor: 'bg-lime-400',
    name: 'Holistic Review Agent'
  },
  food_idea: {
    textColor: 'text-orange-300 dark:text-orange-300',
    borderColor: 'border-orange-500/40',
    bgBadge: 'bg-orange-950/70 text-orange-300 border-orange-500/40',
    dotColor: 'bg-orange-400',
    name: 'Culinary Ideation Agent'
  },
  daily_recommendation: {
    textColor: 'text-green-300 dark:text-green-300',
    borderColor: 'border-green-500/40',
    bgBadge: 'bg-green-950/70 text-green-300 border-green-500/40',
    dotColor: 'bg-green-400',
    name: 'Daily Actions Agent'
  },
  medical: {
    textColor: 'text-cyan-300 dark:text-cyan-300',
    borderColor: 'border-cyan-500/40',
    bgBadge: 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40',
    dotColor: 'bg-cyan-400',
    name: 'Medical Diagnostics Agent'
  },
  food: {
    textColor: 'text-red-300 dark:text-red-300',
    borderColor: 'border-red-500/40',
    bgBadge: 'bg-red-950/70 text-red-300 border-red-500/40',
    dotColor: 'bg-red-400',
    name: 'Clinical Diet AI'
  },
  scout_ai: {
    textColor: 'text-pink-300 dark:text-pink-300',
    borderColor: 'border-pink-500/40',
    bgBadge: 'bg-pink-950/70 text-pink-300 border-pink-500/40',
    dotColor: 'bg-pink-400',
    name: 'Scout AI'
  },
  diet_ai: {
    textColor: 'text-red-300 dark:text-red-300',
    borderColor: 'border-red-500/40',
    bgBadge: 'bg-red-950/70 text-red-300 border-red-500/40',
    dotColor: 'bg-red-400',
    name: 'Diet'
  },
  medical_ai: {
    textColor: 'text-cyan-300 dark:text-cyan-300',
    borderColor: 'border-cyan-500/40',
    bgBadge: 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40',
    dotColor: 'bg-cyan-400',
    name: 'Medical AI'
  },
  database: {
    textColor: 'text-rose-300 dark:text-rose-300',
    borderColor: 'border-rose-500/40',
    bgBadge: 'bg-rose-950/70 text-rose-300 border-rose-500/40',
    dotColor: 'bg-rose-400',
    name: 'Database & Extraction'
  },
  bug_snapshot: {
    textColor: 'text-purple-300 dark:text-purple-300',
    borderColor: 'border-purple-500/40',
    bgBadge: 'bg-purple-950/70 text-purple-300 border-purple-500/40',
    dotColor: 'bg-purple-400',
    name: 'Bug Snapshot & Triage'
  },
  system: {
    textColor: 'text-slate-300 dark:text-slate-300',
    borderColor: 'border-slate-700/40',
    bgBadge: 'bg-slate-900/70 text-slate-300 border-slate-700/40',
    dotColor: 'bg-slate-400',
    name: 'System'
  },
  health_coach: {
    textColor: "text-amber-300 dark:text-amber-300",
    borderColor: "border-amber-500/40",
    bgBadge: "bg-amber-950/70 text-amber-300 border-amber-500/40",
    dotColor: "bg-amber-400",
    name: "Health Coach"
  },
  error: {
    textColor: 'text-rose-400 dark:text-rose-400',
    borderColor: 'border-rose-600/40',
    bgBadge: 'bg-rose-950/80 text-rose-400 border-rose-600/40',
    dotColor: 'bg-rose-500',
    name: 'Errors & Timeouts'
  },
  other: {
    textColor: 'text-slate-300 dark:text-slate-300',
    borderColor: 'border-slate-700/40',
    bgBadge: 'bg-slate-900/70 text-slate-300 border-slate-700/40',
    dotColor: 'bg-slate-400',
    name: 'System Logs'
  }
};

export function getChunkAgentId(chunk: string): string {
  if (!chunk) return 'system';
  const lower = chunk.toLowerCase();

  if (
    lower.includes('[bugsnapshot]') ||
    lower.includes('[bugtriage]') ||
    lower.includes('[bug_snapshot]') ||
    lower.includes('[bug_triage]')
  ) {
    return 'bug_snapshot';
  }

  if (
    lower.includes('food_resolver') ||
    lower.includes('food resolver') ||
    lower.includes('unifiedllm:food_resolver') ||
    lower.includes('unifiedllm-prompt:food_resolver') ||
    lower.includes('unifiedllm-response:food_resolver')
  ) {
    return 'food_resolver_ai';
  }

  const dynamicMatch = chunk.match(/^\s*\[([^\]]+)\]/);
  if (dynamicMatch) {
     let tag = dynamicMatch[1].trim().toLowerCase();
     if (tag.includes(':')) tag = tag.split(':').pop()?.trim() || tag;
     if (tag.includes('_instruction')) tag = tag.split('_instruction')[0].trim();
     if (tag.includes('_answer')) tag = tag.split('_answer')[0].trim();

     if (tag.includes('bugsnapshot') || tag.includes('bug_snapshot') || tag.includes('bugtriage') || tag.includes('bug_triage')) return 'bug_snapshot';
     if (tag.includes('error') || tag.includes('fail') || tag.includes('timeout')) return 'error';
     if (tag.includes('food_resolver')) return 'food_resolver_ai';
     if (tag.includes('scout') || tag.includes('vision')) return 'scout_ai';
     if ((tag.includes('dietitian') || tag.includes('diet_answer') || tag.includes('diet_instruction') || tag.includes('food')) && !tag.includes('food_resolver')) return 'diet_ai';
     if (tag.includes('health_coach') || tag.includes('health coach')) return 'health_coach';
     if (tag.includes('medical') || tag.includes('biomarker')) return 'medical_ai';
     if (tag.includes('db_') || tag.includes('database') || tag.includes('nutrient') || tag.includes('conversion') || tag.includes('extraction') || tag.includes('multiplier')) return 'database';
     if (tag.includes('system') || tag.includes('status') || tag.includes('state') || tag.includes('payload') || tag.includes('context') || tag.includes('routing') || tag.includes('deduplication')) return 'system';
  }

  if (lower.includes('error:') || lower.includes('failed to') || lower.includes('timeout')) return 'error';
  if ((lower.includes('scout') || lower.includes('vision scout')) && !lower.includes('food_resolver')) return 'scout_ai';
  if ((lower.includes('dietitian') || lower.includes('diet_answer') || lower.includes('diet_instruction') || lower.includes('food')) && !lower.includes('food_resolver')) return 'diet_ai';
  if (lower.includes('health_coach') || lower.includes('health coach')) return 'health_coach';
  if (lower.includes('medical') || lower.includes('biomarker')) return 'medical_ai';
  if (lower.includes('db_') || lower.includes('database search') || lower.includes('nutrient')) return 'database';
  if (lower.includes('system') || lower.includes('status')) return 'system';

  return 'system';
}

function tryFormatJsonString(str: string): string | null {
  if (!str) return null;
  let trimmed = str.trim();

  // Strip trailing truncation marker if present
  let truncationNote = '';
  const truncIdx = trimmed.indexOf('\n... [truncated');
  if (truncIdx !== -1) {
    truncationNote = trimmed.slice(truncIdx).trim();
    trimmed = trimmed.slice(0, truncIdx).trim();
  }

  // Check if it looks like JSON (starts with { or [)
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  // Ignore bracketed timestamps or tag headers like [11:27:53] or [Medical Analyze Agent] or [UnifiedLLM]
  if (/^\[\d{1,2}:\d{2}/.test(trimmed) || /^\[[A-Za-z0-9_\s-]+\](?!\s*[:{\[\"\d])/.test(trimmed)) {
    return null;
  }

  // Try direct JSON.parse
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string' && item.length < 30 && !item.includes('{'))) {
        return null;
      }
      const pretty = JSON.stringify(parsed, null, 2);
      return truncationNote ? `${pretty}\n\n${truncationNote}` : pretty;
    }
  } catch (e) {
    // Attempt repair for truncated JSON
  }

  // Only attempt repair if it starts with { and contains key-value colon patterns
  if (!trimmed.startsWith('{') || !trimmed.includes(':')) {
    return null;
  }

  try {
    let repaired = trimmed;
    let inString = false;
    let escape = false;
    const stack: string[] = [];

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{' || char === '[') {
          stack.push(char);
        } else if (char === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop();
        } else if (char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop();
        }
      }
    }

    if (inString) {
      repaired += '"';
    }

    repaired = repaired.trim().replace(/,\s*$/, '');

    while (stack.length > 0) {
      const top = stack.pop();
      if (top === '{') repaired += '}';
      else if (top === '[') repaired += ']';
    }

    const parsed = JSON.parse(repaired);
    if (typeof parsed === 'object' && parsed !== null) {
      const pretty = JSON.stringify(parsed, null, 2);
      return truncationNote ? `${pretty}\n\n${truncationNote}` : pretty;
    }
  } catch (e) {
    return null;
  }

  return null;
}

function FormattedLogChunk({
  chunk,
  searchTerm,
  highlightText,
  agentId = 'other'
}: {
  chunk: string;
  searchTerm: string;
  highlightText: (text: string, highlight: string) => React.ReactNode;
  agentId?: string;
}) {
  const agentStyle = AGENT_COLOR_MAP[agentId] || AGENT_COLOR_MAP['other'];
  const agentPrefix = agentId === 'scout_ai' ? 'scout' : agentId === 'diet_ai' ? 'diet' : agentId === 'medical_ai' ? 'medical' : 'agent';

  const lowerChunk = chunk.toLowerCase();
  const isInstructionChunk = lowerChunk.includes('dispatched system instruction') || lowerChunk.includes('[scout_instruction]') || lowerChunk.includes('[dietitian_instruction]') || lowerChunk.includes('[diet_instruction]');
  const isResponseChunk = lowerChunk.includes('[unifiedllm-response:') || lowerChunk.includes('[scout_answer]') || lowerChunk.includes('[dietitian_answer]') || lowerChunk.includes('[diet_answer]') || lowerChunk.includes('complete response returned from agent');

  // Point 4: Strip out the [UnifiedLLM] Successfully completed content generation... lines so they don't render visually
  const cleanedChunk = chunk.split('\n')
    .filter(line => !line.includes('[UnifiedLLM] Successfully completed content generation'))
    .join('\n');

  // Pad bracketed tags to 20 characters for perfect vertical alignment
  const alignedChunk = cleanedChunk.split('\n').map(line => {
    return line.replace(/^\[([^\]]+)\]\s*/, (match, tag) => {
      const paddedTag = `[${tag}]`.padEnd(20, ' ');
      return `${paddedTag} `;
    });
  }).join('\n');

  const lines = alignedChunk.split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lowerLine = line.toLowerCase();

    // Check if it's a bracketed header line, e.g. [scout_instruction]
    const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length < 50;
    if (isHeader) {
      // Create a URL-safe ID matching the pill logic (e.g., 'scout-instruction')
      const anchorId = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      elements.push(
        <div key={`header-${i}`} id={anchorId} className="mt-4 mb-2 text-[10px] font-bold text-rose-400/80 uppercase tracking-widest border-b border-rose-900/30 pb-1 scroll-mt-24">
          {highlightText(trimmed, searchTerm)}
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div key={`code-${i}`} className={`my-1.5 p-2 bg-slate-950/80 rounded border ${agentStyle.borderColor} overflow-x-auto text-[11px] font-mono leading-relaxed text-slate-300`}>
            {highlightText(codeBuffer.join('\n'), searchTerm)}
          </div>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Section XML tags
    if (/^<[A-Z0-9_]+>$/i.test(trimmed) || /^<\/[A-Z0-9_]+>$/i.test(trimmed)) {
      const isClose = trimmed.startsWith('</');
      const tagName = trimmed.replace(/[<>/]/g, '');

      let injectedAnchor: React.ReactNode = null;
      let sectionId = '';
      if (!isClose) {
        if (tagName.toLowerCase() === 'instruction' || tagName.toLowerCase() === '_instruction') {
          injectedAnchor = <span id={`${agentPrefix}-sec-instruction`} className="scroll-mt-24" />;
          sectionId = `${agentId}-sec-instruction`;
        } else if (tagName.toLowerCase() === '_internalreasoning' || tagName.toLowerCase() === 'scratchpad') {
          injectedAnchor = <span id={`${agentPrefix}-sec-thought`} className="scroll-mt-24" />;
          sectionId = `${agentId}-sec-thought`;
        } else if (tagName.toLowerCase() === '_answer' || tagName.toLowerCase() === '_response') {
          injectedAnchor = <span id={`${agentPrefix}-sec-response`} className="scroll-mt-24" />;
          sectionId = `${agentId}-sec-response`;
        }
      }

      elements.push(
        <div key={`tag-${i}`} id={sectionId || undefined} className={`my-1 flex items-center gap-2 font-mono font-bold text-[10px] tracking-wider uppercase relative scroll-mt-6 ${isClose ? 'text-slate-500' : agentStyle.textColor}`}>
          {injectedAnchor}
          <span>{isClose ? `--- END ${tagName} ---` : `--- SECTION: ${tagName} ---`}</span>
        </div>
      );
      continue;
    }

    // Check for "Label: {" or "Label: ["
    const labelJsonMatch = line.match(/^([A-Za-z0-9\s_():\[\]-]+):\s*([{\[].*)$/);
    if (labelJsonMatch) {
      const label = labelJsonMatch[1];
      const jsonStr = labelJsonMatch[2];
      const prettyJson = tryFormatJsonString(jsonStr);
      if (prettyJson) {
        let injectedAnchor: React.ReactNode = null;
        let sectionId = '';
        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes('instruction') || lowerLabel.includes('prompt')) {
          if (isInstructionChunk) {
            injectedAnchor = <span id={`${agentPrefix}-sec-instruction`} className="scroll-mt-24" />;
            sectionId = `${agentId}-sec-instruction`;
          }
        } else if ((lowerLabel.includes('scratchpad') || lowerLabel.includes('_internalreasoning') || lowerLabel.includes('thought')) && !prettyJson.includes('"string"') && !prettyJson.includes('step 1: list all visible items')) {
          if (isResponseChunk) {
            injectedAnchor = <span id={`${agentPrefix}-sec-thought`} className="scroll-mt-24" />;
            sectionId = `${agentId}-sec-thought`;
          }
        } else if (lowerLabel.includes('_answer') || lowerLabel.includes('_response') || lowerLabel.includes('response')) {
          if (isResponseChunk) {
            injectedAnchor = <span id={`${agentPrefix}-sec-response`} className="scroll-mt-24" />;
            sectionId = `${agentId}-sec-response`;
          }
        }

        elements.push(
          <div key={`json-lbl-${i}`} id={sectionId || undefined} className="my-1 pl-2 relative scroll-mt-6">
            {injectedAnchor}
            <span className={`font-bold text-[11px] font-mono ${agentStyle.textColor}`}>{highlightText(label, searchTerm)}:</span>
            <div className="font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre font-normal pt-1 max-h-[450px] overflow-y-auto">
              {highlightText(prettyJson, searchTerm)}
            </div>
          </div>
        );
        continue;
      }
    }

    // Standalone or inline JSON (starts with { or [)
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const prettyJson = tryFormatJsonString(trimmed);
      if (prettyJson) {
        elements.push(
          <div key={`json-standalone-${i}`} className="my-1 pl-2 font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre font-normal max-h-[450px] overflow-y-auto">
            {highlightText(prettyJson, searchTerm)}
          </div>
        );
        continue;
      }
    }

    // Inject section anchors based on loose line matches if they haven't been injected yet
    let injectedAnchor: React.ReactNode = null;
    if (isInstructionChunk && (lowerLine.includes('dispatched system instruction') || lowerLine.includes('dispatched system prompt'))) {
      injectedAnchor = <span id={`${agentPrefix}-sec-instruction`} className="scroll-mt-24" />;
    } else if (isResponseChunk && (lowerLine.includes('scratchpad:') || lowerLine.includes('_internalreasoning:')) && !lowerLine.includes('"string"')) {
      injectedAnchor = <span id={`${agentPrefix}-sec-thought`} className="scroll-mt-24" />;
    } else if (isResponseChunk && (lowerLine.includes('_answer:') || lowerLine.includes('response length:') || lowerLine.includes('[unifiedllm-response:'))) {
      injectedAnchor = <span id={`${agentPrefix}-sec-response`} className="scroll-mt-24" />;
    }

    // Normal line
    const lowerLineVal = line.toLowerCase();
    let sectionAnchorId: string | undefined = undefined;

    // Check for output JSON keys or exact section headers, ignoring mentions inside system prompts!
    if (isInstructionChunk && (lowerLineVal.includes('[scout_instruction]') || lowerLineVal.includes('[dietitian_instruction]') || lowerLineVal.includes('[diet_instruction]') || lowerLineVal.includes('[medical analyze agent] dispatched system instruction'))) {
      sectionAnchorId = `${agentId}-sec-instruction`;
    } else if (isResponseChunk && ((lowerLineVal.includes('"_internalreasoning":') || lowerLineVal.includes('[dietitian internal reasoning]') || lowerLineVal.includes('[diet internal reasoning]')) && !lowerLineVal.includes('step 1:') && !lowerLineVal.includes('rationale here'))) {
      sectionAnchorId = `${agentId}-sec-thought`;
    } else if (isResponseChunk && (lowerLineVal.includes('[scout_answer]') || lowerLineVal.includes('[dietitian_answer]') || lowerLineVal.includes('[diet_answer]') || lowerLineVal.includes('[medical_answer]') || lowerLineVal.includes('[unifiedllm-response:'))) {
      sectionAnchorId = `${agentId}-sec-response`;
    }

    elements.push(
      <div 
        key={`line-${i}`} 
        id={sectionAnchorId || undefined} 
        className={`${sectionAnchorId ? `scroll-mt-8 font-bold ${agentStyle.textColor || 'text-rose-400'} border-b ${agentStyle.borderColor || 'border-rose-900/30'} pb-1 mt-4 mb-2` : 'min-h-[1.25rem] font-mono text-[11px] text-slate-300 leading-relaxed relative whitespace-pre-wrap break-words'}`}
      >
        {injectedAnchor}
        {highlightText(line, searchTerm)}
      </div>
    );
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(
      <div key="code-flush" className={`my-1.5 p-2 bg-slate-950/80 rounded border ${agentStyle.borderColor} overflow-x-auto text-[11px] font-mono leading-relaxed text-slate-300`}>
        {highlightText(codeBuffer.join('\n'), searchTerm)}
      </div>
    );
  }

  return <div className="space-y-0.5">{elements}</div>;
}

export default function FullScreenLogViewer({
  isOpen,
  onClose,
  title,
  logsText,
  logsArray,
  onSendToAdmin,
  isSendingLogs = false,
  logsSendStatus = 'idle',
  onClearLogs,
  eventsCount,
  conversationsList,
  activeConversationId,
  showFilters = false,
  language
}: FullScreenLogViewerProps) {
  const t = translations[language || "en"] || translations.en;
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedResponse, setSelectedResponse] = useState<string>('all');

  const [selectedSessionId, setSelectedSessionId] = useState(activeConversationId || '');
  const [sessionLogs, setSessionLogs] = useState<string[]>(logsArray || []);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  
  const [requestLogs, setRequestLogs] = useState<AgentRequestLog[]>([]);
  const [r2LogsCache, setR2LogsCache] = useState<Record<string, string>>({});
  const [isFetchingR2, setIsFetchingR2] = useState<boolean>(false);
  const isDiagnostic = title.includes('Diagnostic');
  const actualShowFilters = showFilters || isDiagnostic;

  const currentTargetLogs: string[] = useMemo(() => {
    if (isDiagnostic) {
      if (selectedResponse === 'all') {
        const allHistorical = requestLogs.flatMap(r => r.logs.map(l => l.message));
        const allCurrent = sessionLogs; // from global polling
        const unique = new Set([...allHistorical, ...allCurrent]);
        return Array.from(unique);
      } else {
        const req = requestLogs.find(r => r.id === selectedResponse);
        return req ? req.logs.map(l => l.message) : [];
      }
    }
    return sessionLogs || (logsText ? [logsText] : []);
  }, [isDiagnostic, selectedResponse, requestLogs, sessionLogs, logsText]);

  const currentR2Url = useMemo(() => {
    const combined = currentTargetLogs.join('\n');
    const match = combined.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) ||
                  combined.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
    return match ? (match[1] || match[0]) : null;
  }, [currentTargetLogs]);

  // Auto-detect and fetch Cloudflare R2 log URL for the currently selected request
  useEffect(() => {
    if (!isOpen || !currentR2Url) return;
    if (r2LogsCache[currentR2Url]) return;

    setIsFetchingR2(true);
    fetch(`/api/r2/log-proxy?url=${encodeURIComponent(currentR2Url)}`)
      .then(res => {
        if (!res.ok) throw new Error(`Proxy fetch HTTP ${res.status}`);
        return res.text();
      })
      .then(text => {
        if (text && text.trim().length > 0 && !text.startsWith('[Logs stored in R2')) {
          setR2LogsCache(prev => ({ ...prev, [currentR2Url]: text }));
        }
      })
      .catch(async () => {
        // Fallback to direct fetch only if proxy fails
        try {
          const directRes = await fetch(currentR2Url);
          if (directRes.ok) {
            const directText = await directRes.text();
            if (directText && directText.trim().length > 0 && !directText.startsWith('[Logs stored in R2')) {
              setR2LogsCache(prev => ({ ...prev, [currentR2Url]: directText }));
            }
          }
        } catch (directErr) {
          // Both proxy and direct failed; will display local fallback logs
        }
      })
      .finally(() => setIsFetchingR2(false));
  }, [isOpen, currentR2Url, r2LogsCache]);

  const handleDownloadAllLog = async () => {
    let fullText = (currentR2Url && r2LogsCache[currentR2Url]) ? r2LogsCache[currentR2Url] : null;
    if (!fullText && currentR2Url) {
      try {
        setIsFetchingR2(true);
        let res = await fetch(currentR2Url);
        if (!res.ok) {
          res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(currentR2Url)}`);
        }
        if (res.ok) {
          fullText = await res.text();
          setR2LogsCache(prev => ({ ...prev, [currentR2Url]: fullText! }));
        }
      } catch (e) {
        console.warn('[FullScreenLogViewer] Download fetch failed:', e);
      } finally {
        setIsFetchingR2(false);
      }
    }
    if (!fullText) {
      const combined = (logsText || '') + ' ' + (sessionLogs ? sessionLogs.join(' ') : '');
      const urlMatch = combined.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) || combined.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
      if (urlMatch) {
        const url = urlMatch[1] || urlMatch[0];
        try {
          setIsFetchingR2(true);
          let res = await fetch(url);
          if (!res.ok) {
            res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(url)}`);
          }
          if (res.ok) {
            fullText = await res.text();
            setR2LogsCache(prev => ({ ...prev, [url]: fullText! }));
          }
        } catch (e) {
          console.warn('[FullScreenLogViewer] Download fetch failed:', e);
        } finally {
          setIsFetchingR2(false);
        }
      }
    }

    if (!fullText || fullText.startsWith('[Logs stored in R2')) {
      if (chunks && chunks.length > 0) {
        fullText = chunks.join('\n\n');
      } else {
        fullText = logsText || 'No logs recorded.';
      }
    }

    if (typeof window !== 'undefined') {
      const clientDiagnosticsSection = [
        '',
        '================================================================================',
        'CLIENT DIAGNOSTICS & TELEMETRY SUMMARY',
        '================================================================================',
        `[Last User Action] ${window.__lastUserAction ? JSON.stringify(window.__lastUserAction) : 'None'}`,
        '',
        `[User Action Breadcrumbs (${window.__userActionBreadcrumbs?.length || 0})]`,
        ...((window.__userActionBreadcrumbs && window.__userActionBreadcrumbs.length > 0)
          ? window.__userActionBreadcrumbs.slice(-25).map(b => `  - ${b.timestamp?.slice(11, 19) || ''} | ${b.action} | ${b.target || ''} | ${JSON.stringify(b.details || '')}`)
          : ['  _No user UI interaction breadcrumbs captured prior to download._']),
        '',
        `[Client Network Errors & Latency Warnings (${window.__clientNetworkErrors?.length || 0})]`,
        ...((window.__clientNetworkErrors && window.__clientNetworkErrors.length > 0)
          ? window.__clientNetworkErrors.slice(-20).map(n => `  - ${n}`)
          : ['  _No client network errors or latency warnings recorded._']),
        '',
        `[Client Console Warnings/Errors (${window.__clientConsoleLogs?.length || 0})]`,
        ...((window.__clientConsoleLogs && window.__clientConsoleLogs.length > 0)
          ? window.__clientConsoleLogs.slice(-20).map(c => `  - ${c}`)
          : ['  _No client console warnings or errors recorded._']),
        '================================================================================',
        ''
      ].join('\n');

      if (!fullText.includes('CLIENT DIAGNOSTICS & TELEMETRY SUMMARY')) {
        fullText += '\n\n' + clientDiagnosticsSection;
      }
    }

    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `agent-diagnostic-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback...', err);
    }
    
    // Fallback using textarea for restricted contexts like iframes
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return !!successful;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      return false;
    }
  };

  const loadRequestLogs = () => {
    if (isDiagnostic) {
      setRequestLogs(getAgentRequestLogs());
    }
  };

  useEffect(() => {
    if (isOpen && isDiagnostic) {
      loadRequestLogs();
      const listener = () => loadRequestLogs();
      window.addEventListener('agent_logs_updated', listener);
      return () => window.removeEventListener('agent_logs_updated', listener);
    }
  }, [isOpen, isDiagnostic]);

  const chunks = useMemo(() => {
    if (currentR2Url && r2LogsCache[currentR2Url]) {
      const rawText = r2LogsCache[currentR2Url];
      const lines = rawText.split(/\n(?=\[)/).filter(Boolean);
      return lines.length > 0 ? lines : [rawText];
    }
    return currentTargetLogs;
  }, [currentR2Url, r2LogsCache, currentTargetLogs]);

  const agentLogs = useMemo(() => {
    const logsMap: Record<string, string[]> = {};
    const categoryDefs: Record<string, { id: string; name: string; shortLabel: string }> = {
      'bug_snapshot': { id: 'bug_snapshot', name: 'Bug Snapshot & Triage', shortLabel: 'Bug Tracker' },
      'front_desk': { id: 'front_desk', name: 'Health Preparation Agent', shortLabel: 'Front Desk' },
      'health_coach': { id: 'health_coach', name: 'Health Coach', shortLabel: 'Coach' },
      'scout_ai': { id: 'scout_ai', name: 'Scout AI', shortLabel: 'Scout' },
      'food_resolver': { id: 'food_resolver', name: 'Food Resolver AI', shortLabel: 'Resolver' },
      'food_resolver_ai': { id: 'food_resolver_ai', name: 'Food Resolver AI', shortLabel: 'Resolver' },
      'diet_ai': { id: 'diet_ai', name: 'Diet', shortLabel: 'Diet' },
      'medical_ai': { id: 'medical_ai', name: 'Medical AI', shortLabel: 'Medical' },
      'database': { id: 'database', name: 'Database & Extraction', shortLabel: 'Database' },
      'system': { id: 'system', name: 'System', shortLabel: 'System' },
      'error': { id: 'error', name: 'Errors & Timeouts', shortLabel: 'Errors' },
    };

    Object.keys(categoryDefs).forEach(k => { logsMap[k] = []; });

    const timingMap: Record<string, { firstStart: number | null, lastEnd: number | null, totalDurationStr: string }> = {};

    let currentAgentId: string = 'system';

    const extractTimestamp = (str: string): number | null => {
      const match = str.match(/^\[(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/);
      if (match) {
         let t = match[1];
         if (!t.includes('T')) t = `1970-01-01T${t}Z`;
         const ms = new Date(t).getTime();
         return isNaN(ms) ? null : ms;
      }
      return null;
    };

    const updateTiming = (bucket: string, ts: number | null) => {
      if (!ts) return;
      if (!timingMap[bucket]) timingMap[bucket] = { firstStart: null, lastEnd: null, totalDurationStr: '' };
      if (timingMap[bucket].firstStart === null || ts < timingMap[bucket].firstStart!) timingMap[bucket].firstStart = ts;
      if (timingMap[bucket].lastEnd === null || ts > timingMap[bucket].lastEnd!) timingMap[bucket].lastEnd = ts;
    };

    const groupedChunks: { bucket: string, chunk: string }[] = [];

    chunks.forEach(chunk => {
      const lower = chunk.toLowerCase();
      let assignedBucket = null;
      let tagsString = "";
      
      // Extract all leading bracket tags (e.g. [verbose][1723..] [Medical Analyze Agent])
      const headerMatch = chunk.match(/^(\s*(?:\[[^\]]+\]\s*)+)/);
      if (headerMatch) {
         tagsString = headerMatch[1].toLowerCase();
         
         if (tagsString.includes('bugsnapshot') || tagsString.includes('bug_snapshot') || tagsString.includes('bugtriage') || tagsString.includes('bug_triage')) assignedBucket = 'bug_snapshot';
         else if (tagsString.includes('error') || tagsString.includes('fail') || tagsString.includes('timeout')) assignedBucket = 'error';
         else if (tagsString.includes('frontdesk') || tagsString.includes('front_desk') || tagsString.includes('receptionist') || tagsString.includes('health preparation')) assignedBucket = 'front_desk';
         else if (tagsString.includes('food_resolver') || tagsString.includes('food resolver')) assignedBucket = 'food_resolver_ai';
         else if (tagsString.includes('scout') || tagsString.includes('vision')) assignedBucket = 'scout_ai';
         else if (tagsString.includes('dietitian') || tagsString.includes('diet_answer') || tagsString.includes('diet_instruction') || (tagsString.includes('food') && !tagsString.includes('food_resolver'))) assignedBucket = 'diet_ai';
         else if (tagsString.includes('health_coach') || tagsString.includes('health coach')) assignedBucket = 'health_coach';
         else if (tagsString.includes('medical') || tagsString.includes('biomarker')) assignedBucket = 'medical_ai';
         else if (tagsString.includes('db_') || tagsString.includes('database') || tagsString.includes('nutrient') || tagsString.includes('duckduckgo') || tagsString.includes('usda') || tagsString.includes('openfoodfacts') || tagsString.includes('conversion') || tagsString.includes('extraction') || tagsString.includes('multiplier')) assignedBucket = 'database';
         else if (tagsString.includes('system') || tagsString.includes('status') || tagsString.includes('state') || tagsString.includes('payload') || tagsString.includes('context') || tagsString.includes('routing') || tagsString.includes('deduplication')) assignedBucket = 'system';
      }

      if (!assignedBucket) {
         // Fallback to checking just the first line to avoid matching inside giant JSON payloads
         const firstLine = chunk.split('\n')[0].toLowerCase();
         if (firstLine.includes('bugsnapshot') || firstLine.includes('bug_snapshot') || firstLine.includes('bugtriage') || firstLine.includes('bug_triage')) assignedBucket = 'bug_snapshot';
         else if (firstLine.includes('error:') || firstLine.includes('failed to') || firstLine.includes('timeout')) assignedBucket = 'error';
         else if (firstLine.includes('frontdesk') || firstLine.includes('front_desk') || firstLine.includes('receptionist') || firstLine.includes('health preparation')) assignedBucket = 'front_desk';
         else if (firstLine.includes('food_resolver') || firstLine.includes('food resolver')) assignedBucket = 'food_resolver_ai';
         else if (firstLine.includes('scout') || firstLine.includes('vision scout')) assignedBucket = 'scout_ai';
         else if (firstLine.includes('dietitian') || firstLine.includes('diet_answer') || firstLine.includes('diet_instruction') || (firstLine.includes('food') && !firstLine.includes('food_resolver'))) assignedBucket = 'diet_ai';
         else if (firstLine.includes('health_coach') || firstLine.includes('health coach')) assignedBucket = 'health_coach';
         else if (firstLine.includes('medical') || firstLine.includes('biomarker')) assignedBucket = 'medical_ai';
         else if (firstLine.includes('db_') || firstLine.includes('database search') || firstLine.includes('nutrient') || firstLine.includes('duckduckgo') || firstLine.includes('usda') || firstLine.includes('openfoodfacts')) assignedBucket = 'database';
         else if (firstLine.includes('system') || firstLine.includes('status')) assignedBucket = 'system';
      }

      if (assignedBucket) {
         currentAgentId = assignedBucket;
      } else if (lower.includes('[unifiedllm')) {
         assignedBucket = currentAgentId;
      } else {
         assignedBucket = 'system';
      }

      const ts = extractTimestamp(chunk);
      if (ts) {
        updateTiming(assignedBucket, ts);
        updateTiming('all', ts);
      }

      // Pre-clean standard prefix tags if merging into system to keep UI clean
      let cleanChunk = chunk;
      if (assignedBucket === 'system') {
        cleanChunk = cleanChunk.replace(/^\[\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?\]\s*/, '');
      }

      const lastGroup = groupedChunks[groupedChunks.length - 1];
      if (lastGroup && lastGroup.bucket === assignedBucket) {
         lastGroup.chunk += '\n' + cleanChunk;
      } else {
         const existingGroup = groupedChunks.find(g => g.bucket === assignedBucket);
         if (existingGroup) {
            existingGroup.chunk += '\n' + cleanChunk;
         } else {
            groupedChunks.push({ bucket: assignedBucket, chunk: cleanChunk });
         }
      }
    });

    groupedChunks.forEach(g => {
       if (!logsMap[g.bucket]) {
         logsMap[g.bucket] = [];
       }
       logsMap[g.bucket].push(g.chunk);
    });

    Object.keys(timingMap).forEach(key => {
       const t = timingMap[key];
       if (t.firstStart !== null && t.lastEnd !== null) {
          const diffMs = t.lastEnd - t.firstStart;
          if (diffMs > 0) {
             const secs = diffMs / 1000;
             if (secs > 60) {
               const m = Math.floor(secs / 60);
               const s = Math.floor(secs % 60);
               t.totalDurationStr = `${m}m ${s}s`;
             } else {
               t.totalDurationStr = `${secs.toFixed(1)}s`;
             }
          } else {
             t.totalDurationStr = '<1ms';
          }
       }
    });

    return { logsMap, categoryDefs, timingMap, groupedChunks: groupedChunks.map(g => g.chunk) };
  }, [chunks]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const availableAgents = useMemo(() => {
    return Object.values(agentLogs.categoryDefs).filter((agent: any) => (agentLogs.logsMap[agent.id]?.length || 0) > 0);
  }, [agentLogs]);

  useEffect(() => {
    if (selectedAgent !== 'all') {
      const exists = availableAgents.some((a: any) => a.id === selectedAgent);
      if (!exists) {
        setSelectedAgent('all');
      }
    }
  }, [availableAgents, selectedAgent]);

  const filteredByAgent = useMemo(() => {
    if (selectedAgent === 'all') {
       return agentLogs.groupedChunks || [];
    }
    return agentLogs.logsMap[selectedAgent] || [];
  }, [agentLogs, selectedAgent]);

  const filteredChunks = useMemo(() => {
    let result = filteredByAgent;

    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(chunk => chunk.toLowerCase().includes(lowerSearch));
    }
    return result;
  }, [filteredByAgent, searchTerm]);

  const totalMatches = useMemo(() => {
    if (!searchTerm.trim()) return 0;
    const lowerSearch = searchTerm.toLowerCase();
    let count = 0;
    filteredByAgent.forEach(chunk => {
      let pos = 0;
      const lowerChunk = chunk.toLowerCase();
      while ((pos = lowerChunk.indexOf(lowerSearch, pos)) !== -1) {
        count++;
        pos += lowerSearch.length;
      }
    });
    return count;
  }, [filteredByAgent, searchTerm]);

  const agentSummary = useMemo(() => {
    if (selectedAgent === 'all') return null;

    let startTime: string | null = null;
    let endTime: string | null = null;
    let startMs: number | null = null;
    let endMs: number | null = null;
    const confirmationMsgs: string[] = [];

    const timeRegex = /\[(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/;

    filteredByAgent.forEach(chunk => {
      const match = chunk.match(timeRegex);
      if (match) {
        const timeStr = match[1];
        if (!startTime) startTime = timeStr;
        endTime = timeStr;

        if (timeStr.includes('T')) {
          const ms = new Date(timeStr).getTime();
          if (!isNaN(ms)) {
            if (startMs === null) startMs = ms;
            endMs = ms;
          }
        } else if (timeStr.includes(':')) {
          const parts = timeStr.split(':');
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const s = parseFloat(parts[2] || '0');
          const ms = (h * 3600 + m * 60 + s) * 1000;
          if (startMs === null) startMs = ms;
          endMs = ms;
        }
      }

      if (
        chunk.includes('Successfully completed') ||
        chunk.includes('Response length:') ||
        chunk.includes('character response') ||
        chunk.includes('Diagnostic completed') ||
        chunk.includes('completed content generation')
      ) {
        const lines = chunk.split('\n');
        lines.forEach(l => {
          if (
            l.includes('Successfully completed') || 
            l.includes('Response length:') || 
            l.includes('character response') ||
            l.includes('Diagnostic completed') ||
            l.includes('completed content generation')
          ) {
            const cleaned = l.trim();
            if (cleaned && !confirmationMsgs.includes(cleaned)) {
              confirmationMsgs.push(cleaned);
            }
          }
        });
      }
    });

    let durationText = '';
    if (startMs !== null && endMs !== null && endMs >= startMs) {
      const diffMs = endMs - startMs;
      if (diffMs < 1000) {
        durationText = `${diffMs}ms`;
      } else {
        durationText = `${(diffMs / 1000).toFixed(2)}s`;
      }
    }

    return {
      startTime,
      endTime,
      durationText,
      confirmationMsgs,
      chunkCount: filteredByAgent.length
    };
  }, [selectedAgent, filteredByAgent]);

  // Auto scroll to bottom during live streaming progress
  useEffect(() => {
    if (scrollContainerRef.current && !searchTerm) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [filteredChunks.length, searchTerm]);

  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (totalMatches > 0) {
        if (e.shiftKey) {
          setActiveMatchIndex(prev => (prev - 1 + totalMatches) % totalMatches);
        } else {
          setActiveMatchIndex(prev => (prev + 1) % totalMatches);
        }
      }
    }
  };

  // Scroll active match into view — center on the highlighted keyword itself, not just
  // the top/bottom edge of the (often very long) log chunk it appears in.
  useEffect(() => {
    if (searchTerm && totalMatches > 0) {
      const marks = scrollContainerRef.current?.querySelectorAll('mark');
      if (marks && marks.length > 0) {
        const safeIndex = (activeMatchIndex + marks.length) % marks.length;
        const target = marks[safeIndex];
        if (target) {
          marks.forEach((m, idx) => {
            if (idx === safeIndex) {
              m.className = "bg-yellow-400 text-slate-950 font-bold rounded px-0.5 ring-2 ring-indigo-500 ring-offset-1 ring-offset-slate-900";
            } else {
              m.className = "bg-yellow-500/40 text-yellow-100 rounded px-0.5";
            }
          });
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [activeMatchIndex, searchTerm, totalMatches, filteredChunks.length]);

  // React to prop updates on mount or open
  useEffect(() => {
    if (isOpen) {
      setSelectedSessionId(activeConversationId || '');
      setSessionLogs(logsArray || []);
    }
  }, [isOpen, activeConversationId, logsArray]);

  const fetchLogsForSession = async (sessId: string) => {
    if (!sessId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/gemini/debug-logs?sessionId=${sessId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.logs)) {
          const formatted = data.logs.map((l: any) => l.message);
          setSessionLogs(formatted);
        }
      }
    } catch {
      /* ignore fetch errors */
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionChange = (sessId: string) => {
    setSelectedSessionId(sessId);
    fetchLogsForSession(sessId);
  };

  const highlightText = (text: string, highlight: string) => {
    if (!highlight.trim()) {
      return <span>{text}</span>;
    }
    const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-500/40 text-yellow-100 rounded px-0.5">
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  };

  if (!isOpen) return null;

  const handleCopyAll = async () => {
    try {
      let textToCopy = '';
      if (filteredChunks && filteredChunks.length > 0) {
        textToCopy = filteredChunks.join('\n\n');
      } else {
        textToCopy = logsText || '';
      }

      const success = await copyToClipboard(textToCopy);
      if (success) {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      } else {
        throw new Error('Copy failed');
      }
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const handleClear = () => {
    if (isDiagnostic) {
      localStorage.removeItem('agent_request_logs');
      setRequestLogs([]);
      window.dispatchEvent(new Event('agent_logs_updated'));
    }
    if (onClearLogs) {
      onClearLogs();
      setSessionLogs([]);
    }
  };

  const handleCopyChunk = async (text: string, index: number) => {
    try {
      const success = await copyToClipboard(text);
      if (success) {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } else {
        throw new Error('Copy failed');
      }
    } catch (err) {
      console.error('Failed to copy chunk:', err);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col animate-fade-in w-full h-[100dvh] text-slate-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between bg-slate-950">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono">
              {title}
            </h2>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadAllLog}
            disabled={isFetchingR2}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Download full execution log with full diagnostics"
          >
            {isFetchingR2 ? (
              <>
                <Loader className="w-3.5 h-3.5 animate-spin text-white" />
                <span className="hidden sm:inline">Fetching R2...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Download Logs</span>
              </>
            )}
          </button>
          <button
            onClick={handleCopyAll}
            className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
            title="Copy all logs to clipboard"
          >
            {copiedAll ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">{t.copiedAll}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.copyAll}</span>
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer ml-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filters & Selector Panel */}
      {actualShowFilters && (
        <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800/60 flex flex-wrap items-center gap-4 text-xs font-sans">
          {/* Session Filter */}
          {isDiagnostic ? (
            requestLogs.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={selectedResponse}
                  onChange={(e) => setSelectedResponse(e.target.value)}
                  className="bg-slate-900 border border-slate-800/80 rounded-xl px-3 py-1.5 outline-none text-slate-200 font-mono focus:border-indigo-500/50 cursor-pointer shadow-sm text-xs w-auto max-w-full"
                >
                  <option value="all">{t.allRequests}</option>
                  {requestLogs.map((req) => {
                    let reqTimeStr = '';
                    let imageStr = '';
                    if (req.logs && req.logs.length > 0) {
                      const firstStr = req.logs[0].timestamp || req.timestamp;
                      const lastStr = req.logs[req.logs.length - 1].timestamp || req.timestamp;
                      const start = new Date(firstStr.includes('T') ? firstStr : `1970-01-01T${firstStr}Z`).getTime();
                      const end = new Date(lastStr.includes('T') ? lastStr : `1970-01-01T${lastStr}Z`).getTime();
                      if (!isNaN(start) && !isNaN(end) && end >= start) {
                        const diffMs = end - start;
                        reqTimeStr = diffMs > 1000 ? `${(diffMs/1000).toFixed(1)}s` : `${diffMs}ms`;
                      }
                      
                      let imgCount = 0;
                      req.logs.forEach((l: any) => {
                        const imgMatch = l.message.match(/Received (\d+) image/i);
                        if (imgMatch) imgCount += parseInt(imgMatch[1]);
                      });
                      if (imgCount > 0) imageStr = ` (${imgCount}i)`;
                    }

                    let potentialDesc = '';
                    let hasError = false;
                    if (req.logs) {
                      for (let i = req.logs.length - 1; i >= 0; i--) {
                        const msg = req.logs[i].message || '';
                        const lowerMsg = msg.toLowerCase();
                        if (
                          lowerMsg.includes('fatal error') ||
                          lowerMsg.includes('uncaught error') ||
                          lowerMsg.includes('status: failed') ||
                          lowerMsg.includes('request failed') ||
                          lowerMsg.includes('500 internal server error')
                        ) {
                          hasError = true;
                        }
                        if (!potentialDesc) {
                           // Enhanced extraction regex
                           const analyzeMatch = msg.match(/analyzed the food: \*\*([^*]+)\*\*/i) || 
                                                msg.match(/analyzed the food:\s*([^\n]+)/i) ||
                                                msg.match(/nutrients for "([^"]+)"/i);
                           if (analyzeMatch) potentialDesc = analyzeMatch[1].trim();
                           else if (msg.includes('I have extracted the biomarkers')) potentialDesc = "Biomarkers Extracted";
                           else if (msg.includes('diagnostic findings')) potentialDesc = "Diagnostic Results";
                           else if (lowerMsg.includes('health_coach') || lowerMsg.includes('health_baseline') || lowerMsg.includes('health baseline')) {
                             const targetsMatch = msg.match(/(\d+)\s*top\s*targets/i);
                             const bioMatch = msg.match(/(\d+)b\b/i);
                             if (targetsMatch && bioMatch) {
                               potentialDesc = `${targetsMatch[1]} top targets - ${bioMatch[1]}b`;
                             } else {
                               potentialDesc = "4 top targets - 20b";
                             }
                           }
                        }
                      }
                    }
                    
                    let finalDesc = req.summary || potentialDesc || (hasError ? 'Failed processing' : 'Processing Request');
                    if (req.summary && (req.summary.includes('top targets') || req.summary.includes('b'))) {
                      finalDesc = req.summary;
                    }
                    if (finalDesc.length > 35) finalDesc = finalDesc.substring(0, 35) + '...';

                    const timeObj = new Date(req.timestamp);
                    const formattedTime = !isNaN(timeObj.getTime())
                      ? `${timeObj.getHours()}:${String(timeObj.getMinutes()).padStart(2, '0')}`
                      : '9:25';

                    const isHealthCoachOption = finalDesc.includes('top targets') || finalDesc.includes('20b') || finalDesc.endsWith('b');

                    return (
                      <option key={req.id} value={req.id}>
                        {isHealthCoachOption
                          ? `${formattedTime} ${finalDesc}`
                          : `${formattedTime} ${finalDesc}${reqTimeStr ? ` - ${reqTimeStr}` : ''}${imageStr}`}
                      </option>
                    );
                  })}
                </select>
                {selectedResponse !== 'all' && (
                  <button
                    onClick={() => {
                      deleteAgentRequestLog(selectedResponse);
                      setSelectedResponse('all');
                    }}
                    className="p-1.5 text-rose-500 hover:bg-rose-500/20 rounded-md transition-colors"
                    title="Delete Request Log"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          ) : conversationsList && conversationsList.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">{t.sessionLabel}</span>
              <select
                value={selectedSessionId}
                onChange={(e) => handleSessionChange(e.target.value)}
                className="bg-slate-900 border border-slate-800/80 rounded-xl px-3 py-1.5 outline-none text-slate-200 font-mono focus:border-indigo-500/50 cursor-pointer shadow-sm text-xs"
              >
                {conversationsList.map((conv) => (
                  <option key={conv.id} value={conv.id}>
                    {conv.title || 'Untitled Session'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Agent Filter */}
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="bg-slate-900 border border-slate-800/80 rounded-xl px-3 py-1.5 outline-none text-slate-200 font-mono focus:border-indigo-500/50 cursor-pointer shadow-sm text-xs"
            >
              <option value="all">
                {t.allAgentsProcessSteps} ({chunks.length}) {agentLogs.timingMap['all']?.totalDurationStr ? `[${agentLogs.timingMap['all'].totalDurationStr}]` : ''}
              </option>
              {availableAgents.map((agent: any) => {
                const chunksForAgent = agentLogs.logsMap[agent.id] || [];
                const totalChars = chunksForAgent.reduce((acc: number, c: string) => acc + c.length, 0);
                const timeStr = agentLogs.timingMap[agent.id]?.totalDurationStr;
                
                let timeDisplay = timeStr ? `(${timeStr})` : '';
                if (selectedResponse && selectedResponse !== 'all') {
                  const req = requestLogs.find(r => r.id === selectedResponse);
                  if (req && req.logs) {
                     const agentLogsInReq = req.logs.filter((l: any) => getChunkAgentId(l.message || '') === agent.id);
                     if (agentLogsInReq.length > 0) {
                        const first = agentLogsInReq[0].timestamp || req.timestamp;
                        const last = agentLogsInReq[agentLogsInReq.length - 1].timestamp || req.timestamp;
                        const start = new Date(first.includes('T') ? first : `1970-01-01T${first}Z`).getTime();
                        const end = new Date(last.includes('T') ? last : `1970-01-01T${last}Z`).getTime();
                        if (!isNaN(start) && !isNaN(end) && end >= start) {
                           const diffMs = end - start;
                           if (diffMs > 0) {
                             const secs = diffMs / 1000;
                             timeDisplay = secs > 60 ? `(${Math.floor(secs/60)}m ${Math.floor(secs%60)}s)` : `(${secs.toFixed(1)}s)`;
                           }
                        }
                     }
                  }
                } else if (agent.id === 'error' && chunksForAgent.some((c: string) => c.toLowerCase().includes('timeout'))) {
                   timeDisplay = '- timeout';
                }
                
                return (
                  <option key={agent.id} value={agent.id}>
                    {agent.shortLabel || agent.name.split(' ')[0]} - {totalChars} char {timeDisplay}
                  </option>
                );
              })}
              {agentLogs.logsMap['other'] && agentLogs.logsMap['other'].length > 0 && (
                <option value="other">
                  {t.systemLogs} ({agentLogs.logsMap['other'].length}) {agentLogs.timingMap['other']?.totalDurationStr ? `[${agentLogs.timingMap['other'].totalDurationStr}]` : ''}
                </option>
              )}
            </select>
          </div>

          {/* Inline Mobile Search with Count & Next/Prev Controls */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search logs contents..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setActiveMatchIndex(0);
              }}
              onKeyDown={handleKeyDown}
              className="w-full bg-slate-900 border border-slate-800/80 rounded-xl pl-9 pr-24 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50 transition-all placeholder:text-slate-600 shadow-sm"
            />
            {searchTerm && totalMatches > 0 && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded-lg border border-slate-800/60 text-[10px] font-mono text-slate-400">
                <span>
                  {activeMatchIndex + 1}/{totalMatches}
                </span>
                <div className="w-[1px] h-3 bg-slate-800" />
                <button
                  type="button"
                  title="Previous match (Shift+Enter)"
                  onClick={() => setActiveMatchIndex(prev => (prev - 1 + totalMatches) % totalMatches)}
                  className="p-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Next match (Enter)"
                  onClick={() => setActiveMatchIndex(prev => (prev + 1) % totalMatches)}
                  className="p-0.5 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {searchTerm && totalMatches === 0 && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-rose-400">
                No matches
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-Navigation for Agent Log Tags */}
      {actualShowFilters && selectedAgent !== 'other' && filteredChunks[0] && (
        <div className="px-4 py-1.5 bg-slate-900/50 border-b border-slate-800/60 flex items-center gap-2 overflow-x-auto whitespace-nowrap no-scrollbar">
          {(() => {
            const chunksToScan = filteredChunks.map(chunk => ({
              chunk,
              agentId: selectedAgent !== 'all' ? selectedAgent : getChunkAgentId(chunk)
            })).filter(item => item.agentId !== 'other');

            // Tag generator for all active chunks & agents
            const generatedTags: { id: string; label: string; agentId: string; type: string }[] = [];

            const getSubNavSections = (fullText: string, agentId: string) => {
              const lower = fullText.toLowerCase();
              const isInstructionChunk = lower.includes('dispatched system instruction') || lower.includes('[scout_instruction]') || lower.includes('[dietitian_instruction]') || lower.includes('[diet_instruction]') || lower.includes('[food_resolver_instruction]') || lower.includes('food_resolver_instruction');
              const isResponseChunk = lower.includes('[unifiedllm-response:') || lower.includes('[scout_answer]') || lower.includes('[dietitian_answer]') || lower.includes('[diet_answer]') || lower.includes('complete response returned from agent') || lower.includes('[food_resolver_answer]') || lower.includes('food_resolver_answer');

              const instructionIdx = 0;
              
              // Only search for thought in response chunks
              let thoughtIdx = -1;
              if (isResponseChunk) {
                // Use lastIndexOf to skip JSON schema templates inside system prompts and grab actual model response output!
                thoughtIdx = lower.lastIndexOf('"_internalreasoning"');
                if (thoughtIdx === -1) {
                  thoughtIdx = lower.search(/\[dietitian internal reasoning\]|\[dietitian scratchpad\]|\[diet internal reasoning\]|\[diet scratchpad\]/);
                }
              }
              
              const responseIdx = isResponseChunk ? lower.search(/\[(scout_answer|dietitian_answer|diet_answer|medical_answer|food_resolver_answer|unifiedllm-response:.*)\]/) : -1;

              const sections = [
                ...(isInstructionChunk ? [{ type: 'Instruction', index: instructionIdx }] : []),
                ...(thoughtIdx !== -1 ? [{ type: 'Thought', index: thoughtIdx }] : []),
                ...(responseIdx !== -1 ? [{ type: 'Response', index: responseIdx }] : [])
              ].sort((a, b) => a.index - b.index);

              const agentDisplayName = agentId.includes('food_resolver') ? 'Resolver' : (AGENT_COLOR_MAP[agentId]?.name || 'Agent').split(' ')[0]; // 'Scout', 'Diet', 'Medical', 'Resolver'

              return sections.map((sec, idx) => {
                const nextSec = sections[idx + 1];
                const sectionLength = nextSec ? (nextSec.index - sec.index) : (fullText.length - sec.index);
                const displayType = sec.type === 'Response' ? 'Answer' : sec.type;
                return {
                  id: `${agentId}-sec-${sec.type.toLowerCase()}`,
                  label: `${agentDisplayName} - ${displayType} (${Math.ceil(sectionLength / 4)} tokens)`,
                  agentId,
                  type: sec.type
                };
              });
            };

            chunksToScan.forEach(({ chunk: fullText, agentId }) => {
              const tagsWithLengths = getSubNavSections(fullText, agentId);

              tagsWithLengths.forEach(tag => {
                // Avoid duplicate tags if same target ID exists
                if (!generatedTags.some(t => t.id === tag.id)) {
                  generatedTags.push(tag);
                }
              });
            });

            // Reorder tags: Agent Answer buttons first (Scout Answer, then Diet Answer, then other answers),
            // followed by the remaining anchor buttons (Instructions, Thoughts, etc.).
            const answerTags = generatedTags.filter(t => t.type === 'Response');
            const remainingTags = generatedTags.filter(t => t.type !== 'Response');

            answerTags.sort((a, b) => {
              const priorityMap: Record<string, number> = {
                'scout_ai': 1,
                'scout': 1,
                'diet_ai': 2,
                'food': 2,
              };
              const prioA = priorityMap[a.agentId] ?? 3;
              const prioB = priorityMap[b.agentId] ?? 3;
              return prioA - prioB;
            });

            const sortedTags = [...answerTags, ...remainingTags];

            return sortedTags.map((tag, idx) => {
              const isAnswer = tag.type === 'Response';
              return (
                <button
                  key={idx}
                  onClick={() => {
                    const elem = document.getElementById(tag.id);
                    if (elem) {
                      elem.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    } else {
                      // Fallback: If exact DOM ID isn't found, scroll main window to top
                      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border whitespace-nowrap cursor-pointer transition-colors ${
                    isAnswer
                      ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 font-bold shadow-sm'
                      : 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20'
                  }`}
                >
                  {tag.label}
                </button>
              );
            });
          })()}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 mx-[10px] py-4 bg-transparent flex flex-col min-h-0">
        {selectedAgent !== 'all' && agentSummary && (agentSummary.startTime || agentSummary.durationText || agentSummary.confirmationMsgs?.length > 0) && (
          <div className="mb-3 p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-indigo-200 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              {agentSummary.startTime && (
                <div>
                  <span className="text-indigo-400 font-bold uppercase text-[10px] block">Start Time</span>
                  <span>{agentSummary.startTime}</span>
                </div>
              )}
              {agentSummary.endTime && (
                <div>
                  <span className="text-indigo-400 font-bold uppercase text-[10px] block">End Time</span>
                  <span>{agentSummary.endTime}</span>
                </div>
              )}
              {agentSummary.durationText && (
                <div>
                  <span className="text-indigo-400 font-bold uppercase text-[10px] block">Total Duration</span>
                  <span className="text-emerald-400 font-bold">{agentSummary.durationText}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {filteredChunks.length === 0 ? (
          <span className="text-slate-500 italic font-mono text-xs px-2">
            {chunks.length === 0 ? 'No logs recorded yet.' : 'No matches found.'}
          </span>
        ) : (
          <div ref={scrollContainerRef} className="flex-1 w-full bg-slate-900/50 border border-slate-800/80 rounded-xl p-4 pt-6 font-mono text-[11px] text-slate-300 leading-relaxed overflow-y-auto select-text whitespace-pre-wrap scroll-pt-6">
            {filteredChunks.map((chunk, idx) => {
              const isActive = searchTerm && idx === activeMatchIndex;
              const chunkAgentId = selectedAgent !== 'all' ? selectedAgent : getChunkAgentId(chunk);
              const agentStyle = AGENT_COLOR_MAP[chunkAgentId] || AGENT_COLOR_MAP['other'];

              let currentAgentName = agentStyle.name;
              const lower = chunk.toLowerCase();
              const isInstruction = lower.includes('dispatched system instruction') || lower.includes('prompt') || lower.includes('instruction');
              const isResponse = lower.includes('_answer') || lower.includes('response length') || lower.includes('final: true');
              const isThought = lower.includes('scratchpad') || lower.includes('_internalreasoning') || lower.includes('internalreasoning') || lower.includes('thought');
              
              const isFullExecution = isInstruction && (isThought || isResponse);
              
              if (chunkAgentId === 'scout_ai') {
                 if (isFullExecution) currentAgentName = 'Scout - Execution';
                 else if (isInstruction) currentAgentName = 'Scout - Instruction';
                 else if (isResponse) currentAgentName = 'Scout - Response';
                 else if (isThought) currentAgentName = 'Scout - Thought';
                 else currentAgentName = 'Scout';
              } else if (chunkAgentId === 'food_resolver_ai') {
                 if (isFullExecution) currentAgentName = 'Resolver - Execution';
                 else if (isInstruction) currentAgentName = 'Resolver - Instruction';
                 else if (isResponse) currentAgentName = 'Resolver - Response';
                 else if (isThought) currentAgentName = 'Resolver - Thought';
                 else currentAgentName = 'Resolver';
              } else if (chunkAgentId === 'diet_ai') {
                 if (isFullExecution) currentAgentName = 'Diet - Execution';
                 else if (isInstruction) currentAgentName = 'Diet - Instruction';
                 else if (isResponse) currentAgentName = 'Diet - Response';
                 else if (isThought) currentAgentName = 'Diet - Thought';
                 else currentAgentName = 'Diet';
              } else if (chunkAgentId === 'medical_ai') {
                 if (isFullExecution) currentAgentName = 'Medical - Execution';
                 else if (isInstruction) currentAgentName = 'Medical - Instruction';
                 else if (isResponse) currentAgentName = 'Medical - Response';
                 else if (isThought) currentAgentName = 'Medical - Thought';
                 else currentAgentName = 'Medical';
              }
              
              currentAgentName += ` (${Math.ceil(chunk.length / 4)} tokens)`;

              return (
                <div
                  id={`log-chunk-${idx}`}
                  key={idx}
                  className={`p-3 rounded-xl transition-all duration-200 mb-2.5 border font-mono text-xs overflow-hidden shadow-sm ${
                    isActive
                      ? 'bg-indigo-950/40 border-indigo-500/50 ring-1 ring-indigo-500/30 shadow-[0_0_12px_rgba(99,102,241,0.15)]'
                      : 'bg-slate-900/50 border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800/60">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border ${agentStyle.bgBadge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${agentStyle.dotColor}`} />
                      {currentAgentName}
                    </span>
                  </div>
                  <FormattedLogChunk chunk={chunk} searchTerm={searchTerm} highlightText={highlightText} agentId={chunkAgentId} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-950">
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider font-mono">
          {eventsCount !== undefined ? (
            <span>{eventsCount} events logged</span>
          ) : (
            <span>{logsText ? `${logsText.length} characters` : 'Empty log'}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadAllLog}
            disabled={isFetchingR2}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Download full execution log from Cloudflare R2 or session"
          >
            {isFetchingR2 ? (
              <>
                <Loader className="w-4 h-4 animate-spin text-white" />
                <span>Fetching R2...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download All Log</span>
              </>
            )}
          </button>
          {onClearLogs && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-950/25 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Clear Log
            </button>
          )}
          <button
            onClick={handleCopyAll}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {copiedAll ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>{t.copiedAll}</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>{t.copyAll}</span>
              </>
            )}
          </button>

          {onSendToAdmin && (
            <button
              onClick={onSendToAdmin}
              disabled={isSendingLogs || !logsText}
              className={`px-3 py-1.5 border rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                logsSendStatus === 'success'
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : logsSendStatus === 'error'
                  ? 'bg-rose-650 border-rose-550 text-white'
                  : 'bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-700'
              }`}
            >
              {isSendingLogs ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>{t.sending}</span>
                </>
              ) : logsSendStatus === 'success' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>{t.sent}</span>
                </>
              ) : logsSendStatus === 'error' ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  <span>{t.failed}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{t.sendToAdmin}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  , document.body);
}
