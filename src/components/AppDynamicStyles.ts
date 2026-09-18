import React from 'react';

export interface DynamicStyles {
  appBackground: string;
  cardBackground: string;
  textColor: string;
  textMutedColor: string;
  borderColor: string;
  primaryColor: string;
  accentColor: string;
  navBackground: string;
  navBorder: string;
  navActiveColor: string;
  navInactiveColor: string;
  shellContainerStyle: React.CSSProperties;
}

export function getDynamicStyles(theme: 'light' | 'dark' | 'system' = 'system', isMobile: boolean = false): DynamicStyles {
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    return {
      appBackground: 'bg-slate-950',
      cardBackground: 'bg-slate-900',
      textColor: 'text-slate-100',
      textMutedColor: 'text-slate-400',
      borderColor: 'border-slate-800',
      primaryColor: 'text-indigo-400',
      accentColor: 'bg-indigo-600',
      navBackground: 'bg-slate-900/95 backdrop-blur-md',
      navBorder: 'border-slate-800',
      navActiveColor: 'text-indigo-400 bg-indigo-950/60',
      navInactiveColor: 'text-slate-400 hover:text-slate-200',
      shellContainerStyle: {
        minHeight: '100vh',
        backgroundColor: '#020617',
        color: '#f8fafc',
        paddingBottom: isMobile ? '80px' : '32px'
      }
    };
  }

  return {
    appBackground: 'bg-slate-50',
    cardBackground: 'bg-white',
    textColor: 'text-slate-900',
    textMutedColor: 'text-slate-500',
    borderColor: 'border-slate-200',
    primaryColor: 'text-indigo-600',
    accentColor: 'bg-indigo-600',
    navBackground: 'bg-white/95 backdrop-blur-md',
    navBorder: 'border-slate-200',
    navActiveColor: 'text-indigo-600 bg-indigo-50',
    navInactiveColor: 'text-slate-500 hover:text-slate-900',
    shellContainerStyle: {
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      color: '#0f172a',
      paddingBottom: isMobile ? '80px' : '32px'
    }
  };
}
