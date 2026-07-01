import React from 'react';
import { 
  Sparkles, 
  BookOpen, 
  Dumbbell, 
  Apple, 
  Activity, 
  TrendingUp, 
  CheckCircle2, 
  AlertCircle, 
  Calendar, 
  Flame, 
  ExternalLink, 
  Scale, 
  Droplet,
  ShieldAlert,
  ChevronRight,
  ClipboardList
} from 'lucide-react';

interface Agent5Result {
  message?: string;
  contextualizedBiomarkers?: {
    name: string;
    userValue: number | string;
    profileAdjustedNormalRange: string;
    description: string;
    status: 'Healthy' | 'At Risk' | string;
    specificRiskContext?: string;
  }[];
}

interface Agent6Result {
  message?: string;
  nutrientTargets?: {
    [key: string]: {
      value: number;
      unit: string;
      reason: string;
      duration: string;
    };
  };
  activityChecklist?: {
    habit: string;
    target: string;
    type: string;
  }[];
  projections?: string[];
}

interface Agent7Result {
  message?: string;
  insights?: {
    title: string;
    summary: string;
    link?: string;
  }[];
}

function safeParseResult<T>(raw: any): T | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    return null;
  }
}

export const Agent5View: React.FC<{ rawResult: any }> = ({ rawResult }) => {
  const result = safeParseResult<Agent5Result>(rawResult);
  if (!result) return <RawFallback raw={rawResult} />;

  const biomarkers = Array.isArray(result.contextualizedBiomarkers) ? result.contextualizedBiomarkers : [];

  return (
    <div className="space-y-4 text-slate-800 dark:text-slate-200">
      {result.message && (
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30">
          {result.message}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {biomarkers.map((b, idx) => {
          const isAtRisk = b.status?.toLowerCase() === 'at risk';
          return (
            <div 
              key={idx} 
              className={`p-4 rounded-2xl border transition-all ${
                isAtRisk 
                  ? 'bg-rose-50/40 dark:bg-rose-950/10 border-rose-100 dark:border-rose-900/30 shadow-sm shadow-rose-100/10' 
                  : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono">
                    {b.name}
                  </h5>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {b.userValue}
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      (Adjusted: {b.profileAdjustedNormalRange})
                    </span>
                  </div>
                </div>

                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                  isAtRisk 
                    ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200/50 dark:border-rose-900/40' 
                    : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/40'
                }`}>
                  {isAtRisk ? <ShieldAlert className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                  {b.status || (isAtRisk ? 'At Risk' : 'Healthy')}
                </span>
              </div>

              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed mb-2.5">
                {b.description}
              </p>

              {b.specificRiskContext && (
                <div className={`p-2.5 rounded-xl text-[10px] leading-relaxed ${
                  isAtRisk 
                    ? 'bg-rose-100/50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200/30 dark:border-rose-900/20' 
                    : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300'
                }`}>
                  <span className="font-bold block mb-0.5">Demographic Risk Context:</span>
                  {b.specificRiskContext}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Agent6View: React.FC<{ rawResult: any }> = ({ rawResult }) => {
  const result = safeParseResult<Agent6Result>(rawResult);
  if (!result) return <RawFallback raw={rawResult} />;

  const nutrientTargets = result.nutrientTargets || {};
  const nutrientKeys = Object.keys(nutrientTargets);
  const checklist = Array.isArray(result.activityChecklist) ? result.activityChecklist : [];
  const projections = Array.isArray(result.projections) ? result.projections : [];

  const getNutrientIcon = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('calor')) return <Flame className="w-4 h-4 text-orange-500" />;
    if (k.includes('protein')) return <Dumbbell className="w-4 h-4 text-blue-500" />;
    if (k.includes('fibre') || k.includes('fiber') || k.includes('carb')) return <Apple className="w-4 h-4 text-emerald-500" />;
    if (k.includes('sodium') || k.includes('salt')) return <Droplet className="w-4 h-4 text-teal-500" />;
    return <Scale className="w-4 h-4 text-slate-500" />;
  };

  return (
    <div className="space-y-5 text-slate-800 dark:text-slate-200">
      {result.message && (
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30">
          {result.message}
        </p>
      )}

      {nutrientKeys.length > 0 && (
        <div className="space-y-2.5">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <Apple className="w-3.5 h-3.5 text-emerald-500" />
            Precision Nutrition Allowances
          </h5>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {nutrientKeys.map((key) => {
              const target = nutrientTargets[key];
              return (
                <div key={key} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="capitalize text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      {getNutrientIcon(key)}
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100/50 dark:border-indigo-900/30 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 rounded-full font-mono">
                      {target.value} {target.unit}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {target.reason}
                  </p>
                  {target.duration && (
                    <div className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-950 px-2 py-0.5 rounded-md inline-block">
                      Duration: {target.duration}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {checklist.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 text-indigo-500" />
            Prescribed Movement Protocol
          </h5>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm">
            {checklist.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                  </div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {item.habit}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-lg">
                  {item.target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {projections.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
            Biological Projections & Timelines
          </h5>
          <div className="bg-blue-50/10 dark:bg-blue-950/5 border border-blue-100/50 dark:border-blue-900/20 rounded-2xl p-4 space-y-2">
            {projections.map((p, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <ChevronRight className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const Agent7View: React.FC<{ rawResult: any }> = ({ rawResult }) => {
  const result = safeParseResult<Agent7Result>(rawResult);
  if (!result) return <RawFallback raw={rawResult} />;

  const insights = Array.isArray(result.insights) ? result.insights : [];

  return (
    <div className="space-y-4 text-slate-800 dark:text-slate-200">
      {result.message && (
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30">
          {result.message}
        </p>
      )}

      <div className="flex items-center justify-between py-1 bg-slate-100 dark:bg-slate-800/80 px-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
        <span className="text-[10px] font-mono font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          Scientific Database Search
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-indigo-950 dark:text-indigo-100 bg-indigo-100 dark:bg-indigo-900/95 px-2 py-0.5 rounded-full">
          <BookOpen className="w-3 h-3" />
          {insights.length} {insights.length === 1 ? 'article' : 'articles'} found
        </span>
      </div>

      <div className="space-y-3">
        {insights.map((item, idx) => (
          <div 
            key={idx} 
            className="p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm space-y-3 hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <h5 className="font-bold text-xs text-slate-900 dark:text-slate-100 leading-snug">
                {item.title}
              </h5>
              <span className="text-[9px] font-mono text-slate-400 font-semibold uppercase shrink-0 px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-900">
                Pub. {idx + 1}
              </span>
            </div>

            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-100/50 dark:border-slate-900/10">
              {item.summary}
            </p>

            {item.link && (
              <a 
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:underline px-2 py-1 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-lg border border-indigo-100/20 dark:border-indigo-900/10 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                Read Publication on PubMed
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const RawFallback: React.FC<{ raw: any }> = ({ raw }) => {
  const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  return (
    <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
      {content}
    </pre>
  );
};
