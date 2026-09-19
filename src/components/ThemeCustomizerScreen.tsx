import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { NutrientPieChart } from './NutrientPieChart';
import { auditColors, auditDesignTokens } from '../utils/themeRegistry';
import type { ThemeCustomizerApi } from '../hooks/useThemeCustomizer';

const sizeMap: Record<string, string> = {
  tiny: '12px',
  small: '14px',
  normal: '16px',
  large: '18px',
  xl: '20px',
  xxl: '24px',
  '3xl': '30px',
  '4xl': '36px'
};

export const parseColorAndOpacity = (val: string) => {
  let v = (val || '').trim();
  let hex6 = '#ffffff';
  let opacity = 100;

  if (v.startsWith('rgba(')) {
    const parts = v.replace('rgba(', '').replace(')', '').split(',').map(s => s.trim());
    if (parts.length >= 4) {
      const r = parseInt(parts[0], 10) || 0;
      const g = parseInt(parts[1], 10) || 0;
      const b = parseInt(parts[2], 10) || 0;
      const a = parseFloat(parts[3]);
      opacity = Math.round((isNaN(a) ? 1 : a) * 100);
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      hex6 = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  } else if (v.startsWith('rgb(')) {
    const parts = v.replace('rgb(', '').replace(')', '').split(',').map(s => s.trim());
    if (parts.length >= 3) {
      const r = parseInt(parts[0], 10) || 0;
      const g = parseInt(parts[1], 10) || 0;
      const b = parseInt(parts[2], 10) || 0;
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      hex6 = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      opacity = 100;
    }
  } else if (v.startsWith('#')) {
    let clean = v.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (clean.length === 8) {
      hex6 = '#' + clean.substring(0, 6);
      const alphaHex = clean.substring(6, 8);
      opacity = Math.round((parseInt(alphaHex, 16) / 255) * 100);
    } else if (clean.length === 6) {
      hex6 = '#' + clean;
      opacity = 100;
    }
  } else if (v) {
    hex6 = v;
  }

  return { hex6, opacity };
};

export const formatColorWithOpacity = (hex6: string, opacityPercent: number) => {
  let cleanHex = (hex6 || '#ffffff').trim();
  if (!cleanHex.startsWith('#')) cleanHex = '#' + cleanHex;
  let h = cleanHex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) h = 'ffffff';

  const opacity = Math.max(0, Math.min(100, opacityPercent));
  if (opacity >= 100) {
    return `#${h}`;
  }

  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const a = (opacity / 100).toFixed(2).replace(/\.?0+$/, '');
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

function CustomFontSelect({ 
  value, 
  options, 
  onChange, 
  isFamily = false 
}: { 
  value: string; 
  options: {value: string, label: string}[]; 
  onChange: (val: string) => void;
  isFamily?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  
  return (
    <>
      <button 
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-700 rounded-xl px-2 py-1.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer text-center relative flex justify-between items-center"
      >
        <span className="flex-1 text-center" style={{ fontFamily: isFamily ? value : undefined, fontSize: !isFamily ? sizeMap[value] : undefined }}>
           {isFamily ? value : (options.find(o => o.value === value)?.label.replace(' (', ' - ').replace(')', '') || value)}
        </span>
        <span className="text-[8px] opacity-50 ml-2">▼</span>
      </button>
      
      {isOpen && buttonRef.current && createPortal(
        <>
          <div id="font-select-overlay" className="fixed inset-0 z-[150]" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
          <div id="font-select-portal" 
            className="fixed z-[160] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-y-auto"
            style={{
              top: (buttonRef.current.getBoundingClientRect().bottom + 200 > window.innerHeight) ? undefined : buttonRef.current.getBoundingClientRect().bottom + 4,
              bottom: (buttonRef.current.getBoundingClientRect().bottom + 200 > window.innerHeight) ? window.innerHeight - buttonRef.current.getBoundingClientRect().top + 4 : undefined,
              left: buttonRef.current.getBoundingClientRect().left,
              width: buttonRef.current.getBoundingClientRect().width,
              maxHeight: '200px'
            }}
          >
            {options.map(opt => (
              <div 
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                style={{
                  fontFamily: isFamily ? opt.value : undefined,
                  fontSize: !isFamily ? sizeMap[opt.value] : undefined,
                }}
                className={`px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 ${value === opt.value ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-700 dark:text-slate-300'}`}
              >
                {isFamily ? opt.label : opt.label.replace(' (', ' - ').replace(')', '')}
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export interface ThemeCustomizerScreenProps {
  theme: ThemeCustomizerApi;
}

/**
 * Q-11.12 (move-only): the theme customizer portal and the two inspector portals,
 * moved verbatim out of Header.tsx. The region is byte-identical — only the
 * component boundary and this prop plumbing are new.
 */
export default function ThemeCustomizerScreen({ theme }: ThemeCustomizerScreenProps) {
  const {
    applyPresetConfig,
    applyPreview,
    buildExportPayload,
    colorDraft,
    colorOriginalVal,
    colorsList,
    expandedColorKey,
    fontsList,
    getColorVariable,
    getFontVariable,
    getThemeVariableChangesCount,
    handleAddColor,
    handleDeleteColor,
    handleRenameFont,
    initialThemeSnapshot,
    inspectedElement,
    inspectorPaused,
    inspectorProperty,
    inspectorVariable,
    isPresetActive,
    justSavedKey,
    newPresetName,
    normalizeImportedPreset,
    onSaveProfile,
    profile,
    revertPreview,
    saveOverride,
    setColorDraft,
    setExpandedColorKey,
    setInspectedElement,
    setInspectorPaused,
    setInspectorProperty,
    setInspectorVariable,
    setJustSavedKey,
    setNewPresetName,
    setProfile,
    setShowThemeScreen,
    setTextPreviewOverride,
    setThemeActiveSection,
    setThemeCompactMode,
    setThemePreviewMode,
    showThemeScreen,
    t,
    textPreviewOverride,
    themeActiveSection,
    themeCompactMode,
    themePreviewMode,
  } = theme;

  return (
    <>
      {/* Dedicated full-screen or elegant modal Theme Customizer Screen */}
      
      {/* Inspector Popup */}
      {themePreviewMode && inspectedElement && createPortal((
        <div id="inspector-popup" className="fixed z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-4 flex flex-col gap-3 w-64" style={{ top: Math.min(window.innerHeight - 250, inspectedElement.rect.bottom + 10), left: Math.min(window.innerWidth - 270, Math.max(10, inspectedElement.rect.left)) }}>
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate flex-1">{inspectedElement.selector}</h4>
            <button onClick={() => { revertPreview(); setInspectedElement(null); }} className="text-slate-400 hover:text-slate-600 ml-2">✕</button>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Property</label>
            <select value={inspectorProperty} onChange={e => {
              revertPreview();
              setInspectorProperty(e.target.value);
            }} className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-slate-900 dark:text-slate-100">
              <option value="color">Text Color (color)</option>
              <option value="background-color">Background Color</option>
              <option value="border-color">Border Color</option>
              <option value="font-family">Font Family</option>
              <option value="font-size">Font Size</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Variable</label>
            <select value={inspectorVariable} onChange={e => {
              const val = e.target.value;
              setInspectorVariable(val);
              if (inspectedElement?.el) applyPreview(val, inspectorProperty, inspectedElement.el);
            }} className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-slate-900 dark:text-slate-100">
              <option value="">Select variable...</option>
              {inspectorProperty.includes('color') ? (
                <>
                  {colorsList.map((color: any) => (
                    <option key={color.key} value={`var(${getColorVariable(color.key)})`}>
                      {color.label}
                    </option>
                  ))}
                </>
              ) : inspectorProperty === 'font-size' ? (
                <>
                  {fontsList.map((font: any) => (
                    <option key={font.key} value={`var(${getFontVariable(font.key)})`}>
                      {font.label}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value="var(--font-sans)">Sans Font</option>
                  <option value="var(--font-mono)">Mono Font</option>
                  <option value="var(--font-display)">Display Font</option>
                </>
              )}
            </select>
          </div>
          <button onClick={saveOverride} className="w-full py-1.5 mt-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold">Assign Variable</button>
        </div>
      ), document.body)}

      {/* Inspector Highlight Box */}
      {themePreviewMode && inspectedElement && createPortal((
        <div
          id="inspector-highlight"
          className="fixed pointer-events-none z-[99] border-2 border-indigo-500 bg-indigo-500/10 rounded transition-all duration-150"
          style={{
            top: inspectedElement.rect.top,
            left: inspectedElement.rect.left,
            width: inspectedElement.rect.width,
            height: inspectedElement.rect.height,
          }}
        />
      ), document.body)}

{showThemeScreen && createPortal((
        <>
          <style>{`
            #root {
              transform: translateX(0) !important; /* containing block for fixed children */
              transition: all 0.3s ease;
            }
            @media (min-width: 800px) {
              #root {
                width: 50vw !important;
                margin-left: 50vw !important;
              }
            }
            @media (max-width: 799px) {
              #root {
                margin-top: ${themeCompactMode ? '200px' : '50vh'} !important;
              }
            }
          `}</style>
        <div id="theme-customizer-screen" className="fixed inset-0 z-[60] pointer-events-none">
          <div className={`bg-white dark:bg-slate-900 shadow-2xl flex flex-col animation-fade-in text-slate-800 dark:text-slate-100 pointer-events-auto transition-all duration-300 border-r border-slate-200 dark:border-slate-800
            ${themeCompactMode 
               ? 'fixed top-0 left-0 w-full h-[200px] rounded-b-2xl shadow-xl z-[70] overflow-hidden' 
               : 'fixed top-0 left-0 w-full min-[800px]:w-1/2 h-[50vh] min-[800px]:h-[100vh] rounded-b-3xl min-[800px]:rounded-none shadow-2xl z-[70] overflow-hidden'}
          `}>
            {themeCompactMode && (
              <button
                onClick={() => setThemeCompactMode(false)}
                className="absolute top-4 right-4 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 z-[80]"
                title="Expand"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
              </button>
            )}
            
            {/* Header */}
            {!themeCompactMode && (
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <h2 className="text-base font-bold whitespace-nowrap" style={{ color: profile.themePalette?.textDarkPrimary || 'var(--theme-text-dark-primary, rgba(255, 255, 255, 0.9))' }}>{t.themeTitle}</h2>
                <select
                  value={themeActiveSection}
                  onChange={(e) => setThemeActiveSection(e.target.value as any)}
                  className="text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-250 dark:border-slate-700 rounded-full pl-3.5 pr-8 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none cursor-pointer shadow-sm w-full sm:w-auto"
                >
                  <option value="colors">{t.themeSectionColours}</option>
                  <option value="fonts">{t.themeSectionFont}</option>
                  <option value="tokens">{t.themeSectionToken}</option>
                  <option value="components">{t.themeSectionComponents}</option>
                  <option value="elements">{t.themeSectionElements}</option>
                  <option value="presets">{t.themeSectionPresets}</option>
                </select>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  onClick={() => setThemeCompactMode(!themeCompactMode)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer mr-1"
                  title={themeCompactMode ? "Expand" : "Compact Mode"}
                >
                  {themeCompactMode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    setInspectorPaused(!inspectorPaused);
                    if (!inspectorPaused) {
                      revertPreview();
                      setInspectedElement(null);
                    }
                  }}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer mr-1 ${
                    inspectorPaused
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                      : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title={inspectorPaused ? 'Resume click-to-assign' : 'Pause click-to-assign (interact with the page)'}
                >
                  {inspectorPaused ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (onSaveProfile) {
                      onSaveProfile(profile);
                    }
                    initialThemeSnapshot.current = null;
                    setThemePreviewMode(false);
                    revertPreview();
                    setInspectedElement(null);
                    setShowThemeScreen(false);
                  }}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => {
                    setThemePreviewMode(false);
                    revertPreview();
                    setInspectedElement(null);
                    setShowThemeScreen(false);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close theme editor"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            )}

            {/* Content scroll area */}
            <div className={`p-6 overflow-y-auto space-y-6 text-left flex-1 ${themeCompactMode ? 'pt-14' : ''}`}>
              
              {/* COLORS SECTION */}
              {themeActiveSection === 'colors' && (
                <div className="space-y-4">
                  {(() => {
                    const getEffectiveGroup = (color: any) => {
                      if (textPreviewOverride[color.key]) return textPreviewOverride[color.key];
                      if (color.key === 'textDarkPrimary' || color.key === 'textDarkSecondary') return 'dark';
                      if (color.key === 'text' || color.key === 'textSecondary' || color.key === 'textAccent' || color.key === 'textMuted' || color.key === 'textSuccess' || color.key === 'textError') return 'light';
                      return color.darkGroup || 'light';
                    };

                    const generalColors = colorsList.filter((c: any) => c.category === 'general' || ['button', 'background', 'bgCard', 'border', 'neutralSetting'].includes(c.key));
                    const textColors = colorsList.filter((c: any) => c.category === 'text' || ['text', 'textSecondary', 'textDarkPrimary', 'textDarkSecondary', 'textAccent', 'textMuted', 'textSuccess', 'textError'].includes(c.key));
                    const statusColors = colorsList.filter((c: any) => c.category === 'status' || ['warning', 'caution', 'success', 'info'].includes(c.key));
                    const nutrientColors = colorsList.filter((c: any) => c.category === 'nutrients' || ['nutrientCalories', 'nutrientProtein', 'nutrientCarbs', 'nutrientFat', 'nutrientSatFat', 'nutrientSodium'].includes(c.key));

                    const renderColorItem = (color: any) => {
                      const activeVal = (profile.themePalette as any)?.[color.key] || color.defaultHex;
                      const isExpanded = expandedColorKey === color.key;
                      const draftLabel = colorDraft && colorDraft.key === color.key ? colorDraft.label : color.label;
                      const draftVal = colorDraft && colorDraft.key === color.key ? colorDraft.value : activeVal;

                      return (
                        <div key={color.key} className="transition-all duration-200">
                          {/* Main Row */}
                          <div 
                            className="flex items-center justify-between py-2 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-xl transition-all group"
                          >
                            <div className="flex items-center min-w-0 flex-1">
                              {/* Swatch */}
                              <div 
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                                className="w-5 h-5 rounded-full shadow-inner shrink-0 cursor-pointer hover:opacity-80 transition-opacity border border-black/10 dark:border-white/10" 
                                style={{ backgroundColor: activeVal }}
                                title={isExpanded ? 'Close editor' : 'Click to edit'}
                              />
                              <div 
                                className="ml-3 min-w-0 flex-1 cursor-pointer"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                              >
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block truncate">
                                  {color.label}
                                </span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 block truncate">
                                  {color.description || 'Color variable'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Editor State */}
                          {isExpanded && (() => {
                            const { hex6, opacity } = parseColorAndOpacity(draftVal);
                            return (
                              <div className="mt-1 ml-8 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl space-y-3 shadow-inner text-left">
                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Variable Name</label>
                                  <input
                                    type="text"
                                    value={draftLabel}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setColorDraft(d => d && d.key === color.key ? { ...d, label: e.target.value } : d)}
                                    className="text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg px-2.5 py-1.5 focus:border-indigo-500 focus:outline-none transition-all w-full"
                                    placeholder="E.g. Primary Accent"
                                  />
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Colour & Hex</label>
                                  <div className="flex items-center gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg p-1.5 shadow-sm">
                                    <input
                                      type="color"
                                      value={hex6}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = formatColorWithOpacity(e.target.value, opacity);
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-6 h-6 rounded cursor-pointer overflow-hidden border border-slate-200 dark:border-slate-850 shrink-0 bg-transparent"
                                      style={{ padding: 0, border: 'none' }}
                                    />
                                    <input
                                      type="text"
                                      value={draftVal}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = e.target.value;
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-full text-xs font-mono bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none px-1"
                                      placeholder="#FFFFFF"
                                    />
                                  </div>
                                </div>

                                {/* Opacity Control */}
                                <div className="flex flex-col gap-1">
                                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                    <span>Opacity</span>
                                    <span className="text-slate-600 dark:text-slate-300 font-mono text-[10px]">{opacity}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={opacity}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const newOpacity = parseInt(e.target.value, 10);
                                      const newVal = formatColorWithOpacity(hex6, newOpacity);
                                      setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                      setProfile(p => ({
                                        ...p,
                                        themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                      }));
                                    }}
                                    className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                                  />
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!colorDraft) return;
                                      const currentList = [...(profile.customColors || auditColors)];
                                      const updatedList = currentList.map((c: any) => c.key === color.key ? { ...c, label: colorDraft.label } : c);
                                      const nextPalette = { ...(profile.themePalette || {}) };
                                      (nextPalette as any)[color.key] = colorDraft.value;
                                      if (color.key === 'background') {
                                        nextPalette.bgApp = colorDraft.value;
                                      }
                                      setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (colorOriginalVal.current[color.key] !== undefined) {
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: colorOriginalVal.current[color.key] }
                                        }));
                                      }
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  {color.key?.startsWith('custom_') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteColor(color.key);
                                        setExpandedColorKey(null);
                                        setColorDraft(null);
                                      }}
                                      className="flex-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-800 transition-all cursor-pointer"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    };

                    const renderTextColorItem = (color: any, sectionMode: 'dark' | 'light') => {
                      const activeVal = (profile.themePalette as any)?.[color.key] || color.defaultHex;
                      const isExpanded = expandedColorKey === color.key;
                      const draftLabel = colorDraft && colorDraft.key === color.key ? colorDraft.label : color.label;
                      const draftVal = colorDraft && colorDraft.key === color.key ? colorDraft.value : activeVal;

                      return (
                        <div key={color.key} className="transition-all duration-200">
                          {/* Main Row */}
                          <div 
                            className={sectionMode === 'dark'
                              ? "flex items-center justify-between py-2 px-3 hover:bg-slate-800/60 rounded-xl transition-all group gap-2"
                              : "flex items-center justify-between py-2 px-3 hover:bg-slate-150/80 rounded-xl transition-all group gap-2"}
                          >
                            <div className="flex items-center min-w-0 flex-1">
                              {/* Swatch */}
                              <div 
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                                className="w-5 h-5 rounded-full shadow-inner shrink-0 cursor-pointer hover:opacity-80 transition-opacity border border-black/10 dark:border-white/10" 
                                style={{ backgroundColor: activeVal }}
                                title={isExpanded ? 'Close editor' : 'Click to edit'}
                              />
                              <div 
                                className="ml-3 min-w-0 flex-1 cursor-pointer"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedColorKey(null);
                                    setColorDraft(null);
                                  } else {
                                    colorOriginalVal.current[color.key] = activeVal;
                                    setExpandedColorKey(color.key);
                                    setColorDraft({ key: color.key, label: color.label, value: activeVal });
                                  }
                                }}
                              >
                                <span 
                                  className="text-xs font-bold block truncate transition-colors"
                                  style={{ color: activeVal }}
                                >
                                  {color.label}
                                </span>
                                <span className={sectionMode === 'dark' ? "text-[10px] text-slate-400 block truncate" : "text-[10px] text-slate-500 block truncate"}>
                                  {color.description || 'Text color variable'}
                                </span>
                              </div>
                            </div>

                            {/* Light / Dark Toggle button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const currentMode = getEffectiveGroup(color);
                                const newMode = currentMode === 'dark' ? 'light' : 'dark';
                                setTextPreviewOverride(prev => ({ ...prev, [color.key]: newMode }));
                                const currentList = [...(profile.customColors || auditColors)];
                                const updatedList = currentList.map((c: any) => c.key === color.key ? { ...c, darkGroup: newMode } : c);
                                setProfile({ ...profile, customColors: updatedList });
                              }}
                              className={sectionMode === 'dark' 
                                ? "text-slate-400 hover:text-amber-300 hover:bg-slate-800 p-1.5 rounded-lg transition-all cursor-pointer shrink-0 ml-2" 
                                : "text-slate-400 hover:text-indigo-600 hover:bg-slate-200 p-1.5 rounded-lg transition-all cursor-pointer shrink-0 ml-2"}
                              title={sectionMode === 'dark' ? 'Move to Text over light' : 'Move to Text over dark'}
                            >
                              {sectionMode === 'dark' ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                              )}
                            </button>
                          </div>

                          {/* Expanded Editor State */}
                          {isExpanded && (() => {
                            const { hex6, opacity } = parseColorAndOpacity(draftVal);
                            return (
                              <div className="mt-1 ml-8 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl space-y-3 shadow-inner text-left">
                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Variable Name</label>
                                  <input
                                    type="text"
                                    value={draftLabel}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setColorDraft(d => d && d.key === color.key ? { ...d, label: e.target.value } : d)}
                                    className="text-xs font-semibold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg px-2.5 py-1.5 focus:border-indigo-500 focus:outline-none transition-all w-full"
                                    placeholder="E.g. Brand Heading"
                                  />
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Colour & Hex</label>
                                  <div className="flex items-center gap-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg p-1.5 shadow-sm">
                                    <input
                                      type="color"
                                      value={hex6}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = formatColorWithOpacity(e.target.value, opacity);
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-6 h-6 rounded cursor-pointer overflow-hidden border border-slate-200 dark:border-slate-850 shrink-0 bg-transparent"
                                      style={{ padding: 0, border: 'none' }}
                                    />
                                    <input
                                      type="text"
                                      value={draftVal}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const newVal = e.target.value;
                                        setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                        }));
                                      }}
                                      className="w-full text-xs font-mono bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none px-1"
                                      placeholder="#FFFFFF or rgba(255,255,255,0.9)"
                                    />
                                  </div>
                                </div>

                                {/* Opacity Control */}
                                <div className="flex flex-col gap-1">
                                  <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                    <span>Opacity</span>
                                    <span className="text-slate-600 dark:text-slate-300 font-mono text-[10px]">{opacity}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={opacity}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const newOpacity = parseInt(e.target.value, 10);
                                      const newVal = formatColorWithOpacity(hex6, newOpacity);
                                      setColorDraft(d => d && d.key === color.key ? { ...d, value: newVal } : d);
                                      setProfile(p => ({
                                        ...p,
                                        themePalette: { ...(p.themePalette || {}), [color.key]: newVal }
                                      }));
                                    }}
                                    className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                                  />
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!colorDraft) return;
                                      const currentList = [...(profile.customColors || auditColors)];
                                      const updatedList = currentList.map((c: any) => c.key === color.key ? { ...c, label: colorDraft.label } : c);
                                      const nextPalette = { ...(profile.themePalette || {}) };
                                      (nextPalette as any)[color.key] = colorDraft.value;
                                      setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (colorOriginalVal.current[color.key] !== undefined) {
                                        setProfile(p => ({
                                          ...p,
                                          themePalette: { ...(p.themePalette || {}), [color.key]: colorOriginalVal.current[color.key] }
                                        }));
                                      }
                                      setExpandedColorKey(null);
                                      setColorDraft(null);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  {color.key?.startsWith('custom_') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteColor(color.key);
                                        setExpandedColorKey(null);
                                        setColorDraft(null);
                                      }}
                                      className="flex-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-800 transition-all cursor-pointer"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    };

                    return (
                      <div className="space-y-6">
                        {/* 1. General Colours */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">General colours</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('general')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>
                          <div className="space-y-1">
                            {generalColors.map(color => renderColorItem(color))}
                          </div>
                        </div>

                        {/* 2. Text Colours */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Text colour</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('text')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>

                          {/* SUBSECTION 1: TEXT OVER DARK */}
                          <div className="space-y-2 bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-inner">
                            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                <span>🌙</span> Text over dark
                              </span>
                              <span className="text-[9px] text-slate-500 font-medium">Dark background</span>
                            </div>
                            <div className="space-y-1 pt-1">
                              {textColors.filter((color: any) => getEffectiveGroup(color) === 'dark').map(color => renderTextColorItem(color, 'dark'))}
                            </div>
                          </div>

                          {/* SUBSECTION 2: TEXT OVER LIGHT */}
                          <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                            <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                                <span>☀️</span> Text over light
                              </span>
                              <span className="text-[9px] text-slate-400 font-medium">Light background</span>
                            </div>
                            <div className="space-y-1 pt-1">
                              {textColors.filter((color: any) => getEffectiveGroup(color) === 'light').map(color => renderTextColorItem(color, 'light'))}
                            </div>
                          </div>
                        </div>

                        {/* 3. Status */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Status</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('status')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>
                          <div className="space-y-1">
                            {statusColors.map(color => renderColorItem(color))}
                          </div>
                        </div>

                        {/* 4. Nutrients & Targets */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Nutrients & Targets</span>
                            <button
                              type="button"
                              onClick={() => handleAddColor('nutrients')}
                              className="px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1"
                            >
                              <span>➕ Add Color</span>
                            </button>
                          </div>
                          <div className="space-y-1">
                            {nutrientColors.map(color => renderColorItem(color))}
                          </div>
                        </div>

                        {/* Theme Action Buttons */}
                        <div className="flex justify-end items-center px-4 py-2 mt-4 gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                          <button
                            type="button"
                            onClick={() => setProfile({
                              ...profile,
                              marginScale: undefined,
                              paddingScale: undefined,
                              cornerRadius: undefined,
                              shadowScale: undefined,
                              themePalette: undefined,
                              customColors: undefined,
                              customFonts: undefined,
                              fontSize: undefined,
                              fontFamily: undefined,
                              fontMono: undefined,
                              fontSizeTitle: undefined,
                              fontSizeSubtitle: undefined,
                              fontSizeDescription: undefined,
                              fontSizeBodySmall: undefined,
                              fontSizeSubtitleSmall: undefined,
                              fontSizeKeyMetric: undefined,
                              fontSizeXS: undefined,
                              fontSizeBody: undefined
                            })}
                            className="px-4 py-2 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm"
                          >
                            {t.themeReset}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* FONTS SECTION */}
              {themeActiveSection === 'fonts' && (
                <div className="grid grid-cols-2 gap-3">
                  {fontsList.map((font: any) => {
                    const activeVal = (profile as any)[font.fontSizeKey] || 'normal';
                    return (
                      <div key={font.key} className="relative group p-3 rounded-2xl flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm gap-2 text-center">
                        {/* Inline editable label */}
                        <input
                          type="text"
                          value={font.label}
                          onChange={(e) => handleRenameFont(font.key, e.target.value)}
                          className="text-[11px] font-bold text-slate-800 dark:text-slate-100 w-full text-center bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer truncate mb-1"
                          title="Click to rename"
                        />
                        <CustomFontSelect value={activeVal} options={font.options} onChange={(val) => setProfile({ ...profile, [font.fontSizeKey]: val })} />
                      </div>
                    );
                  })}

                  <div className="p-3 rounded-2xl space-y-2 flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm">
                    <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 text-center">Sans Font</span>
                    <CustomFontSelect isFamily value={profile.fontFamily || 'Inter'} options={[
                      {value: 'Inter', label: 'Inter'},
                      {value: 'Space Grotesk', label: 'Space Grotesk'},
                      {value: 'Outfit', label: 'Outfit'},
                      {value: 'Playfair Display', label: 'Playfair Display'},
                      {value: 'Merriweather', label: 'Merriweather'},
                      {value: 'system-ui', label: 'System UI'},
                      {value: 'Roboto', label: 'Roboto'},
                      {value: 'Open Sans', label: 'Open Sans'},
                      {value: 'Lato', label: 'Lato'},
                      {value: 'Montserrat', label: 'Montserrat'},
                      {value: 'Poppins', label: 'Poppins'}
                    ]} onChange={(val) => setProfile({ ...profile, fontFamily: val })} />
                  </div>

                  <div className="p-3 rounded-2xl space-y-2 flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 shadow-sm">
                    <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 text-center">Mono Font</span>
                    <CustomFontSelect isFamily value={profile.fontMono || 'JetBrains Mono'} options={[
                      {value: 'JetBrains Mono', label: 'JetBrains Mono'},
                      {value: 'Courier New', label: 'Courier New'}
                    ]} onChange={(val) => setProfile({ ...profile, fontMono: val })} />
                  </div>
                </div>
              )}

              {/* DESIGN TOKENS SECTION */}
              {themeActiveSection === 'tokens' && (
                <div className="grid grid-cols-2 gap-3">
                  {auditDesignTokens.map((token) => {
                    const activeVal = (profile as any)[token.tokenKey] || token.defaultValue;
                    return (
                      <div key={token.key} className="p-3 rounded-2xl space-y-2 flex flex-col items-center justify-center">
                        <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100 text-center">{token.label}</span>
                        <select
                          value={activeVal}
                          onChange={(e) => setProfile({ ...profile, [token.tokenKey]: e.target.value })}
                          className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-250 dark:border-slate-700 rounded-xl px-2 py-1.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer text-center"
                        >
                          {token.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label.split(' ')[0]}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* COMPONENTS SECTION */}
              {themeActiveSection === 'components' && (
                <div className="grid grid-cols-1 gap-4">
                  <div className="p-4 rounded-3xl flex flex-col gap-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Top Targets Progress Bar</span>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Calories</span>
                          <span className="text-slate-500 font-mono">1500kcal / 2000kcal</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-indigo-500 h-2 rounded-full" style={{ width: '75%' }}></div>
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Protein</span>
                          <span className="text-slate-500 font-mono">60g / 73g</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '82%' }}></div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Saturated Fat</span>
                          <span className="text-slate-500 font-mono">18g / 15g</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-rose-500 h-2 rounded-full" style={{ width: '100%' }}></div>
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Sodium</span>
                          <span className="text-slate-500 font-mono">1200mg / 2000mg</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-amber-500 h-2 rounded-full" style={{ width: '60%' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-3xl flex flex-col items-center justify-center gap-4">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider self-start">Nutrients Pie Chart</span>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 w-full">
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={2000} alreadyConsumed={500} mealValue={400} nutrientKey="calories" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Calories</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={60} alreadyConsumed={20} mealValue={15} nutrientKey="protein" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Protein</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={300} alreadyConsumed={100} mealValue={80} nutrientKey="carbs" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Carbs</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={65} alreadyConsumed={20} mealValue={15} nutrientKey="fat" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Fat</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={20} alreadyConsumed={5} mealValue={2} nutrientKey="saturatedFat" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Sat Fat</span>
                       </div>
                       <div className="flex flex-col items-center gap-2">
                         <NutrientPieChart allowance={2300} alreadyConsumed={1000} mealValue={400} nutrientKey="sodium" size="lg" />
                         <span className="text-[10px] font-semibold text-slate-500 uppercase">Sodium</span>
                       </div>
                    </div>
                  </div>

                  
                  <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">LogChat Bubble</span>
                    <div className="self-end bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm shadow-sm max-w-[85%] font-medium">
                      I had a grilled chicken salad and a glass of milk.
                    </div>
                    <div className="self-start bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm shadow-sm max-w-[85%] font-medium">
                      I've logged 1 chicken salad and 1 glass of milk. (450 kcal)
                    </div>
                  </div>

                  
                  <div className="p-4 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col gap-3 w-full">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">FoodCard Capsule</span>
                    <div className="flex gap-3 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm items-center w-full">
                      <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center text-2xl shadow-inner shrink-0">
                        🥗
                      </div>
                      <div className="flex flex-col flex-1">
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">Grilled Chicken Salad</span>
                        <span className="text-xs text-slate-500 font-medium mt-0.5">350 kcal • 40g Protein</span>
                      </div>
                      <button className="text-slate-400 hover:text-rose-500 p-2 shrink-0">✕</button>
                    </div>
                  </div>

                  
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col gap-3 w-full">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Biomarker Expanded Section</span>
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl w-full">
                      <div className="flex items-center gap-1.5 mb-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
                        <span>Medical Insight</span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed font-medium">
                        Your LDL cholesterol is within optimal range. Maintaining this level reduces cardiovascular risks.
                      </p>
                    </div>
                    <div className="flex justify-between items-center bg-white dark:bg-slate-900 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm w-full">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">More Details</span>
                      <span className="text-slate-400 text-xs">▼</span>
                    </div>
                  </div>

                </div>
              )}

              {/* ELEMENTS SECTION */}
              {themeActiveSection === 'elements' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Primary Button</span>
                    <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm">Action</button>
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Secondary Button</span>
                    <button className="bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-xl text-xs font-semibold transition-all">Secondary</button>
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Form Select</span>
                    <select className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 w-32 focus:outline-none">
                      <option>Option 1</option>
                    </select>
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Input Text</span>
                    <input type="text" placeholder="Type here" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 w-32 focus:outline-none" />
                  </div>
                  <div className="p-4 rounded-2xl flex flex-col items-center justify-center gap-3 col-span-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Status Badges</span>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50">Success</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/50">Warning</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/50">Failure</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-slate-600 bg-slate-100 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700">Neutral</span>
                    </div>
                  </div>
                  <div className="col-span-2 p-4 rounded-2xl flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase text-center">Paragraph Text</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 text-center leading-relaxed font-sans">
                      This is a block of standard paragraph text used throughout the application to convey descriptive guidelines.
                    </p>
                  </div>
                </div>
              )}

              {/* PRESETS SECTION */}
              {themeActiveSection === 'presets' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.themeSavedPresets}</h4>
                      <div className="flex gap-2">
                        <label className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition-all cursor-pointer">
                          {t.themeImportJson}
                          <input type="file" accept=".json" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              try {
                                const parsed = JSON.parse(ev.target?.result as string);
                                let rawPresets: any[] = [];
                                if (Array.isArray(parsed)) {
                                  rawPresets = parsed;
                                } else if (parsed.preset && Array.isArray(parsed.preset)) {
                                  rawPresets = parsed.preset;
                                } else {
                                  rawPresets = [parsed];
                                }
                                const normalized = rawPresets.map(p => normalizeImportedPreset(p)).filter(Boolean);
                                if (normalized.length > 0) {
                                  const updatedPresets = [...(profile.themePresets || [])];
                                  normalized.forEach(p => {
                                    const existingIdx = updatedPresets.findIndex(x => x.name === p.name);
                                    if (existingIdx >= 0) {
                                      updatedPresets[existingIdx] = p;
                                    } else {
                                      updatedPresets.push(p);
                                    }
                                  });
                                  const lastOne = normalized[normalized.length - 1];
                                  const updatedP = {
                                    ...profile,
                                    themePresets: updatedPresets,
                                    themePalette: lastOne.themePalette !== undefined ? lastOne.themePalette : profile.themePalette,
                                    fontFamily: lastOne.fontFamily || profile.fontFamily,
                                    fontMono: lastOne.fontMono || profile.fontMono,
                                    fontSize: lastOne.fontSize || profile.fontSize,
                                    marginScale: lastOne.marginScale || profile.marginScale,
                                    paddingScale: lastOne.paddingScale || profile.paddingScale,
                                    cornerRadius: lastOne.cornerRadius || profile.cornerRadius,
                                    shadowScale: lastOne.shadowScale || profile.shadowScale,
                                    themeOverrides: lastOne.themeOverrides !== undefined ? lastOne.themeOverrides : profile.themeOverrides,
                                    fontSizeTitle: lastOne.fontSizeTitle || profile.fontSizeTitle,
                                    fontSizeSubtitle: lastOne.fontSizeSubtitle || profile.fontSizeSubtitle,
                                    fontSizeDescription: lastOne.fontSizeDescription || profile.fontSizeDescription,
                                    fontSizeBodySmall: lastOne.fontSizeBodySmall || profile.fontSizeBodySmall,
                                    fontSizeSubtitleSmall: lastOne.fontSizeSubtitleSmall || profile.fontSizeSubtitleSmall,
                                    fontSizeKeyMetric: lastOne.fontSizeKeyMetric || profile.fontSizeKeyMetric,
                                    fontSizeXS: lastOne.fontSizeXS || profile.fontSizeXS,
                                    fontSizeBody: lastOne.fontSizeBody || profile.fontSizeBody,
                                    customColors: lastOne.customColors !== undefined ? lastOne.customColors : profile.customColors,
                                    customFonts: lastOne.customFonts !== undefined ? lastOne.customFonts : profile.customFonts
                                  };
                                  setProfile(updatedP);
                                  if (initialThemeSnapshot.current) {
                                    initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                  }
                                  if (onSaveProfile) onSaveProfile(updatedP);
                                }
                              } catch (err) {
                                console.error('Failed to parse presets', err);
                              }
                            };
                            const inputEl = e.target;
                            reader.onloadend = () => {
                              inputEl.value = '';
                            };
                            reader.readAsText(file);
                          }} />
                        </label>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {(() => {
                        const systemPresetsList = [
                          { name: "System Default", isSystem: true, profileUpdate: { marginScale: undefined, paddingScale: undefined, cornerRadius: undefined, shadowScale: undefined, themePalette: undefined, fontSize: undefined, fontFamily: undefined, fontMono: undefined, fontSizeTitle: undefined, fontSizeSubtitle: undefined, fontSizeDescription: undefined, fontSizeBodySmall: undefined, fontSizeSubtitleSmall: undefined, fontSizeKeyMetric: undefined, fontSizeXS: undefined, fontSizeBody: undefined, themeOverrides: [] } },
                          { name: "Accessible High Contrast (Light)", isSystem: true, profileUpdate: { fontFamily: 'Inter', themePalette: { background: '#ffffff', bgCard: '#ffffff', button: '#0f172a', text: '#0f172a', textSecondary: '#1e293b', border: '#0f172a', textAccent: '#1e40af', textMuted: '#334155', textSuccess: '#166534', textError: '#991b1b', warning: '#9a3412', caution: '#854d0e', success: '#166534', info: '#1e40af', neutralSetting: '#1e293b' } } },
                          { name: "Midnight Blue (Dark)", isSystem: true, profileUpdate: { fontFamily: 'Space Grotesk', themePalette: { background: '#000000', bgCard: '#0f172a', button: '#2563eb', text: '#f8fafc', textSecondary: '#cbd5e1', border: '#1e293b', textAccent: '#a5b4fc', textMuted: '#94a3b8', textSuccess: '#4ade80', textError: '#f87171', warning: '#fb7185', caution: '#fbbf24', success: '#34d399', info: '#60a5fa', neutralSetting: '#cbd5e1' } } },
                          { name: "Emerald Forest (Dark)", isSystem: true, profileUpdate: { fontFamily: 'Outfit', themePalette: { background: '#000000', bgCard: '#06231a', button: '#047857', text: '#ecfdf5', textSecondary: '#a7f3d0', border: '#0f3527', textAccent: '#a5b4fc', textMuted: '#a7f3d0', textSuccess: '#4ade80', textError: '#f87171', warning: '#fb7185', caution: '#fbbf24', success: '#34d399', info: '#60a5fa', neutralSetting: '#d1fae5' } } },
                          { name: "Minimalist White (Light)", isSystem: true, profileUpdate: { fontFamily: 'Playfair Display', themePalette: { background: '#ffffff', bgCard: '#fafafa', button: '#18181b', text: '#09090b', textSecondary: '#52525b', border: '#e4e4e7', textMuted: '#71717a', textSuccess: '#15803d' } } }
                        ];

                        const isSystemPresetActive = systemPresetsList.some(preset => {
                          const effectiveUpdate = profile.systemPresetOverrides?.[preset.name] ? { ...preset.profileUpdate, ...profile.systemPresetOverrides[preset.name] } : preset.profileUpdate;
                          return isPresetActive(effectiveUpdate);
                        });
                        const isUserPresetActive = (profile.themePresets || []).some((preset: any) => isPresetActive(preset));
                        const isAnyPresetActive = isSystemPresetActive || isUserPresetActive;

                        return (
                          <>
                            {!isAnyPresetActive && (
                              <div className="p-3.5 rounded-xl border border-indigo-400 dark:border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40 ring-2 ring-indigo-500/30 shadow-sm space-y-2.5 transition-all">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-pulse"></span>
                                    <span className="text-xs font-bold text-indigo-950 dark:text-indigo-100">Custom Theme (Unsaved)</span>
                                  </div>
                                  <span className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    Applied
                                  </span>
                                </div>
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="text"
                                    value={newPresetName}
                                    onChange={(e) => setNewPresetName(e.target.value)}
                                    placeholder="Enter preset name to save..."
                                    className="flex-1 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                                  />
                                  <button
                                    disabled={!newPresetName.trim()}
                                    onClick={() => {
                                      const name = newPresetName.trim();
                                      if (!name) return;
                                      const newPreset = {
                                        name,
                                        themePalette: profile.themePalette,
                                        fontSize: profile.fontSize,
                                        fontFamily: profile.fontFamily,
                                        fontMono: profile.fontMono,
                                        marginScale: profile.marginScale,
                                        paddingScale: profile.paddingScale,
                                        cornerRadius: profile.cornerRadius,
                                        shadowScale: profile.shadowScale,
                                        themeOverrides: profile.themeOverrides,
                                        customColors: profile.customColors,
                                        fontSizeTitle: profile.fontSizeTitle,
                                        fontSizeSubtitle: profile.fontSizeSubtitle,
                                        fontSizeDescription: profile.fontSizeDescription,
                                        fontSizeBodySmall: profile.fontSizeBodySmall,
                                        fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                        fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                        fontSizeXS: profile.fontSizeXS,
                                        fontSizeBody: profile.fontSizeBody,
                                        customFonts: profile.customFonts
                                      };
                                      const updatedP = { ...profile, themePresets: [...(profile.themePresets || []), newPreset] };
                                      setProfile(updatedP);
                                      if (initialThemeSnapshot.current) {
                                        initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                      }
                                      if (onSaveProfile) onSaveProfile(updatedP);
                                      setNewPresetName('');
                                      setJustSavedKey('new-preset');
                                      setTimeout(() => setJustSavedKey(null), 1800);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all shrink-0 ${
                                      !newPresetName.trim()
                                        ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-400 dark:text-indigo-500 cursor-not-allowed'
                                        : justSavedKey === 'new-preset'
                                        ? 'bg-emerald-600 text-white cursor-default'
                                        : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                                    }`}
                                  >
                                    {justSavedKey === 'new-preset' ? '✓ Saved' : 'Save Preset'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {systemPresetsList.map((preset, idx) => {
                              const effectiveUpdate = profile.systemPresetOverrides?.[preset.name] ? { ...preset.profileUpdate, ...profile.systemPresetOverrides[preset.name] } : preset.profileUpdate;
                              const active = isPresetActive(effectiveUpdate);
                              return (
                                <div key={idx} className={`flex justify-between items-center p-3 rounded-xl border shadow-sm transition-all ${active ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-500/30' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                                  <div className="flex items-center gap-2 flex-1 truncate mr-2">
                                    {active && (
                                      <span className="w-4 h-4 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs" title="Preset Applied">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      </span>
                                    )}
                                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{preset.name}</span>
                                  </div>
                                  <div className="flex gap-2 items-center shrink-0">
                                    <button title="Export" onClick={() => {
                                      const exportPayload = buildExportPayload(effectiveUpdate, preset.name);
                                      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement('a');
                                      a.href = url;
                                      a.download = `${preset.name}_preset.json`;
                                      a.click();
                                    }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 rounded-lg transition-all">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                    </button>
                                    {preset.name !== 'System Default' && (
                                      <>
                                        <button onClick={() => {
                                          const updatedP = {
                                            ...profile,
                                            systemPresetOverrides: {
                                              ...(profile.systemPresetOverrides || {}),
                                              [preset.name]: {
                                                themePalette: profile.themePalette,
                                                fontSize: profile.fontSize,
                                                fontFamily: profile.fontFamily,
                                                fontMono: profile.fontMono,
                                                marginScale: profile.marginScale,
                                                paddingScale: profile.paddingScale,
                                                cornerRadius: profile.cornerRadius,
                                                shadowScale: profile.shadowScale,
                                                themeOverrides: profile.themeOverrides,
                                                customColors: profile.customColors,
                                                fontSizeTitle: profile.fontSizeTitle,
                                                fontSizeSubtitle: profile.fontSizeSubtitle,
                                                fontSizeDescription: profile.fontSizeDescription,
                                                fontSizeBodySmall: profile.fontSizeBodySmall,
                                                fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                                fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                                fontSizeXS: profile.fontSizeXS,
                                                fontSizeBody: profile.fontSizeBody,
                                                customFonts: profile.customFonts
                                              }
                                            }
                                          };
                                          setProfile(updatedP);
                                          if (initialThemeSnapshot.current) {
                                            initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                          }
                                          if (onSaveProfile) onSaveProfile(updatedP);
                                          setJustSavedKey('system-update-' + preset.name);
                                          setTimeout(() => setJustSavedKey(null), 1800);
                                        }} className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-800 transition-all">{justSavedKey === 'system-update-' + preset.name ? '✓ Saved' : 'Update'}</button>
                                        {profile.systemPresetOverrides?.[preset.name] && (
                                          <button
                                            type="button"
                                            title="Reset to original preset"
                                            onClick={() => {
                                              const next = { ...(profile.systemPresetOverrides || {}) };
                                              delete next[preset.name];
                                              const updatedP = { ...profile, systemPresetOverrides: next };
                                              setProfile(updatedP);
                                              if (initialThemeSnapshot.current) {
                                                initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                              }
                                              if (onSaveProfile) onSaveProfile(updatedP);
                                            }}
                                            className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg transition-all"
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {active ? (
                                      <span className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                        Applied
                                      </span>
                                    ) : (
                                      <button onClick={() => {
                                        applyPresetConfig(effectiveUpdate);
                                      }} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition-all">Apply Default</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {(profile.themePresets || []).map((preset, idx) => {
                              const active = isPresetActive(preset);
                              return (
                              <div key={'user'+idx} className={`flex justify-between items-center p-3 rounded-xl border shadow-sm transition-all ${active ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-500/30' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
                                <div className="flex items-center gap-2 flex-1 truncate mr-2">
                                  {active && (
                                    <span className="w-4 h-4 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs" title="Preset Applied">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    </span>
                                  )}
                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{preset.name}</span>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                  <button title="Export" onClick={() => {
                                    const exportPayload = buildExportPayload(preset, preset.name);
                                    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${preset.name || 'theme'}_preset.json`;
                                    a.click();
                                  }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 rounded-lg transition-all">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                  </button>
                                  <button onClick={() => {
                                    const newPresets = [...(profile.themePresets || [])];
                                    newPresets[idx] = {
                                      ...preset,
                                      themePalette: profile.themePalette,
                                      fontSize: profile.fontSize,
                                      fontFamily: profile.fontFamily,
                                      fontMono: profile.fontMono,
                                      marginScale: profile.marginScale,
                                      paddingScale: profile.paddingScale,
                                      cornerRadius: profile.cornerRadius,
                                      shadowScale: profile.shadowScale,
                                      themeOverrides: profile.themeOverrides,
                                      customColors: profile.customColors,
                                      fontSizeTitle: profile.fontSizeTitle,
                                      fontSizeSubtitle: profile.fontSizeSubtitle,
                                      fontSizeDescription: profile.fontSizeDescription,
                                      fontSizeBodySmall: profile.fontSizeBodySmall,
                                      fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                      fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                      fontSizeXS: profile.fontSizeXS,
                                      fontSizeBody: profile.fontSizeBody,
                                      customFonts: profile.customFonts
                                    };
                                    const updatedP = { ...profile, themePresets: newPresets };
                                    setProfile(updatedP);
                                    if (initialThemeSnapshot.current) {
                                      initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                    }
                                    if (onSaveProfile) onSaveProfile(updatedP);
                                    setJustSavedKey('user-update-' + idx);
                                    setTimeout(() => setJustSavedKey(null), 1800);
                                  }} className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-800 transition-all">{justSavedKey === 'user-update-' + idx ? '✓ Saved' : 'Update'}</button>
                                  <button onClick={() => {
                                    applyPresetConfig(preset);
                                  }} className={active ? "hidden" : "px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-semibold border border-indigo-200 dark:border-indigo-800 transition-all"}>{t.themeApply}</button>
                                  {active && (
                                    <span className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      Applied
                                    </span>
                                  )}
                                  <button onClick={() => {
                                    const newPresets = [...(profile.themePresets || [])];
                                    newPresets.splice(idx, 1);
                                    const updatedP = { ...profile, themePresets: newPresets };
                                    setProfile(updatedP);
                                    if (initialThemeSnapshot.current) {
                                      initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                                    }
                                    if (onSaveProfile) onSaveProfile(updatedP);
                                  }} className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-semibold border border-rose-200 dark:border-rose-800 transition-all">{t.themeDelete}</button>
                                </div>
                              </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-850 space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Current Theme Status</h4>
                      <span className="text-xs font-semibold text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded-md">
                        {getThemeVariableChangesCount()} Variable Changes
                      </span>
                    </div>
                    {(() => {
                      const isCurrentConfigSaved = (profile.themePresets || []).some((p: any) => isPresetActive(p));
                      return (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Preset Name</label>
                            <input
                              type="text"
                              value={newPresetName}
                              onChange={(e) => setNewPresetName(e.target.value)}
                              placeholder="e.g. My Custom Theme"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                            />
                          </div>
                          <button 
                            disabled={!newPresetName.trim()}
                            onClick={() => {
                              const name = newPresetName.trim();
                              if (!name) return;
                              const newPreset = {
                                name,
                                themePalette: profile.themePalette,
                                fontSize: profile.fontSize,
                                fontFamily: profile.fontFamily,
                                fontMono: profile.fontMono,
                                marginScale: profile.marginScale,
                                paddingScale: profile.paddingScale,
                                cornerRadius: profile.cornerRadius,
                                shadowScale: profile.shadowScale,
                                themeOverrides: profile.themeOverrides,
                                customColors: profile.customColors,
                                fontSizeTitle: profile.fontSizeTitle,
                                fontSizeSubtitle: profile.fontSizeSubtitle,
                                fontSizeDescription: profile.fontSizeDescription,
                                fontSizeBodySmall: profile.fontSizeBodySmall,
                                fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
                                fontSizeKeyMetric: profile.fontSizeKeyMetric,
                                fontSizeXS: profile.fontSizeXS,
                                fontSizeBody: profile.fontSizeBody,
                                customFonts: profile.customFonts
                              };
                              const updatedP = { ...profile, themePresets: [...(profile.themePresets || []), newPreset] };
                              setProfile(updatedP);
                              if (initialThemeSnapshot.current) {
                                initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
                              }
                              if (onSaveProfile) onSaveProfile(updatedP);
                              setNewPresetName('');
                              setJustSavedKey('new-preset');
                              setTimeout(() => setJustSavedKey(null), 1800);
                            }} 
                            className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all text-center ${!newPresetName.trim() ? 'bg-slate-100 dark:bg-slate-900 text-slate-400 dark:text-slate-600 cursor-not-allowed' : justSavedKey === 'new-preset' ? 'bg-emerald-600 text-white cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'}`}
                          >
                            {justSavedKey === 'new-preset' ? '✓ Preset Saved' : 'Save Current Configuration as Preset'}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </>
      ), document.body)}
    </>
  );
}
