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
    id: 'gemini-2.5-flash-lite', 
    name: 'Gemini 2.5 Flash Lite', 
    provider: 'Gemini', 
    description: 'Fast, highly-efficient model for quick image parsing and lightweight composition checks.',
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
    id: 'gemini-3.1-flash-lite', 
    name: 'Gemini 3.1 Flash Lite', 
    provider: 'Gemini', 
    isDefault: true,
    description: 'Modern, highly optimized, eco-friendly efficiency for ultra-fast response times.',
    rpd: '1,500 RPD'
  },
  { 
    id: 'gemini-3-flash', 
    name: 'Gemini 3.0 Flash', 
    provider: 'Gemini', 
    description: 'Next-generation architecture providing high multimodal speed and improved accuracy.',
    rpd: '1,500 RPD'
  },
  { 
    id: 'gemini-3.5-flash', 
    name: 'Gemini 3.5 Flash', 
    provider: 'Gemini', 
    description: 'Cutting-edge speed and enhanced precision, optimized for rich nutritional data extraction.',
    rpd: '1,500 RPD'
  },
  { 
    id: 'gemini-3.1-pro-preview', 
    name: 'Gemini 3.1 Pro (Preview)', 
    provider: 'Gemini', 
    description: 'Advanced reasoning, high intelligence, and complex food relationship diagnostic tracing.',
    rpd: '50 RPD'
  }
];

export function getLLMByModelId(id: string): LLMModel {
  return AVAILABLE_LLMS.find(m => m.id === id) || AVAILABLE_LLMS[2]; // Fallback to 3.1-flash-lite (idx 2)
}

