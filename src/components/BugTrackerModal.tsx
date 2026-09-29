import { useBugBoard } from './bug-board/useBugBoard';
import { BugBoard } from './bug-board/BugBoard';

interface BugTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewJob?: (jobId: string) => void;
  language?: string;
}

export default function BugTrackerModal({ isOpen, onClose, onViewJob, language }: BugTrackerModalProps) {
  const board = useBugBoard({ isOpen, language });
  if (!isOpen) return null;
  return <BugBoard {...board} onClose={onClose} onViewJob={onViewJob} language={language} />;
}
