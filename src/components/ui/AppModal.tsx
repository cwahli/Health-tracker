import React, { useEffect, useRef, ReactNode } from 'react';
import { t } from '../../utils/i18n';

export interface AppModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  ariaLabel?: string;
  language?: string;
  testId?: string;
}

export function AppModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  actions,
  size = 'md',
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
  bodyClassName = '',
  headerClassName = '',
  footerClassName = '',
  ariaLabel,
  language,
  testId = 'app-modal',
}: AppModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    full: 'max-w-5xl',
  }[size];

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || (typeof title === 'string' ? title : t(language, 'modalDialog'))}
      data-testid={testId}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full ${sizeClasses} flex flex-col max-h-[90vh] overflow-hidden transition-all transform animate-in zoom-in-95 duration-150 ${className}`}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div
            className={`flex items-start justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0 ${headerClassName}`}
          >
            <div>
              {title && (
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                data-testid={`${testId}-close-btn`}
                onClick={onClose}
                aria-label={t(language, 'closeDialog')}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-auto cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body Content */}
        <div className={`px-5 py-4 overflow-y-auto flex-1 ${bodyClassName}`}>
          {children}
        </div>

        {/* Footer Actions */}
        {actions && (
          <div
            className={`px-5 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-end gap-2 shrink-0 ${footerClassName}`}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default AppModal;
