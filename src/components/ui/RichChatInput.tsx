import React, { useRef, useEffect, useCallback } from 'react';

export interface RichChatInputProps {
  html: string;
  onChange: (html: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onTagClick?: (tagId: string, dbId: string, name: string, weight: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const RichChatInput: React.FC<RichChatInputProps> = ({
  html,
  onChange,
  onKeyDown,
  onTagClick,
  placeholder,
  className,
  disabled
}) => {
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const lastHtml = useRef(html);

  useEffect(() => {
    if (contentEditableRef.current && html !== lastHtml.current) {
      // Save cursor position
      const selection = window.getSelection();
      let cursorOffset = 0;
      let currentNode = null;
      if (selection && selection.rangeCount > 0 && contentEditableRef.current.contains(selection.anchorNode)) {
        // Simple cursor saving for demo purposes - full implementation requires walking the DOM
        // Since we mainly append tags, we can just let it reset or append safely.
      }
      
      contentEditableRef.current.innerHTML = html;
      lastHtml.current = html;
      
      // Place cursor at end if needed
      if (html && html.length > 0 && document.activeElement === contentEditableRef.current) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(contentEditableRef.current);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [html]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const newHtml = e.currentTarget.innerHTML;
    lastHtml.current = newHtml;
    onChange(newHtml);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tag = target.closest('.inline-food-tag') as HTMLElement;
    if (tag && onTagClick) {
      const tagId = tag.getAttribute('data-tag-id');
      const dbId = tag.getAttribute('data-db-id');
      const name = tag.getAttribute('data-name');
      const weight = tag.getAttribute('data-weight');
      if (tagId && dbId && name && weight) {
        onTagClick(tagId, dbId, name, parseFloat(weight));
      }
    }
  };

  return (
    <div
      ref={contentEditableRef}
      contentEditable={!disabled}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onClick={handleClick}
      onCompositionStart={() => (isComposing.current = true)}
      onCompositionEnd={() => (isComposing.current = false)}
      className={`${className} empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400`}
      data-placeholder={placeholder}
      style={{ outline: 'none' }}
    />
  );
};
