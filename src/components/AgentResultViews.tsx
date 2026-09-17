import React from 'react';

export interface GenericAgentResultViewProps {
  rawResult?: any;
}

export function GenericAgentResultView({ rawResult }: GenericAgentResultViewProps) {
  if (!rawResult) return null;

  if (typeof rawResult === 'string') {
    return (
      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs whitespace-pre-wrap">
        {rawResult}
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs space-y-2">
      {rawResult.title && <h5 className="font-semibold text-slate-900 dark:text-slate-100">{rawResult.title}</h5>}
      {rawResult.summary && <p className="text-slate-600 dark:text-slate-300">{rawResult.summary}</p>}
      {rawResult.recommendations && Array.isArray(rawResult.recommendations) && (
        <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300">
          {rawResult.recommendations.map((rec: any, idx: number) => (
            <li key={idx}>{typeof rec === 'string' ? rec : rec.text || JSON.stringify(rec)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default GenericAgentResultView;
