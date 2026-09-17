import React from 'react';
import { Database, Download, Upload } from 'lucide-react';

export interface BackupRestoreTabProps {
  profile?: any;
  foodLogs?: any[];
  biomarkerHistory?: any[];
  onRestore?: (data: any) => void;
  [key: string]: any;
}

export default function BackupRestoreTab({
  profile,
  foodLogs = [],
  biomarkerHistory = []
}: BackupRestoreTabProps) {
  const handleExport = () => {
    const backup = {
      profile,
      foodLogs,
      biomarkerHistory,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
        <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-500" />
          Backup & Restore
        </h4>
        <p className="text-slate-500 dark:text-slate-400">
          Export your complete nutritional logs, biomarker timeline, and profile settings to a local JSON file.
        </p>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-all"
          >
            <Download className="w-4 h-4" />
            Export Backup
          </button>
        </div>
      </div>
    </div>
  );
}
