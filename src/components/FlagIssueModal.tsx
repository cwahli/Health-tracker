import React, { useState } from 'react';
import { X } from 'lucide-react';

export interface FlagIssueFormProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  getPayload?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  chainKey?: string;
  dishQuery?: string;
  countryCode?: string;
  firebaseUid?: string;
  sessionId?: string;
  initialCategory?: string;
  onSuccess?: (id: string) => void;
}

export function FlagIssueModal({
  isOpen,
  onClose,
  title = 'Flag Issue',
  onSuccess
}: FlagIssueFormProps) {
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (onSuccess) {
        onSuccess(`issue_${Date.now()}`);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">
          {title}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue..."
            rows={4}
            className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FlagIssueModal;
