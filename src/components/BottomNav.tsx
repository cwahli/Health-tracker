import React from 'react';
import { Home, Lightbulb, Utensils, Stethoscope, TrendingUp } from 'lucide-react';

interface BottomNavProps {
  activeTab: 'home' | 'insights' | 'food' | 'medical' | 'trends';
  setActiveTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
}

export default function BottomNav({ activeTab, setActiveTab }: BottomNavProps) {
  const tabs = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'insights', icon: Lightbulb, label: 'Health insights' },
    { id: 'food', icon: Utensils, label: 'Food History' },
    { id: 'medical', icon: Stethoscope, label: 'Body Info' },
    { id: 'trends', icon: TrendingUp, label: 'Trends' },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-100 dark:border-slate-800/80 shadow-lg py-2.5 px-4 z-40 transition-colors duration-200">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {tabs.map((tab) => {
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
              {/* Highlight background pill for active tab in material style */}
              <span
                className={`absolute inset-0 rounded-2xl scale-95 transition-all duration-300 ${
                  isActive
                    ? 'bg-indigo-600/10 scale-100'
                    : 'bg-transparent group-hover:bg-slate-100 dark:group-hover:bg-slate-800/50'
                }`}
              />
              
              <Icon
                className={`w-6 h-6 relative z-10 transition-all duration-300 ${
                  isActive
                    ? 'text-indigo-600 stroke-[2.5px] scale-110'
                    : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
