import React from 'react';
import { Home, Activity, Utensils, TrendingUp, Plus } from 'lucide-react';
import { translations } from '../utils/translations';

interface BottomNavProps {
  activeTab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends';
  setActiveTab: (tab: 'home' | 'insights' | 'health' | 'food' | 'medical' | 'trends') => void;
  language: string;
  onPlusClick?: () => void;
  isFloatingOpen?: boolean;
}

export default function BottomNav({ activeTab, setActiveTab, language, onPlusClick, isFloatingOpen }: BottomNavProps) {
  const t = translations[language] || translations.en;

  const leftTabs = [
    { id: 'home', icon: Home, label: t.home },
    { id: 'health', icon: Activity, label: t.health },
  ] as const;

  const rightTabs = [
    { id: 'food', icon: Utensils, label: t.foodHistory },
    { id: 'trends', icon: TrendingUp, label: t.trends },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-theme-bg-card border-t border-theme-border shadow-lg py-2 px-4 z-40 transition-colors duration-200">
      <div className="max-w-md mx-auto flex items-center justify-between relative">
        {/* Left tabs */}
        <div className="flex items-center justify-around flex-1">
          {leftTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id || (tab.id === 'health' && (activeTab === 'insights' || activeTab === 'medical'));
            return (
              <button
                key={tab.id}
                id={`nav-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className="relative p-3 rounded-2xl flex flex-col items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 group"
                aria-label={tab.label}
              >
                <span
                  className={`absolute inset-0 rounded-2xl scale-95 transition-all duration-300 ${
                    isActive
                      ? 'bg-indigo-600/10 scale-100'
                      : 'bg-transparent group-hover:bg-theme-border/40'
                  }`}
                />
                <Icon
                  className={`w-6 h-6 relative z-10 transition-all duration-300 ${
                    isActive
                      ? 'text-indigo-600 stroke-[2.5px] scale-110'
                      : 'text-theme-text-secondary opacity-70 group-hover:opacity-100'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Center elevated + button */}
        <div className="flex justify-center px-4 relative -top-5">
          <button
            onClick={onPlusClick}
            className={`w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-indigo-500/20 z-50 ${
              isFloatingOpen ? 'rotate-45 bg-rose-600 hover:bg-rose-700' : ''
            }`}
            title={t.openQuickActions}
          >
            <Plus className="w-7 h-7 stroke-[2.5px]" />
          </button>
        </div>

        {/* Right tabs */}
        <div className="flex items-center justify-around flex-1">
          {rightTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`nav-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className="relative p-3 rounded-2xl flex flex-col items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20 group"
                aria-label={tab.label}
              >
                <span
                  className={`absolute inset-0 rounded-2xl scale-95 transition-all duration-300 ${
                    isActive
                      ? 'bg-indigo-600/10 scale-100'
                      : 'bg-transparent group-hover:bg-theme-border/40'
                  }`}
                />
                <Icon
                  className={`w-6 h-6 relative z-10 transition-all duration-300 ${
                    isActive
                      ? 'text-indigo-600 stroke-[2.5px] scale-110'
                      : 'text-theme-text-secondary opacity-70 group-hover:opacity-100'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
