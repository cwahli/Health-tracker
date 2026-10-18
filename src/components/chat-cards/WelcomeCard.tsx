import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { AgentType } from '../../utils/agentConfig';
import { translations } from '../../utils/translations';

interface WelcomeCardProps {
  type?: string;
  language?: string;
  msg: any;
  handleSend: (msg: string) => void;
  isAnalyzing: boolean;
  agentType: AgentType | null;
  autoSendMessage?: string;
}

export const WelcomeCard: React.FC<WelcomeCardProps> = (props) => {
  const { msg, handleSend, isAnalyzing, agentType, autoSendMessage, type, language } = props;
  const t = translations[language || "en"] || translations.en;
  const activeType = agentType || type;
  const isFoodIdea = activeType === 'food_idea';
  const isFood = activeType === 'food';

  return (
    <div className="mt-3">
      {isFoodIdea && (
        <button
          type="button"
          onClick={() => handleSend(t.surpriseMeAction)}
          disabled={isAnalyzing}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
        >
          {t.surpriseMe}
        </button>
      )}
      {/* Handled consistently at bottom action row instead of inline welcoming stream */}
    </div>
  );
};
