import React from 'react';

export interface FilterPillItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  activeColorClass?: string;
}

export interface FilterPillsProps<T extends string = string> {
  items: FilterPillItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  className?: string;
}

export function FilterPills<T extends string = string>({
  items,
  activeId,
  onChange,
  ariaLabel = 'Filter options',
  className = '',
}: FilterPillsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 p-1 rounded-lg bg-slate-200/60 dark:bg-slate-800/80 ${className}`}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const activeClass = item.activeColorClass || 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-semibold';
        const inactiveClass = 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/40 dark:hover:bg-slate-700/50';

        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(item.id)}
            className={`px-2.5 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${
              isActive ? activeClass : inactiveClass
            }`}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isActive
                    ? 'bg-black/20 text-white'
                    : 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FilterPills;
