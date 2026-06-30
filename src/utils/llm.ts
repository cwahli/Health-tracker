export interface LLMModel {
  id: string;
  name: string;
  provider: 'Gemini';
  isDefault?: boolean;
  description: string;
  rpd: string;
}

export const AVAILABLE_LLMS: LLMModel[] = [
  { 
    id: 'antigravity', 
    name: 'Antigravity', 
    provider: 'Gemini', 
    isDefault: true,
    description: 'A general-purpose autonomous agent running in a remote, Google-hosted Linux environment',
    rpd: '100 RPD'
  },
  { 
    id: 'gemini-3-flash', 
    name: 'Gemini 3 Flash', 
    provider: 'Gemini', 
    description: 'Our most intelligent model built for speed, combining frontier intelligence with superior search and grounding.',
    rpd: '20 RPD'
  },
  { 
    id: 'gemini-3.5-flash', 
    name: 'Gemini 3.5 Flash', 
    provider: 'Gemini', 
    description: 'Our most intelligent model for sustained frontier performance in agentic and coding tasks.',
    rpd: '20 RPD'
  },
  { 
    id: 'gemini-3.1-flash-lite', 
    name: 'Gemini 3.1 Flash Lite', 
    provider: 'Gemini', 
    description: 'Our most cost-efficient model, optimized for high-volume agentic tasks, translation, and simple data processing.',
    rpd: '500 RPD'
  },
  { 
    id: 'gemini-2.5', 
    name: 'Gemini 2.5', 
    provider: 'Gemini', 
    description: 'Our hybrid reasoning model, with a 1M token context window and thinking budgets.',
    rpd: '500 RPD'
  },
  { 
    id: 'gemini-2.5-flash-lite', 
    name: 'Gemini 2.5 flash lite', 
    provider: 'Gemini', 
    description: 'Our hybrid reasoning model, with a 1M token context window and thinking budgets.',
    rpd: '20 RPD'
  },
  { 
    id: 'deep-research-pro-preview', 
    name: 'Deep Research Pro Preview', 
    provider: 'Gemini', 
    description: 'Our agent for long-running context gathering & synthesis tasks, optimized for speed and efficiency.',
    rpd: '500 RPD'
  }
];

export function getLLMByModelId(id: string): LLMModel {
  return AVAILABLE_LLMS.find(m => m.id === id) || AVAILABLE_LLMS[0]; // Fallback to antigravity (idx 0)
}

