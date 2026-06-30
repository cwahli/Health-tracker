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
    name: 'Antigravity Agent', 
    provider: 'Gemini', 
    isDefault: true,
    description: 'Antigravity-powered coding and reasoning agent optimized for complex precision medicine diagnostics.',
    rpd: 'Unlimited'
  },
  { 
    id: 'gemini-3.5-flash', 
    name: 'Gemini 3.5 Flash', 
    provider: 'Gemini', 
    description: 'Cutting-edge speed and enhanced precision, optimized for rich nutritional data extraction.',
    rpd: '1,500 RPD'
  },
  { 
    id: 'gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash', 
    provider: 'Gemini', 
    description: 'Balanced performance, speed, and cost for reliable, day-to-day food analysis.',
    rpd: '1,500 RPD'
  },
  { 
    id: 'gemini-2.5-flash-lite', 
    name: 'Gemini 2.5 Flash Lite', 
    provider: 'Gemini', 
    description: 'Fast, highly-efficient model for quick image parsing and lightweight composition checks.',
    rpd: '1,500 RPD'
  },
  { 
    id: 'gemini-3-flash', 
    name: 'Gemini 3.0 Flash', 
    provider: 'Gemini', 
    description: 'Next-generation architecture providing high multimodal speed and improved accuracy.',
    rpd: '1,500 RPD'
  }
];

export function getLLMByModelId(id: string): LLMModel {
  return AVAILABLE_LLMS.find(m => m.id === id) || AVAILABLE_LLMS[0]; // Fallback to antigravity (idx 0)
}

