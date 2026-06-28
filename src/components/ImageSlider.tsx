import React, { useState, useEffect, useRef } from 'react';
import { ImageIcon, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageSliderProps {
  images?: string[];
  singleImage?: string;
  altText: string;
}

export default function ImageSlider({ images = [], singleImage, altText }: ImageSliderProps) {
  const allImages = Array.isArray(images) ? [...images] : [];
  if (singleImage && !allImages.includes(singleImage)) {
    allImages.unshift(singleImage);
  }

  const [orientations, setOrientations] = useState<Record<string, 'portrait' | 'landscape'>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  
  // Full screen viewer states
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const viewerScrollContainerRef = useRef<HTMLDivElement>(null);

  // Mouse Drag To Scroll (Slick Slider effect) for main slider
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  // Mouse Drag To Scroll (Slick Slider effect) for fullscreen slider
  const isViewerDownRef = useRef(false);
  const viewerStartXRef = useRef(0);
  const viewerScrollLeftRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    isDownRef.current = true;
    scrollContainerRef.current.style.scrollBehavior = 'auto'; // Disable snap behavior during drag for smooth feel
    startXRef.current = e.pageX - scrollContainerRef.current.offsetLeft;
    scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
  };

  const handleMouseLeave = () => {
    if (isDownRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.style.scrollBehavior = 'smooth';
    }
    isDownRef.current = false;
  };

  const handleMouseUp = () => {
    if (isDownRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.style.scrollBehavior = 'smooth';
    }
    isDownRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDownRef.current || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5; // Drag sensitivity
    scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  // Fullscreen slider mouse drag handlers
  const handleViewerMouseDown = (e: React.MouseEvent) => {
    if (!viewerScrollContainerRef.current) return;
    isViewerDownRef.current = true;
    viewerScrollContainerRef.current.style.scrollBehavior = 'auto';
    viewerStartXRef.current = e.pageX - viewerScrollContainerRef.current.offsetLeft;
    viewerScrollLeftRef.current = viewerScrollContainerRef.current.scrollLeft;
  };

  const handleViewerMouseLeave = () => {
    if (isViewerDownRef.current && viewerScrollContainerRef.current) {
      viewerScrollContainerRef.current.style.scrollBehavior = 'smooth';
    }
    isViewerDownRef.current = false;
  };

  const handleViewerMouseUp = () => {
    if (isViewerDownRef.current && viewerScrollContainerRef.current) {
      viewerScrollContainerRef.current.style.scrollBehavior = 'smooth';
    }
    isViewerDownRef.current = false;
  };

  const handleViewerMouseMove = (e: React.MouseEvent) => {
    if (!isViewerDownRef.current || !viewerScrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - viewerScrollContainerRef.current.offsetLeft;
    const walk = (x - viewerStartXRef.current) * 1.5;
    viewerScrollContainerRef.current.scrollLeft = viewerScrollLeftRef.current - walk;
  };

  useEffect(() => {
    allImages.forEach((img) => {
      if (!img || orientations[img]) return;
      const imgObj = new Image();
      imgObj.onload = () => {
        const isPortrait = imgObj.naturalHeight > imgObj.naturalWidth;
        setOrientations((prev) => ({
          ...prev,
          [img]: isPortrait ? 'portrait' : 'landscape',
        }));
      };
      imgObj.src = img;
    });
  }, [allImages]);

  const handleImageError = (img: string) => {
    setBrokenImages((prev) => ({
      ...prev,
      [img]: true,
    }));
  };

  // Scroll smooth to fullscreen slide index
  const scrollViewerToSlide = (index: number, behavior: 'smooth' | 'auto' = 'smooth') => {
    if (!viewerScrollContainerRef.current) return;
    const container = viewerScrollContainerRef.current;
    const slides = container.children;
    if (slides && slides[index]) {
      const slide = slides[index] as HTMLElement;
      container.scrollTo({
        left: slide.offsetLeft - container.offsetLeft,
        behavior
      });
      setViewerIndex(index);
    }
  };

  const handleNext = () => {
    if (viewerIndex === null) return;
    const nextIndex = viewerIndex === allImages.length - 1 ? 0 : viewerIndex + 1;
    scrollViewerToSlide(nextIndex, 'smooth');
  };

  const handlePrev = () => {
    if (viewerIndex === null) return;
    const prevIndex = viewerIndex === 0 ? allImages.length - 1 : viewerIndex - 1;
    scrollViewerToSlide(prevIndex, 'smooth');
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchStartX - touchEndX;

    if (Math.abs(diffX) > 50) { // 50px swipe threshold
      if (diffX > 0) {
        handleNext();
      } else {
        handlePrev();
      }
    }
    setTouchStartX(null);
  };

  // Sync fullscreen slide position when viewer mounts on active item
  useEffect(() => {
    if (viewerIndex !== null && viewerScrollContainerRef.current) {
      const timer = setTimeout(() => {
        scrollViewerToSlide(viewerIndex, 'auto');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewerIndex !== null]);

  // Keep state updated on manual scroll in fullscreen container
  const handleViewerContainerScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const slides = container.children;
    if (!slides || slides.length === 0) return;

    let minDiff = Infinity;
    let closestIndex = 0;
    const containerLeft = container.scrollLeft;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i] as HTMLElement;
      const slideLeft = slide.offsetLeft - container.offsetLeft;
      const diff = Math.abs(slideLeft - containerLeft);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }
    if (closestIndex !== viewerIndex && viewerIndex !== null) {
      setViewerIndex(closestIndex);
    }
  };

  // Scroll smooth to index
  const scrollToSlide = (index: number) => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const slides = container.children;
    if (slides && slides[index]) {
      const slide = slides[index] as HTMLElement;
      container.scrollTo({
        left: slide.offsetLeft - container.offsetLeft,
        behavior: 'smooth'
      });
      setActiveIndex(index);
    }
  };

  const slideNext = () => {
    const nextIndex = activeIndex === allImages.length - 1 ? 0 : activeIndex + 1;
    scrollToSlide(nextIndex);
  };

  const slidePrev = () => {
    const prevIndex = activeIndex === 0 ? allImages.length - 1 : activeIndex - 1;
    scrollToSlide(prevIndex);
  };

  const handleContainerScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const slides = container.children;
    if (!slides || slides.length === 0) return;

    // Find which slide is closest to the left edge of the container
    let minDiff = Infinity;
    let closestIndex = 0;
    const containerLeft = container.scrollLeft;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i] as HTMLElement;
      const slideLeft = slide.offsetLeft - container.offsetLeft;
      const diff = Math.abs(slideLeft - containerLeft);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }
    if (closestIndex !== activeIndex) {
      setActiveIndex(closestIndex);
    }
  };

  // Listen for escape & arrow keys when fullscreen viewer is open
  useEffect(() => {
    if (viewerIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewerIndex(null);
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewerIndex]);

  if (allImages.length === 0) {
    return (
      <div className="w-full h-44 bg-slate-100 dark:bg-slate-950 flex flex-col items-center justify-center text-slate-400 rounded-2xl">
        <ImageIcon className="w-8 h-8 mb-1.5 opacity-60" />
        <span className="text-[10px] font-medium">No images available</span>
      </div>
    );
  }

  return (
    <div className="w-full relative group">
      {/* Scrollable Container with Smooth Scroll Snap */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        className="w-full flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none p-1.5 bg-slate-50 dark:bg-slate-950/30 rounded-2xl scroll-smooth cursor-grab active:cursor-grabbing select-none"
      >
        {allImages.map((img, idx) => {
          const orientation = orientations[img] || 'landscape';
          const isPortrait = orientation === 'portrait';
          const isBroken = brokenImages[img];

          return (
            <div
              key={idx}
              onClick={() => {
                if (!isBroken) {
                  setViewerIndex(idx);
                }
              }}
              className={`snap-start snap-always shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-900 flex flex-col items-center justify-center relative transition-all duration-300 min-h-[200px] ${
                isBroken ? '' : 'cursor-zoom-in'
              } ${
                allImages.length === 1 
                  ? 'w-full aspect-[16/10]' 
                  : isPortrait 
                    ? 'w-[200px] xs:w-[240px] aspect-[3/4]' 
                    : 'w-[260px] xs:w-[320px] aspect-[16/10]'
              }`}
            >
              {isBroken ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-100 dark:bg-slate-950 p-4 text-center">
                  <ImageIcon className="w-6 h-6 mb-1 text-rose-400 dark:text-rose-500 opacity-80" />
                  <span className="text-[9px] font-medium leading-tight">Image format unsupported<br/>or file corrupted</span>
                </div>
              ) : (
                <img
                  src={img}
                  alt={`${altText} - image ${idx + 1}`}
                  className="w-full h-full object-cover select-none hover:scale-105 transition-transform duration-300"
                  referrerPolicy="no-referrer"
                  onError={() => handleImageError(img)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Slick Sliding Navigation Arrows */}
      {allImages.length > 1 && (
        <>
          <button
            type="button"
            onClick={slidePrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-800/50 text-slate-700 dark:text-slate-300 shadow-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer focus:opacity-100 z-10"
            title="Previous image"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={slideNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 border border-slate-200/50 dark:border-slate-800/50 text-slate-700 dark:text-slate-300 shadow-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer focus:opacity-100 z-10"
            title="Next image"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}

      {/* Indicator Dots */}
      {allImages.length > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-2">
          {allImages.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => scrollToSlide(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === activeIndex 
                  ? 'w-5 bg-indigo-600 dark:bg-indigo-500' 
                  : 'w-1.5 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600'
              }`}
              title={`Go to image ${idx + 1}`}
            />
          ))}
        </div>
      )}

      {/* Fullscreen Modal Image Viewer with Slick Slider drag & swipe capability */}
      {viewerIndex !== null && (
        <div 
          className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-950/95 backdrop-blur-md select-none"
        >
          {/* Top header controls */}
          <div className="w-full px-5 py-4 flex items-center justify-between text-white z-55 bg-gradient-to-b from-slate-950/80 to-transparent">
            <span className="text-xs font-mono bg-slate-900/60 px-3 py-1.5 rounded-full border border-slate-800/80 backdrop-blur-sm">
              {viewerIndex + 1} / {allImages.length}
            </span>
            <button
              type="button"
              onClick={() => setViewerIndex(null)}
              className="p-2 rounded-full bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 text-white transition-colors cursor-pointer"
              title="Close image viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Slider Container holding all images for smooth sliding */}
          <div className="flex-1 relative w-full h-full min-h-0">
            {/* Previous button */}
            {allImages.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 text-white transition-colors hidden sm:flex items-center justify-center cursor-pointer z-55"
                title="Previous image"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* Slick Slider Scroll Body */}
            <div
              ref={viewerScrollContainerRef}
              onScroll={handleViewerContainerScroll}
              onMouseDown={handleViewerMouseDown}
              onMouseLeave={handleViewerMouseLeave}
              onMouseUp={handleViewerMouseUp}
              onMouseMove={handleViewerMouseMove}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              className="w-full h-full flex overflow-x-auto snap-x snap-mandatory scrollbar-none scroll-smooth cursor-grab active:cursor-grabbing"
            >
              {allImages.map((img, idx) => (
                <div
                  key={idx}
                  className="w-full h-full flex-shrink-0 flex items-center justify-center p-4 snap-center snap-always"
                  onClick={() => setViewerIndex(null)}
                >
                  <img
                    src={img}
                    alt={`${altText} - full size ${idx + 1}`}
                    className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl pointer-events-none select-none"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ))}
            </div>

            {/* Next button */}
            {allImages.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 text-white transition-colors hidden sm:flex items-center justify-center cursor-pointer z-55"
                title="Next image"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Swipe indicator label on mobile */}
          <div className="w-full py-6 text-center text-[10px] text-slate-400 font-medium tracking-wide pointer-events-none bg-gradient-to-t from-slate-950/80 to-transparent">
            {allImages.length > 1 ? 'Drag or Swipe left/right to browse images' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
