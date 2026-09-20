// D-2: deprecated shim. The implementation moved to `BackendJobSync.ts`; the
// client only ever talks to backend routes (D1), never Supabase directly.
// Kept so the frozen `useAppShellState.ts` import path keeps working.
// Do not add code here — import from './BackendJobSync' instead.
export * from './BackendJobSync';
