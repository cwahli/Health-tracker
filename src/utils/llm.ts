export interface LLMModel {
  id: string;
  name: string;
  provider: 'Gemini';
  isDefault?: boolean;
  description: string;
  rpd: string;
}

const UNSORTED_LLMS: LLMModel[] = [
  { 
    id: 'antigravity', 
    name: 'Antigravity', 
    provider: 'Gemini', 
    isDefault: true,
    description: 'A general-purpose autonomous agent running in a remote, Google-hosted Linux environment',
    rpd: '0 RPD'
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
    id: 'gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash', 
    provider: 'Gemini', 
    description: 'Our hybrid reasoning model, with a 1M token context window and thinking budgets.',
    rpd: '20 RPD'
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
    rpd: '20 RPD'
  },
  {
    id: 'gemini-embedding-1',
    name: 'Gemini Embedding 1',
    provider: 'Gemini',
    description: 'For tasks such as semantic search, classification, and clustering',
    rpd: '0 RPD'
  },
  {
    id: 'gemini-embedding-2',
    name: 'Gemini Embedding 2',
    provider: 'Gemini',
    description: 'For tasks such as semantic search, classification, and clustering',
    rpd: '0 RPD'
  },
  {
    id: 'gemma-4-31b',
    name: 'Gemma 4 31B',
    provider: 'Gemini',
    description: 'Purpose-built for maximum quality in data center environments',
    rpd: '0 RPD'
  },
  {
    id: 'gemma-4-26b',
    name: 'Gemma 4 26B',
    provider: 'Gemini',
    description: 'A Mixture-of-Experts model that activates only 4B parameters per inference.',
    rpd: '0 RPD'
  }
];

function getRpdValue(rpdStr: string): number {
  const match = rpdStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function getModelNumbers(name: string): number[] {
  const matches = name.match(/\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches.map(Number);
}

function compareModelNumbers(a: number[], b: number[]): number {
  const minLength = Math.min(a.length, b.length);
  for (let i = 0; i < minLength; i++) {
    if (a[i] !== b[i]) {
      return b[i] - a[i]; // descending (highest first)
    }
  }
  return b.length - a.length; // longer number list is higher priority/newer (e.g. Gemma 4 31B vs Gemma 4)
}

export const AVAILABLE_LLMS: LLMModel[] = [...UNSORTED_LLMS].sort((a, b) => {
  const rpdA = getRpdValue(a.rpd);
  const rpdB = getRpdValue(b.rpd);
  
  if (rpdB !== rpdA) {
    return rpdB - rpdA; // descending (highest first)
  }
  
  const numA = getModelNumbers(a.name);
  const numB = getModelNumbers(b.name);
  
  const compNum = compareModelNumbers(numA, numB);
  if (compNum !== 0) {
    return compNum;
  }
  
  return a.name.localeCompare(b.name);
});

export function getLLMByModelId(id: string): LLMModel {
  return AVAILABLE_LLMS.find(m => m.id === id) || AVAILABLE_LLMS.find(m => m.id === 'antigravity') || AVAILABLE_LLMS[0];
}

