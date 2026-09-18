import React from 'react';
import { formatOptimalTargetValue } from '../utils/agentCalibration';
import { 
  Sparkles, 
  BookOpen, 
  Apple, 
  TrendingUp, 
  CheckCircle2, 
  ChevronRight,
  ClipboardList,
  ExternalLink
} from 'lucide-react';



const getNutrientIcon = (key: string) => {
  return <Apple className="w-3.5 h-3.5 text-emerald-500" />;
};

const safeParseResult = <T,>(rawResult: any): T | null => {
  if (!rawResult) return null;
  if (typeof rawResult === 'object') return rawResult as T;
  try {
    const cleaned = rawResult.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error('Failed to parse agent result JSON', e, rawResult);
    return null;
  }
};

const RawFallback: React.FC<{ raw: any }> = ({ raw }) => {
  const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  return (
    <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
      {content}
    </pre>
  );
};

export const GenericAgentResultView: React.FC<{ rawResult: any }> = ({ rawResult }) => {
  const result = safeParseResult<any>(rawResult);
  if (!result) return <RawFallback raw={rawResult} />;

  const {
    message,
    contextualizedBiomarkers,
    nutrientTargets,
    activityChecklist,
    projections,
    insights
  } = result;

  return (
    <div className="space-y-4 text-slate-800 dark:text-slate-200">
      {message && (
        <p className="text-xs text-theme-text-secondary leading-relaxed bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30">
          {message}
        </p>
      )}

      {/* Agent 5: Contextualized Biomarkers */}
      {contextualizedBiomarkers && Array.isArray(contextualizedBiomarkers) && contextualizedBiomarkers.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            Contextualized Normal Ranges
          </h5>
          <div className="overflow-x-auto bg-theme-bg-card border border-theme-border rounded-2xl shadow-sm">
            <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left">
              <thead className="bg-theme-bg">
                <tr>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Biomarker</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Your Value</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Optimal Value / Range</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Status</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {contextualizedBiomarkers.map((bm, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/30 transition-colors">
                    <td className="px-4 py-3.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                      {bm.name}
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                      {bm.userValue}
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap">
                      {formatOptimalTargetValue(bm)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        bm.status?.toLowerCase() === 'healthy' || bm.status?.toLowerCase() === 'optimal'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {bm.status || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-theme-text-secondary max-w-sm md:max-w-md break-words leading-relaxed">
                      {bm.description}
                      {bm.specificRiskContext && (
                        <div className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-100/50 dark:border-amber-900/20">
                          {bm.specificRiskContext}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agent 6: Precision Nutrition Allowances */}
      {nutrientTargets && Object.keys(nutrientTargets).length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <Apple className="w-3.5 h-3.5 text-emerald-500" />
            Precision Nutrition Allowances
          </h5>
          <div className="overflow-x-auto bg-theme-bg-card border border-theme-border rounded-2xl shadow-sm">
            <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left">
              <thead className="bg-theme-bg">
                <tr>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Nutrient</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Allowance Target</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Clinical Rationale</th>
                  <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-theme-text-secondary">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {Object.keys(nutrientTargets).map((key) => {
                  const target = nutrientTargets[key];
                  return (
                    <tr key={key} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/30 transition-colors">
                      <td className="px-4 py-3.5 text-xs font-bold text-slate-800 dark:text-slate-200 capitalize whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {getNutrientIcon(key)}
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                        {target.value} {target.unit}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-theme-text-secondary max-w-sm md:max-w-md break-words">
                        {target.reason}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-500 font-mono whitespace-nowrap">
                        {target.duration || 'Continuous'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agent 6: Prescribed Movement Protocol */}
      {activityChecklist && Array.isArray(activityChecklist) && activityChecklist.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 text-indigo-500" />
            Prescribed Movement Protocol
          </h5>
          <div className="bg-theme-bg-card rounded-2xl border border-theme-border p-4 divide-y divide-slate-100 dark:divide-slate-800 shadow-sm">
            {activityChecklist.map((item: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                  </div>
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {item.habit}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-theme-text-secondary px-2 py-0.5 rounded-lg">
                  {item.target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent 6: Biological Projections */}
      {projections && Array.isArray(projections) && projections.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
            Biological Projections & Timelines
          </h5>
          <div className="bg-indigo-50/10 dark:bg-indigo-950/5 border border-indigo-100/50 dark:border-indigo-900/20 rounded-2xl p-4 space-y-2">
            {projections.map((p: any, idx: number) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-theme-neutral leading-relaxed">
                <ChevronRight className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent 7: Scientific Database Search */}
      {insights && Array.isArray(insights) && insights.length > 0 && (
        <>
          <div className="flex items-center justify-between py-1 bg-slate-100 dark:bg-slate-800/80 px-3 rounded-xl border border-theme-border/60">
            <span className="text-[10px] font-mono font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Scientific Database Search
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-indigo-950 dark:text-indigo-100 bg-indigo-100 dark:bg-indigo-900/95 px-2 py-0.5 rounded-full">
              <BookOpen className="w-3 h-3" />
              {insights.length} {insights.length === 1 ? 'article' : 'articles'} found
            </span>
          </div>
          <div className="space-y-3">
            {insights.map((item: any, idx: number) => (
              <div 
                key={idx} 
                className="p-4 bg-theme-bg-card border border-theme-border rounded-2xl shadow-sm space-y-3 hover:border-slate-200 dark:hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <h5 className="font-bold text-xs text-theme-text leading-snug">
                    {item.title}
                  </h5>
                  <span className="text-[9px] font-mono text-slate-400 font-semibold uppercase shrink-0 px-1.5 py-0.5 rounded bg-theme-bg border border-slate-100 dark:border-slate-900">
                    Pub. {idx + 1}
                  </span>
                </div>
                <p className="text-[10px] text-theme-text-secondary leading-relaxed bg-theme-bg p-2.5 rounded-xl border border-slate-100/50 dark:border-slate-900/10">
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
        </>
      )}

    </div>
  );
};
