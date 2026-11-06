/** Tab-visible / window-focus → incremental cloud pull. No React, no Firebase. */

type FocusPullTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type FocusPullDoc = FocusPullTarget & {
  visibilityState: string;
};

export function bindFocusPull(doc: FocusPullDoc, win: FocusPullTarget, pull: () => void): () => void {
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') pull();
  };
  const onFocus = () => {
    if (doc.visibilityState === 'visible') pull();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', onFocus);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('focus', onFocus);
  };
}
