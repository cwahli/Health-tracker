import React, { useRef, useState } from 'react';
import { resolveNextPhotoUrl } from '../utils/foodImageSources';

interface PreviousMealThumbnailProps {
  src: string;
  alt: string;
  /** Shown instead of the image once every fallback has been exhausted */
  fallbackLabel: string;
}

/**
 * Thumbnail for a "previous meal" quick-add search match. R2 photo URLs can
 * expire or go private after the fact, which previously showed a permanently
 * broken image icon here (unlike ImageSlider, which already self-heals via
 * resolveNextPhotoUrl). This gives the same retry behavior to this smaller,
 * non-slider display spot instead of duplicating the retry logic inline.
 */
export default function PreviousMealThumbnail({ src, alt, fallbackLabel }: PreviousMealThumbnailProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [broken, setBroken] = useState(false);
  const tried = useRef<Set<string>>(new Set());

  const handleError = async () => {
    tried.current.add(currentSrc);
    const next = await resolveNextPhotoUrl(src, currentSrc, tried.current);
    if (next) {
      tried.current.add(next);
      setCurrentSrc(next);
      return;
    }
    setBroken(true);
  };

  if (broken) {
    return (
      <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-500 font-bold text-xs shrink-0">
        {fallbackLabel.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className="w-8 h-8 rounded-lg object-cover border border-slate-100 dark:border-slate-700 shrink-0"
      referrerPolicy="no-referrer"
      onError={handleError}
    />
  );
}
