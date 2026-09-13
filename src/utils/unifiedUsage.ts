/**
 * Unified Usage & Timing Tracker for LLM pipeline stages.
 */

export interface LLMUsage {
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cachedContentTokenCount?: number;
  [key: string]: any;
}

const usageStore = new Map<string, LLMUsage>();
const timingStore = new Map<string, number>();

export function recordUnifiedUsage(key: string, usage: LLMUsage): void {
  if (!key || !usage) return;
  usageStore.set(key, usage);
}

export function recordUnifiedTiming(key: string, durationMs: number): void {
  if (!key || typeof durationMs !== 'number') return;
  timingStore.set(key, durationMs);
}

export function takeUnifiedUsage(key: string): LLMUsage | null {
  if (!key) return null;
  const usage = usageStore.get(key) || null;
  if (usage) {
    usageStore.delete(key);
  }
  return usage;
}

export function takeUnifiedTiming(key: string): number | null {
  if (!key) return null;
  const timing = timingStore.get(key) ?? null;
  if (timing !== null) {
    timingStore.delete(key);
  }
  return timing;
}

export function formatUnifiedUsage(stageOrUsage?: string | LLMUsage | null, usageOrNull?: LLMUsage | null): string {
  const usage = (typeof stageOrUsage === 'object' ? stageOrUsage : usageOrNull) || null;
  const stage = typeof stageOrUsage === 'string' ? stageOrUsage : null;
  if (!usage) return stage ? `[${stage}] Tokens: N/A` : 'Tokens: N/A';
  const prompt = usage.promptTokens ?? usage.prompt_tokens ?? 0;
  const candidates = usage.candidatesTokens ?? usage.completion_tokens ?? 0;
  const total = usage.totalTokens ?? usage.total_tokens ?? (prompt + candidates);
  const text = `Prompt: ${prompt}, Completion: ${candidates}, Total: ${total}`;
  return stage ? `[${stage}] ${text}` : text;
}
