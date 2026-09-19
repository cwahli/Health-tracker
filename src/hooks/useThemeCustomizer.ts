import { useState, useEffect, useRef } from 'react';
import { auditColors, auditDesignTokens, auditFonts } from '../utils/themeRegistry';
import type { UserProfile } from '../types';

/**
 * Q-11.12 (move-only): the theme-customizer state, refs, effects, handlers and
 * pure helpers, moved verbatim out of Header.tsx. Header's render body keeps only
 * the trigger; ThemeCustomizerScreen.tsx renders the portal with what this hook
 * returns. Nothing was rewritten: the moved statements are byte-identical, and the
 * project-mutation path still goes through the same `setProfile` / `onSaveProfile`.
 */

export interface UseThemeCustomizerParams {
  profile: UserProfile;
  setProfile: (p: UserProfile | ((prev: UserProfile) => UserProfile) | any) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  /** Active translation pack — the theme portal renders labels from it. */
  t: Record<string, string>;
}

export function useThemeCustomizer({ profile, setProfile, onSaveProfile, t }: UseThemeCustomizerParams) {
  const [showThemeScreen, setShowThemeScreen] = useState(false);
  const [themePreviewMode, setThemePreviewMode] = useState(false);
  const [themeCompactMode, setThemeCompactMode] = useState(false);
  
  const [themeActiveSection, setThemeActiveSection] = useState<'colors' | 'fonts' | 'tokens' | 'components' | 'elements' | 'presets'>('colors');
  const [expandedColorKey, setExpandedColorKey] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<{ key: string; label: string; value: string } | null>(null);
  const [textPreviewOverride, setTextPreviewOverride] = useState<Record<string, 'light' | 'dark'>>({});
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [inspectedElement, setInspectedElement] = useState<any>(null);
  const [inspectorPaused, setInspectorPaused] = useState(false);
  const [inspectorProperty, setInspectorProperty] = useState('color');
  const [inspectorVariable, setInspectorVariable] = useState('');

  const initialThemeSnapshot = useRef<any>(null);
  const colorOriginalVal = useRef<Record<string, string>>({});

  useEffect(() => {
    if (showThemeScreen) {
      setThemePreviewMode(true);
      setInspectorPaused(false);

      initialThemeSnapshot.current = JSON.parse(JSON.stringify({
        themePalette: profile.themePalette,
        customColors: profile.customColors,
        customFonts: profile.customFonts,
        fontSize: profile.fontSize,
        fontFamily: profile.fontFamily,
        fontMono: profile.fontMono,
        fontSizeTitle: profile.fontSizeTitle,
        fontSizeSubtitle: profile.fontSizeSubtitle,
        fontSizeDescription: profile.fontSizeDescription,
        fontSizeBodySmall: profile.fontSizeBodySmall,
        fontSizeSubtitleSmall: profile.fontSizeSubtitleSmall,
        fontSizeKeyMetric: profile.fontSizeKeyMetric,
        fontSizeXS: profile.fontSizeXS,
        fontSizeBody: profile.fontSizeBody,
        marginScale: profile.marginScale,
        paddingScale: profile.paddingScale,
        cornerRadius: profile.cornerRadius,
        shadowScale: profile.shadowScale,
        themeOverrides: profile.themeOverrides
      }));
    } else {
      if (initialThemeSnapshot.current) {
        setProfile(prev => ({
          ...prev,
          ...initialThemeSnapshot.current
        }));
        initialThemeSnapshot.current = null;
      }
      setThemePreviewMode(false);
      revertPreview();
      setInspectedElement(null);
    }
  }, [showThemeScreen]);
  useEffect(() => {
    if (!themePreviewMode) {
      revertPreview();
      setInspectedElement(null);
      return;
    }
    const handler = (e: MouseEvent) => {
      if ((e.target as Element).closest('#theme-customizer-screen') || (e.target as Element).closest('#font-select-portal') || (e.target as Element).closest('#font-select-overlay')) {
        revertPreview();
        setInspectedElement(null);
        return;
      }
      if ((e.target as Element).closest('#inspector-popup')) return;
      if (inspectorPaused) return; // let the click through untouched
      e.preventDefault();
      e.stopPropagation();
      
      revertPreview();

      const el = e.target as HTMLElement;
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector = '#' + el.id;
      } else if (el.className && typeof el.className === 'string') {
        const cls = el.className.split(' ').map(c => c.trim()).filter(c => c && !c.includes(':') && !c.includes('/') && !c.includes('[') && !c.includes('!')).join('.');
        if (cls) selector += '.' + cls;
      }
      
      setInspectedElement({
        el,
        selector,
        rect: el.getBoundingClientRect(),
        text: el.innerText ? el.innerText.substring(0, 20) : 'Element'
      });
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [themePreviewMode, inspectorPaused]);

  // Handle saving overrides
  const saveOverride = () => {
    if (!inspectedElement || !inspectorVariable) return;
    const existingOverrides = profile.themeOverrides || [];
    const filteredOverrides = existingOverrides.filter(
      (o: any) => !(o.selector === inspectedElement.selector && o.property === inspectorProperty)
    );
    const newOverrides = [...filteredOverrides, {
      selector: inspectedElement.selector,
      property: inspectorProperty,
      variable: inspectorVariable
    }];
    setProfile({ ...profile, themeOverrides: newOverrides });
    inspectorOriginalValue.current = null;
    setInspectedElement(null);
  };

  // Dynamic color/font registry helpers
  const handleRenameColor = (key: string, newLabel: string) => {
    const currentList = [...(profile.customColors || auditColors)];
    const updatedList = currentList.map((c: any) => c.key === key ? { ...c, label: newLabel } : c);
    setProfile({ ...profile, customColors: updatedList });
  };

  const handleDeleteColor = (key: string) => {
    const currentList = [...(profile.customColors || auditColors)];
    const updatedList = currentList.filter((c: any) => c.key !== key);
    // Also remove from themePalette if present
    const nextPalette = { ...(profile.themePalette || {}) };
    delete (nextPalette as any)[key];
    setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
  };

  const handleAddColor = (category: 'general' | 'text' | 'status' | 'nutrients') => {
    const currentList = [...(profile.customColors || auditColors)];
    const newKey = `custom_${Date.now()}`;
    const newColor = {
      key: newKey,
      label: 'New ' + (category === 'general' ? 'General' : category === 'text' ? 'Text' : category === 'status' ? 'Status' : 'Nutrients') + ' Color',
      description: 'Custom added color variable',
      defaultHex: '#3b82f6',
      tailwindVar: '',
      category: category
    };
    const updatedList = [...currentList, newColor];
    const nextPalette = { ...(profile.themePalette || {}) };
    (nextPalette as any)[newKey] = '#3b82f6'; // set default color value
    setProfile({ ...profile, customColors: updatedList, themePalette: nextPalette });
  };

  const handleRenameFont = (key: string, newLabel: string) => {
    const currentList = [...(profile.customFonts || auditFonts)];
    const updatedList = currentList.map((f: any) => f.key === key ? { ...f, label: newLabel } : f);
    setProfile({ ...profile, customFonts: updatedList });
  };

  const THEME_CATEGORY_SECTION_LABELS: Record<string, string> = {
    general: 'General colours',
    text: 'Text colour',
    status: 'Status',
    nutrients: 'Nutrients & Targets'
  };

  const buildExportPayload = (presetConfig: any, presetName: string) => {
    const colorsSource = profile.customColors || auditColors;
    const fontsSource = profile.customFonts || auditFonts;
    const palette = presetConfig?.themePalette || {};

    const colours: Record<string, Record<string, string>> = {};
    colorsSource.forEach((c: any) => {
      let sectionLabel = THEME_CATEGORY_SECTION_LABELS[c.category];
      if (c.category === 'text' || ['text', 'textSecondary', 'textDarkPrimary', 'textDarkSecondary', 'textAccent', 'textMuted', 'textSuccess', 'textError'].includes(c.key)) {
        const getEffectiveGroupForColor = (col: any) => {
          if (textPreviewOverride[col.key]) return textPreviewOverride[col.key];
          if (col.key === 'textDarkPrimary' || col.key === 'textDarkSecondary') return 'dark';
          if (col.key === 'text' || col.key === 'textSecondary' || col.key === 'textAccent' || col.key === 'textMuted' || col.key === 'textSuccess' || col.key === 'textError') return 'light';
          return col.darkGroup || 'light';
        };
        const mode = getEffectiveGroupForColor(c);
        sectionLabel = mode === 'dark' ? 'Text colour: Text over dark' : 'Text colour: Text over light';
      }
      if (!sectionLabel) sectionLabel = 'Other colours';
      if (!colours[sectionLabel]) colours[sectionLabel] = {};
      const value = palette[c.key] !== undefined ? palette[c.key] : c.defaultHex;
      const displayName = c.key?.startsWith('custom_') ? `${c.label} (custom)` : c.label;
      colours[sectionLabel][displayName] = value;
    });

    const fonts: Record<string, any> = {};
    fontsSource.forEach((f: any) => {
      const currentVal = presetConfig?.[f.fontSizeKey] || 'normal';
      const currentOption = (f.options || []).find((o: any) => o.value === currentVal);
      const scale: Record<string, string> = {};
      (f.options || []).forEach((o: any) => { scale[o.value] = o.label; });
      const displayName = f.key?.startsWith('custom_') ? `${f.label} (custom)` : f.label;
      fonts[displayName] = {
        current: currentOption ? currentOption.label : currentVal,
        scale
      };
    });
    fonts['Sans Font'] = { current: presetConfig?.fontFamily || 'Inter', scale: null };
    fonts['Mono Font'] = { current: presetConfig?.fontMono || 'JetBrains Mono', scale: null };

    const tokens: Record<string, any> = {};
    auditDesignTokens.forEach((t) => {
      const currentVal = presetConfig?.[t.tokenKey] || t.defaultValue;
      const currentOption = (t.options || []).find((o) => o.value === currentVal);
      const scale: Record<string, string> = {};
      (t.options || []).forEach((o) => { scale[o.value] = o.label; });
      tokens[t.label] = {
        current: currentOption ? currentOption.label : currentVal,
        scale
      };
    });

    return {
      _meta: {
        format: 'health-tracker-3-theme-preset',
        version: 2,
        note: "Every colour, font, and layout token below is listed by its current display name (including custom renames) and computed value, grouped into the same sections shown in this app's theme editor. To import, match each name to the corresponding variable in the theme editor and apply its value."
      },
      preset: {
        name: presetName,
        colours,
        fonts,
        tokens,
        themeOverrides: presetConfig?.themeOverrides
      }
    };
  };

  const normalizeImportedPreset = (rawInput: any) => {
    if (!rawInput) return null;
    let rawPreset = rawInput.preset && typeof rawInput.preset === 'object' && !Array.isArray(rawInput.preset) ? rawInput.preset : rawInput;

    const name = rawPreset.name || 'Imported Preset';
    const themePalette = rawPreset.themePalette ? { ...rawPreset.themePalette } : {};
    let fontFamily = rawPreset.fontFamily || 'Inter';
    let fontMono = rawPreset.fontMono || 'JetBrains Mono';
    const themeOverrides = rawPreset.themeOverrides || [];

    const presetResult: any = {
      ...rawPreset,
      name,
      themePalette,
      fontFamily,
      fontMono,
      themeOverrides
    };

    if (rawPreset.colours && typeof rawPreset.colours === 'object') {
      const colorsSource = profile.customColors || auditColors;
      Object.entries(rawPreset.colours).forEach(([sectionName, section]: [string, any]) => {
        if (section && typeof section === 'object') {
          Object.entries(section).forEach(([displayName, hexVal]: [string, any]) => {
            if (typeof hexVal === 'string') {
              const cleanName = displayName.replace(' (custom)', '').replace(/_/g, ' ').trim();
              
              let match = colorsSource.find((c: any) => 
                c.label === cleanName || 
                c.label === displayName || 
                c.key === cleanName || 
                c.key === displayName ||
                c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, '') ||
                c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, ' ')
              );

              if (!match) {
                match = auditColors.find((c: any) => 
                  c.label === cleanName || 
                  c.label === displayName || 
                  c.key === cleanName || 
                  c.key === displayName ||
                  c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, '') ||
                  c.key.toLowerCase() === displayName.toLowerCase().replace(/_/g, ' ')
                );
              }

              if (!match) {
                const lower = cleanName.toLowerCase();
                const lowerSection = (sectionName || '').toLowerCase();
                let keyMatch: string | null = null;

                if (lower.includes('primary text over dark') || (lowerSection.includes('over dark') && lower.includes('primary'))) keyMatch = 'textDarkPrimary';
                else if (lower.includes('secondary text over dark') || (lowerSection.includes('over dark') && lower.includes('secondary'))) keyMatch = 'textDarkSecondary';
                else if (lower.includes('primary text') || lower === 'primary text over light') keyMatch = 'text';
                else if (lower.includes('secondary text') || lower === 'secondary text light') keyMatch = 'textSecondary';
                else if (lower.includes('highlight text') || lower.includes('accent highlight')) keyMatch = 'textAccent';
                else if (lower.includes('muted hint') || lower.includes('muted')) keyMatch = 'textMuted';
                else if (lower.includes('success text')) keyMatch = 'textSuccess';
                else if (lower.includes('critical alert') || lower.includes('critical text') || lower.includes('error text')) keyMatch = 'textError';
                else if (lower.includes('buttons') || lower.includes('button')) keyMatch = 'button';
                else if (lower.includes('app background') || lower.includes('background')) keyMatch = 'background';
                else if (lower.includes('card') || lower.includes('container')) keyMatch = 'bgCard';
                else if (lower.includes('border') || lower.includes('divider')) keyMatch = 'border';
                else if (lower.includes('neutral setting') || lower.includes('neutral')) keyMatch = 'neutralSetting';
                else if (lower.includes('severe warning') || lower.includes('warning') || lower.includes('rose')) keyMatch = 'warning';
                else if (lower.includes('caution') || lower.includes('amber')) keyMatch = 'caution';
                else if (lower.includes('success highlight') || lower.includes('success')) keyMatch = 'success';
                else if (lower.includes('information') || lower.includes('info') || lower.includes('blue')) keyMatch = 'info';
                else if (lower.includes('calories')) keyMatch = 'nutrientCalories';
                else if (lower.includes('protein')) keyMatch = 'nutrientProtein';
                else if (lower.includes('carbs') || lower.includes('carbohydrate')) keyMatch = 'nutrientCarbs';
                else if (lower.includes('sat. fat') || lower.includes('saturated fat') || lower.includes('sat fat')) keyMatch = 'nutrientSatFat';
                else if (lower.includes('fat')) keyMatch = 'nutrientFat';
                else if (lower.includes('sodium')) keyMatch = 'nutrientSodium';

                if (keyMatch) {
                  match = auditColors.find((c: any) => c.key === keyMatch);
                }
              }

              if (match) {
                themePalette[match.key] = hexVal;
              }
            }
          });
        }
      });
      presetResult.themePalette = themePalette;
    }

    if (rawPreset.fonts && typeof rawPreset.fonts === 'object') {
      const fontsSource = profile.customFonts || auditFonts;
      Object.entries(rawPreset.fonts).forEach(([displayName, fontData]: [string, any]) => {
        if (displayName === 'Sans Font' && (fontData?.current || typeof fontData === 'string')) {
          presetResult.fontFamily = fontData.current || fontData;
        } else if (displayName === 'Mono Font' && (fontData?.current || typeof fontData === 'string')) {
          presetResult.fontMono = fontData.current || fontData;
        } else if (fontData) {
          const cleanName = displayName.replace(' (custom)', '').trim();
          let match = fontsSource.find((f: any) => f.label === cleanName || f.label === displayName || f.key === cleanName);
          if (!match) {
            match = auditFonts.find((f: any) => f.label === cleanName || f.label === displayName || f.key === cleanName);
          }
          if (!match) {
            const lower = cleanName.toLowerCase();
            if (lower.includes('base root') || lower.includes('root font')) match = auditFonts.find(f => f.key === 'fontSize');
            else if (lower.includes('heading') || lower.includes('title font')) match = auditFonts.find(f => f.key === 'fontSizeTitle');
            else if (lower.includes('subtitle font')) match = auditFonts.find(f => f.key === 'fontSizeSubtitle');
            else if (lower.includes('standard body') || lower.includes('body font')) match = auditFonts.find(f => f.key === 'fontSizeBody');
            else if (lower.includes('supporting') || lower.includes('caption font')) match = auditFonts.find(f => f.key === 'fontSizeBodySmall');
            else if (lower.includes('small section') || lower.includes('tag font')) match = auditFonts.find(f => f.key === 'fontSizeSubtitleSmall');
            else if (lower.includes('key metric')) match = auditFonts.find(f => f.key === 'fontSizeKeyMetric');
            else if (lower.includes('micro') || lower.includes('label font')) match = auditFonts.find(f => f.key === 'fontSizeXS');
          }

          if (match) {
            const val = fontData.current || fontData;
            const optMatch = (match.options || []).find((o: any) => 
              o.label === val || 
              o.value === val || 
              (typeof val === 'string' && (
                o.label.toLowerCase() === val.toLowerCase() ||
                o.value.toLowerCase() === val.toLowerCase() ||
                o.label.toLowerCase().includes(val.toLowerCase()) ||
                val.toLowerCase().includes(o.value.toLowerCase())
              ))
            );
            presetResult[match.fontSizeKey] = optMatch ? optMatch.value : val;
          }
        }
      });
    }

    if (rawPreset.tokens && typeof rawPreset.tokens === 'object') {
      Object.entries(rawPreset.tokens).forEach(([tokenLabel, tokenData]: [string, any]) => {
        let match = auditDesignTokens.find(t => t.label === tokenLabel || t.key === tokenLabel);
        if (!match) {
          const lower = tokenLabel.toLowerCase();
          if (lower.includes('margin')) match = auditDesignTokens.find(t => t.tokenKey === 'marginScale');
          else if (lower.includes('padding')) match = auditDesignTokens.find(t => t.tokenKey === 'paddingScale');
          else if (lower.includes('corner') || lower.includes('rounding')) match = auditDesignTokens.find(t => t.tokenKey === 'cornerRadius');
          else if (lower.includes('shadow')) match = auditDesignTokens.find(t => t.tokenKey === 'shadowScale');
        }

        if (match && tokenData) {
          const val = tokenData.current || tokenData;
          const optMatch = (match.options || []).find(o => 
            o.label === val || 
            o.value === val || 
            (typeof val === 'string' && (
              o.label.toLowerCase() === val.toLowerCase() ||
              o.value.toLowerCase() === val.toLowerCase() ||
              o.label.toLowerCase().includes(val.toLowerCase()) ||
              val.toLowerCase().includes(o.value.toLowerCase())
            ))
          );
          presetResult[match.tokenKey] = optMatch ? optMatch.value : val;
        }
      });
    }

    return presetResult;
  };

  const PRESET_COMPARE_KEYS = ['themePalette', 'fontFamily', 'fontMono', 'fontSize', 'marginScale', 'paddingScale', 'cornerRadius', 'shadowScale', 'themeOverrides', 'customColors', 'fontSizeTitle', 'fontSizeSubtitle', 'fontSizeDescription', 'fontSizeBodySmall', 'fontSizeSubtitleSmall', 'fontSizeKeyMetric', 'fontSizeXS', 'fontSizeBody', 'customFonts'];

  const normalizePresetValue = (v: any) => {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v) && v.length === 0) return null;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return null;
    return v;
  };

  const deepEqual = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(k => deepEqual(a[k], b[k]));
    }
    return false;
  };

  const isPresetActive = (presetConfig: any) => {
    if (!presetConfig) return false;
    return PRESET_COMPARE_KEYS.every(k =>
      deepEqual(normalizePresetValue((profile as any)[k]), normalizePresetValue((presetConfig as any)[k]))
    );
  };

  const applyPresetConfig = (presetConfig: any) => {
    const updatedP = { ...profile };
    PRESET_COMPARE_KEYS.forEach(k => {
      if (presetConfig && presetConfig[k] !== undefined && presetConfig[k] !== null) {
        updatedP[k] = presetConfig[k];
      } else {
        updatedP[k] = k === 'themeOverrides' ? [] : null;
      }
    });
    
    // Critical fix: Ensure local profile is unmistakably newer than the cloud profile
    // to prevent aggressive remote-sync from reverting the theme immediately after applying.
    updatedP.lastUpdatedAt = Date.now();
    sessionStorage.setItem('localThemeOverridesCloud', 'true');

    setProfile(updatedP);
    if (initialThemeSnapshot.current) {
      initialThemeSnapshot.current = JSON.parse(JSON.stringify(updatedP));
    }
    if (onSaveProfile) onSaveProfile(updatedP);
  };

  const getThemeVariableChangesCount = () => {
    let count = profile.themeOverrides?.length || 0;
    
    // Track customized values in themePalette compared to defaults
    if (profile.themePalette) {
      Object.entries(profile.themePalette).forEach(([key, val]) => {
        const defaultColor = auditColors.find((c: any) => c.key === key);
        if (defaultColor && val && (defaultColor as any).defaultValue !== val) {
          count++;
        }
      });
    }

    const currentColors = profile.customColors || auditColors;
    currentColors.forEach((color: any) => {
      const defaultColor = auditColors.find((c: any) => c.key === color.key);
      if (defaultColor) {
        if (defaultColor.label !== color.label) {
          count++;
        }
      } else {
        count++; // New color added
      }
    });

    // Also count any deleted default colors
    auditColors.forEach((dc: any) => {
      const stillExists = currentColors.some((c: any) => c.key === dc.key);
      if (!stillExists) {
        count++;
      }
    });

    const currentFonts = profile.customFonts || auditFonts;
    currentFonts.forEach((font: any) => {
      const defaultFont = auditFonts.find((f: any) => f.key === font.key);
      if (defaultFont) {
        if (defaultFont.label !== font.label) {
          count++;
        }
      } else {
        count++; // New font added
      }
    });

    return count;
  };

  const colorsList = profile.customColors || auditColors;
  const fontsList = profile.customFonts || auditFonts;

  const getColorVariable = (key: string) => {
    const map: Record<string, string> = {
      button: '--color-indigo-500',
      background: '--app-bg',
      bgCard: '--app-bg-card',
      border: '--app-border',
      text: '--app-text',
      textSecondary: '--app-text-secondary',
      textAccent: '--color-text-accent',
      textMuted: '--color-text-muted',
      warning: '--color-rose-500',
      caution: '--color-amber-500',
      success: '--color-emerald-500',
      info: '--color-blue-500',
      neutralSetting: '--app-neutral',
      nutrientCalories: '--color-nutrient-calories',
      nutrientProtein: '--color-nutrient-protein',
      nutrientCarbs: '--color-nutrient-carbohydrates',
      nutrientFat: '--color-nutrient-totalFat',
      nutrientSatFat: '--color-nutrient-saturatedFat',
      nutrientSodium: '--color-nutrient-sodium'
    };
    return map[key] || `--color-${key}`;
  };

  const detectCurrentVariable = (el: HTMLElement, property: string) => {
    const cssProp = property === 'color' ? 'color' : property === 'background-color' ? 'backgroundColor' : property === 'border-color' ? 'borderColor' : null;
    if (!cssProp) return '';
    const currentValue = getComputedStyle(el)[cssProp as any];
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    let matched = '';
    for (const color of colorsList) {
      (probe.style as any)[cssProp] = `var(${getColorVariable(color.key)})`;
      if (getComputedStyle(probe)[cssProp as any] === currentValue) {
        matched = `var(${getColorVariable(color.key)})`;
        break;
      }
    }
    document.body.removeChild(probe);
    return matched;
  };

  useEffect(() => {
    if (inspectedElement?.el) {
      setInspectorVariable(detectCurrentVariable(inspectedElement.el, inspectorProperty));
    }
  }, [inspectedElement, inspectorProperty]);

  const inspectorOriginalValue = useRef<{ el: HTMLElement; property: string; value: string } | null>(null);

  const applyPreview = (variable: string, property: string, el: HTMLElement) => {
    const cssPropMap: Record<string, string> = {
      'color': 'color',
      'background-color': 'backgroundColor',
      'border-color': 'borderColor',
      'font-family': 'fontFamily',
      'font-size': 'fontSize'
    };
    const cssProp = cssPropMap[property];
    if (!cssProp) return;

    if (!inspectorOriginalValue.current || inspectorOriginalValue.current.el !== el || inspectorOriginalValue.current.property !== cssProp) {
      if (inspectorOriginalValue.current) {
        revertPreview();
      }
      inspectorOriginalValue.current = {
        el,
        property: cssProp,
        value: (el.style as any)[cssProp] || ''
      };
    }
    (el.style as any)[cssProp] = variable ? variable : '';
  };

  const revertPreview = () => {
    if (inspectorOriginalValue.current) {
      const { el, property, value } = inspectorOriginalValue.current;
      if (el && property) {
        (el.style as any)[property] = value;
      }
    }
    inspectorOriginalValue.current = null;
  };

  const getFontVariable = (key: string) => {
    const map: Record<string, string> = {
      fontSize: '--font-size',
      fontSizeTitle: '--font-size-title',
      fontSizeSubtitle: '--font-size-subtitle',
      fontSizeSubtitleSmall: '--font-size-subtitle-small',
      fontSizeBody: '--font-size-body',
      fontSizeBodySmall: '--font-size-body-small',
      fontSizeKeyMetric: '--font-size-key-metric',
      fontSizeXS: '--font-size-xs'
    };
    return map[key] || `--font-size-${key.toLowerCase()}`;
  };

  return {
    showThemeScreen,
    setShowThemeScreen,
    themePreviewMode,
    setThemePreviewMode,
    themeCompactMode,
    setThemeCompactMode,
    themeActiveSection,
    setThemeActiveSection,
    expandedColorKey,
    setExpandedColorKey,
    colorDraft,
    setColorDraft,
    textPreviewOverride,
    setTextPreviewOverride,
    justSavedKey,
    setJustSavedKey,
    newPresetName,
    setNewPresetName,
    inspectedElement,
    setInspectedElement,
    inspectorPaused,
    setInspectorPaused,
    inspectorProperty,
    setInspectorProperty,
    inspectorVariable,
    setInspectorVariable,
    initialThemeSnapshot,
    colorOriginalVal,
    saveOverride,
    handleRenameColor,
    handleDeleteColor,
    handleAddColor,
    handleRenameFont,
    THEME_CATEGORY_SECTION_LABELS,
    buildExportPayload,
    normalizeImportedPreset,
    PRESET_COMPARE_KEYS,
    normalizePresetValue,
    deepEqual,
    isPresetActive,
    applyPresetConfig,
    getThemeVariableChangesCount,
    colorsList,
    fontsList,
    getColorVariable,
    detectCurrentVariable,
    inspectorOriginalValue,
    applyPreview,
    revertPreview,
    getFontVariable,
    profile,
    setProfile,
    onSaveProfile,
    t,
  };
}

export type ThemeCustomizerApi = ReturnType<typeof useThemeCustomizer>;
