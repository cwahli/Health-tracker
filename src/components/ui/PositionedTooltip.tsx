import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface PositionedTooltipProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  contentClassName?: string;
  arrowClassName?: string;
}

export const PositionedTooltip: React.FC<PositionedTooltipProps> = ({ 
  trigger, 
  content, 
  contentClassName = 'bg-slate-900/95 dark:bg-slate-800/95 text-white border-slate-700/80',
  arrowClassName = 'border-t-slate-900 dark:border-t-slate-800 border-b-slate-900 dark:border-b-slate-800'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    isAbove: boolean;
    arrowLeft: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }

    const updatePos = () => {
      if (!buttonRef.current) return;
      const btnRect = buttonRef.current.getBoundingClientRect();

      let tooltipWidth = 280;
      let tooltipHeight = 120;
      if (tooltipRef.current) {
        const tr = tooltipRef.current.getBoundingClientRect();
        if (tr.width > 0) tooltipWidth = tr.width;
        if (tr.height > 0) tooltipHeight = tr.height;
      }

      const padding = 12;
      const gap = 8;

      const spaceAbove = btnRect.top;
      const spaceBelow = window.innerHeight - btnRect.bottom;

      let isAbove = true;
      if (spaceAbove >= tooltipHeight + gap + padding) {
        isAbove = true;
      } else if (spaceBelow >= tooltipHeight + gap + padding) {
        isAbove = false;
      } else {
        isAbove = spaceAbove >= spaceBelow;
      }

      let top = isAbove ? btnRect.top - tooltipHeight - gap : btnRect.bottom + gap;
      top = Math.max(padding, Math.min(window.innerHeight - tooltipHeight - padding, top));

      const btnCenterX = btnRect.left + btnRect.width / 2;
      let left = btnCenterX - tooltipWidth / 2;
      left = Math.max(padding, Math.min(window.innerWidth - tooltipWidth - padding, left));

      const arrowLeft = Math.max(16, Math.min(tooltipWidth - 16, btnCenterX - left));

      setCoords({ top, left, isAbove, arrowLeft });
    };

    updatePos();
    const timer = setTimeout(updatePos, 10);

    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen, content]);

  const arrowClasses = coords?.isAbove
    ? `top-full -mt-0.5 border-t-[currentColor] ${arrowClassName}`
    : `bottom-full -mb-0.5 border-b-[currentColor] ${arrowClassName}`;
    
  return (
    <span className="relative inline-block align-middle">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className="inline-flex items-center justify-center p-0 bg-transparent border-none outline-none cursor-pointer focus:outline-none"
      >
        {trigger}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`fixed p-3 backdrop-blur text-[11px] font-normal leading-relaxed rounded-xl shadow-2xl border z-[99999] pointer-events-none transition-opacity duration-150 block text-left w-72 sm:w-80 ${contentClassName}`}
            style={{
              top: coords ? `${coords.top}px` : '-9999px',
              left: coords ? `${coords.left}px` : '-9999px',
              opacity: coords ? 1 : 0,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
            }}
          >
            {content}
            {coords && (
              <span
                className={`absolute border-4 border-transparent ${
                  coords.isAbove
                    ? `top-full -mt-0.5 ${arrowClassName.split(' ').filter(c => c.startsWith('border-t-') || c.startsWith('dark:border-t-')).join(' ')}`
                    : `bottom-full -mb-0.5 ${arrowClassName.split(' ').filter(c => c.startsWith('border-b-') || c.startsWith('dark:border-b-')).join(' ')}`
                }`}
                style={{ left: `${coords.arrowLeft}px`, transform: 'translateX(-50%)' }}
              />
            )}
          </div>,
          document.body
        )}
    </span>
  );
};
