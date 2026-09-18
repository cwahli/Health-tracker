import React from 'react';
import { Home, Activity, Utensils, TrendingUp, Lightbulb } from 'lucide-react';

export interface BottomNavProps {
  activeTab: 'home' | 'insights' | 'food' | 'medical' | 'trends';
  onNavigateTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
  isId?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onNavigateTab,
  isId = false,
}) => {
  return (
    <nav
      id="app-bottom-nav"
      className="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 safe-area-pb"
    >
      <div className="max-w-md mx-auto flex items-center justify-around h-16 px-2">
        <button
          id="nav-tab-home"
          onClick={() => onNavigateTab('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'home'
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Home className="w-5 h-5 mb-1" />
          <span>{isId ? 'Beranda' : 'Home'}</span>
        </button>

        <button
          id="nav-tab-health"
          onClick={() => onNavigateTab('medical')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'medical'
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Activity className="w-5 h-5 mb-1" />
          <span>{isId ? 'Kesehatan' : 'Health'}</span>
        </button>

        <button
          id="nav-tab-food"
          onClick={() => onNavigateTab('food')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'food'
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Utensils className="w-5 h-5 mb-1" />
          <span>{isId ? 'Makanan' : 'Food'}</span>
        </button>

        <button
          id="nav-tab-trends"
          onClick={() => onNavigateTab('trends')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'trends'
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-5 h-5 mb-1" />
          <span>{isId ? 'Tren' : 'Trends'}</span>
        </button>

        <button
          id="nav-tab-insights"
          onClick={() => onNavigateTab('insights')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'insights'
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Lightbulb className="w-5 h-5 mb-1" />
          <span>{isId ? 'Wawasan' : 'Insights'}</span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNav;
