import React, { useState, useRef } from 'react';

export interface PositionedTooltipProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  contentClassName?: string;
  className?: string;
}

export function PositionedTooltip({
  trigger,
  content,
  contentClassName = '',
  className = '',
}: PositionedTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      <div className="inline-flex items-center">{trigger}</div>
      {isVisible && content && (
        <div
          role="tooltip"
          className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 px-2.5 py-1.5 text-xs rounded-lg shadow-lg border pointer-events-none whitespace-normal max-w-xs ${
            contentClassName || 'bg-slate-900/95 text-white border-slate-700/80'
          }`}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export default PositionedTooltip;
