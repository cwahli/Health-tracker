// dotenv/systemd quote trap (Oct-13 lesson): deploy .env files wrap secrets in
// double quotes. systemd EnvironmentFile and dotenv strip them, but naive shell
// (`cut -d= -f2`) and naive loaders keep the literal quote characters, producing
// a credential Google rejects with API_KEY_INVALID. Every hand-rolled consumer
// MUST pass values through cleanEnvValue.
export function cleanEnvValue(v: unknown): string {
  if (typeof v !== 'string') return '';
  let s = v.trim().replace(/^export\s+/, '');
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) s = s.slice(1, -1);
  }
  return s.trim();
}

// First non-empty cleaned value wins (mirrors getGeminiApiKey precedence).
export function firstEnvValue(names: string[], env: Record<string, unknown> = process.env): string {
  for (const n of names) {
    const v = cleanEnvValue((env as any)?.[n]);
    if (v) return v;
  }
  return '';
}
