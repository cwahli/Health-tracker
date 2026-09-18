import React from 'react';

export interface AgentResultTableProps {
  agentType?: string;
  agentResult?: any;
  profile?: any;
  biomarkerHistory?: any[];
  onSendMessage?: (msg: string) => void;
  [key: string]: any;
}

export function AgentResultTable({
  agentType,
  agentResult,
  profile,
  ...props
}: AgentResultTableProps) {
  if (!agentResult) return null;

  const rows = Array.isArray(agentResult)
    ? agentResult
    : Array.isArray(agentResult?.entries)
    ? agentResult.entries
    : Array.isArray(agentResult?.biomarkers)
    ? agentResult.biomarkers
    : [];

  if (rows.length === 0) {
    return (
      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs text-slate-500">
        No tabular biomarker data found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 uppercase tracking-wider">
          <tr>
            <th className="p-2.5">Marker / Date</th>
            <th className="p-2.5">Value</th>
            <th className="p-2.5">Unit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((row: any, i: number) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="p-2.5 font-medium">{row.key || row.name || row.date || `Entry ${i + 1}`}</td>
              <td className="p-2.5">{String(row.value ?? row.val ?? '-')}</td>
              <td className="p-2.5">{row.unit || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AgentResultTable;
