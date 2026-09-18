import React from 'react';
import { translations } from '../utils/translations';
import { AnimatePresence, motion } from 'motion/react';

interface FloatingActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onLogMeal: () => void;
  onCompareMeal: () => void;
  onHealthInfo: () => void;
  language?: string;
}

export default function FloatingActionSheet({
  isOpen,
  onClose,
  onLogMeal,
  onCompareMeal,
  onHealthInfo,
  language,
}: FloatingActionSheetProps) {
  const t = translations[language || 'en'] || translations.en;

  // Preload LogChat the instant the sheet opens so clicking any button opens the modal with 0ms delay
  React.useEffect(() => {
    if (isOpen) {
      import('./LogChat').catch(() => {});
    }
  }, [isOpen]);
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950 z-40 transition-opacity"
          />

          {/* Sheet Container */}
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm z-50 p-1"
          >
            <div className="grid grid-cols-3 gap-3">
              {/* Log Meal */}
              <button
                id="quick-action-log-meal"
                onClick={() => {
                  onLogMeal();
                  onClose();
                }}
                className="flex items-center justify-center py-3.5 px-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-600/20 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
              >
                {t.logMeal || "Log Meal"}
              </button>

              {/* Compare Meal */}
              <button
                id="quick-action-compare-meal"
                onClick={() => {
                  onCompareMeal();
                  onClose();
                }}
                className="flex items-center justify-center py-3.5 px-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-600/20 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
              >
                {t.compareShort || "Compare"}
              </button>

              {/* Health Info */}
              <button
                onClick={() => {
                  onHealthInfo();
                  onClose();
                }}
                className="flex items-center justify-center py-3.5 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-600/20 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
              >
                {t.healthInfo || "Health Info"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
