import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { bindFocusPull } from './focusPull';

function harness(initial: string) {
  const docListeners = new Map<string, Set<() => void>>();
  const winListeners = new Map<string, Set<() => void>>();
  const listen = (map: Map<string, Set<() => void>>) => ({
    addEventListener(type: string, listener: () => void) {
      let set = map.get(type);
      if (!set) {
        set = new Set();
        map.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      map.get(type)?.delete(listener);
    },
  });
  const doc = { visibilityState: initial, ...listen(docListeners) };
  const win = listen(winListeners);
  const fire = (bucket: 'doc' | 'win', type: string) => {
    const set = (bucket === 'doc' ? docListeners : winListeners).get(type);
    set?.forEach((fn) => fn());
  };
  return { doc, win, fire };
}

describe('bindFocusPull', () => {
  it('calls pull on visibilitychange when visible', () => {
    const { doc, win, fire } = harness('visible');
    const pull = vi.fn();
    bindFocusPull(doc, win, pull);
    fire('doc', 'visibilitychange');
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('does not call pull on visibilitychange when hidden', () => {
    const { doc, win, fire } = harness('hidden');
    const pull = vi.fn();
    bindFocusPull(doc, win, pull);
    fire('doc', 'visibilitychange');
    expect(pull).not.toHaveBeenCalled();
  });

  it('calls pull on window focus while visible', () => {
    const { doc, win, fire } = harness('visible');
    const pull = vi.fn();
    bindFocusPull(doc, win, pull);
    fire('win', 'focus');
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('does not call pull on window focus while hidden', () => {
    const { doc, win, fire } = harness('hidden');
    const pull = vi.fn();
    bindFocusPull(doc, win, pull);
    fire('win', 'focus');
    expect(pull).not.toHaveBeenCalled();
  });

  it('unbind stops later visibility and focus events', () => {
    const { doc, win, fire } = harness('visible');
    const pull = vi.fn();
    const unbind = bindFocusPull(doc, win, pull);
    unbind();
    fire('doc', 'visibilitychange');
    fire('win', 'focus');
    expect(pull).not.toHaveBeenCalled();
  });

  it('wires useAppSync to incremental checkForDbChanges', () => {
    const hookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../hooks/useAppSync.ts');
    const src = readFileSync(hookPath, 'utf8');
    expect(src).toContain('bindFocusPull');
    expect(src).toContain('checkForDbChangesRef.current?.(undefined, false)');
  });
});
