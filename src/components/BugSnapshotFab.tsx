import React from 'react';
import { Bug } from 'lucide-react';

export interface BugSnapshotFabProps {
  isAdmin?: boolean;
  firebaseUid?: string | null;
  activeTab?: string;
  viewingJobId?: string | null;
  biomarkerHistory?: any[];
  biomarkers?: any;
  profile?: any;
  getModalContext?: () => any;
  [key: string]: any;
}

export function BugSnapshotFab({ isAdmin }: BugSnapshotFabProps) {
  if (!isAdmin) return null;

  return (
    <button
      type="button"
      title="Capture Bug Snapshot"
      className="fixed bottom-24 right-5 z-40 w-10 h-10 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-lg transition-all"
    >
      <Bug className="w-5 h-5" />
    </button>
  );
}

export function BugSnapshotSettingsToggle() {
  return (
    <div className="text-xs text-slate-500">
      Bug Snapshot Enabled
    </div>
  );
}

export default BugSnapshotFab;
