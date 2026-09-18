import React from 'react';
import { t } from '../../utils/i18n';

export interface FilterPillItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  count?: number;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  activeColorClass?: string;
  testId?: string;
}

export interface FilterPillsProps<T extends string = string> {
  items: FilterPillItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
  containerClassName?: string;
  pillClassName?: string;
  size?: 'xs' | 'sm' | 'md';
  ariaLabel?: string;
  language?: string;
}

export function FilterPills<T extends string = string>({
  items,
  activeId,
  onChange,
  className = '',
  containerClassName = '',
  pillClassName = '',
  size = 'sm',
  ariaLabel,
  language,
}: FilterPillsProps<T>) {
  const resolvedAriaLabel = ariaLabel || t(language, 'filterOptions');
  const sizeClasses = {
    xs: 'px-2.5 py-1 text-[11px]',
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  }[size];

  return (
    <div
      role="tablist"
      aria-label={resolvedAriaLabel}
      className={`flex items-center gap-1 p-1 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/80 shadow-xs ${containerClassName}`}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const defaultActiveColor = 'bg-amber-500 text-white shadow-xs';
        const activeColor = item.activeColorClass || defaultActiveColor;
        const inactiveColor =
          'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60';

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={item.testId || `filter-pill-${item.id}`}
            onClick={() => onChange(item.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg font-bold transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-amber-500/40 ${sizeClasses} ${
              isActive ? activeColor : inactiveColor
            } ${pillClassName} ${className}`}
          >
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isActive
                    ? 'bg-black/20 text-white'
                    : 'bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {item.count}
              </span>
            )}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

export default FilterPills;
