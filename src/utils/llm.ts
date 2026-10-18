export interface LLMModel {
  id: string;
  name: string;
  provider: 'Google' | 'Anthropic' | 'OpenAI' | 'OpenCode Go';
  description: string;
  isDefault?: boolean;
}

export const AVAILABLE_LLMS: LLMModel[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'Google',
    description: 'Newest flash model. Separate free-tier quota (20 req/day).'
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    provider: 'Google',
    description: 'Default for all live calls. Free-tier 15 req/min — switch away if you hit 429.',
    isDefault: true
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'Google',
    description: 'Separate free-tier quota from 3.5 Lite. Use when 3.5 is exhausted.'
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    description: 'Fast, high-accuracy multimodal model for nutrition and clinical evaluation.'
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    description: 'Deep clinical reasoning and advanced multimodal evaluation.'
  },
  {
    id: 'opencode-go/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash (Go)',
    provider: 'OpenCode Go',
    description: 'OpenCode Go subscription. Native vision, OpenAI-compatible. Burns Go quota.'
  },
  {
    id: 'opencode-go/muse-spark-1.3-contributor',
    name: 'Muse Spark 1.3 (Go)',
    provider: 'OpenCode Go',
    description: 'OpenCode Go subscription. Responses API. Burns Go quota.'
  }
];
