export interface ThemeColorItem {
  key: string;
  label: string;
  defaultValue: string;
  category?: string;
  description?: string;
}

export interface ThemeFontItem {
  key: string;
  label: string;
  fontSizeKey: string;
  defaultValue: string;
  options: { label: string; value: string }[];
}

export interface ThemeTokenItem {
  key: string;
  label: string;
  tokenKey: string;
  defaultValue: string;
  options: { label: string; value: string }[];
}

export const auditColors: ThemeColorItem[] = [
  { key: 'background', label: 'App Background', defaultValue: '#0a1118', category: 'Base' },
  { key: 'bgCard', label: 'Card Background', defaultValue: '#111c26', category: 'Base' },
  { key: 'border', label: 'Border / Divider', defaultValue: '#54687c', category: 'Base' },
  { key: 'text', label: 'Primary Text (Light)', defaultValue: '#eaf2f8', category: 'Typography' },
  { key: 'textSecondary', label: 'Secondary Text (Light)', defaultValue: '#b9c9d6', category: 'Typography' },
  { key: 'textDarkPrimary', label: 'Primary Text (Dark)', defaultValue: '#eaf2f8', category: 'Typography' },
  { key: 'textDarkSecondary', label: 'Secondary Text (Dark)', defaultValue: '#b9c9d6', category: 'Typography' },
  { key: 'textAccent', label: 'Accent Highlight', defaultValue: '#6fc3ff', category: 'Typography' },
  { key: 'textMuted', label: 'Muted Hint', defaultValue: '#b9c9d6', category: 'Typography' },
  { key: 'button', label: 'Button Accent', defaultValue: '#0d4f96', category: 'Interactive' },
  { key: 'neutralSetting', label: 'Neutral Element', defaultValue: '#a3b6c9', category: 'Base' },
  { key: 'success', label: 'Success Highlight', defaultValue: '#34d399', category: 'Feedback' },
  { key: 'textSuccess', label: 'Success Text', defaultValue: '#5eeab8', category: 'Feedback' },
  { key: 'warning', label: 'Severe Warning', defaultValue: '#ffa3a3', category: 'Feedback' },
  { key: 'textError', label: 'Error Text', defaultValue: '#ffa3a3', category: 'Feedback' },
  { key: 'caution', label: 'Caution Alert', defaultValue: '#fcd34d', category: 'Feedback' },
  { key: 'info', label: 'Information Blue', defaultValue: '#6fc3ff', category: 'Feedback' },
  { key: 'nutrientCalories', label: 'Calories Bar', defaultValue: '#6366f1', category: 'Nutrients' },
  { key: 'nutrientProtein', label: 'Protein Bar', defaultValue: '#10b981', category: 'Nutrients' },
  { key: 'nutrientCarbs', label: 'Carbs Bar', defaultValue: '#0ea5e9', category: 'Nutrients' },
  { key: 'nutrientFat', label: 'Total Fat Bar', defaultValue: '#f59e0b', category: 'Nutrients' },
  { key: 'nutrientSatFat', label: 'Sat Fat Bar', defaultValue: '#f43f5e', category: 'Nutrients' },
  { key: 'nutrientSodium', label: 'Sodium Bar', defaultValue: '#eab308', category: 'Nutrients' },
];

export const auditFonts: ThemeFontItem[] = [
  {
    key: 'fontSize',
    label: 'Root Base Size',
    fontSizeKey: 'fontSize',
    defaultValue: '16px',
    options: [
      { label: 'Compact (14px)', value: '14px' },
      { label: 'Standard (16px)', value: '16px' },
      { label: 'Comfortable (18px)', value: '18px' },
    ]
  },
  {
    key: 'fontSizeTitle',
    label: 'Heading / Title',
    fontSizeKey: 'fontSizeTitle',
    defaultValue: '24px',
    options: [
      { label: 'Medium (20px)', value: '20px' },
      { label: 'Large (24px)', value: '24px' },
      { label: 'Display (28px)', value: '28px' },
    ]
  },
  {
    key: 'fontSizeSubtitle',
    label: 'Subtitle / Section Header',
    fontSizeKey: 'fontSizeSubtitle',
    defaultValue: '18px',
    options: [
      { label: 'Small (16px)', value: '16px' },
      { label: 'Standard (18px)', value: '18px' },
      { label: 'Prominent (20px)', value: '20px' },
    ]
  },
  {
    key: 'fontSizeBody',
    label: 'Body Text',
    fontSizeKey: 'fontSizeBody',
    defaultValue: '14px',
    options: [
      { label: 'Small (13px)', value: '13px' },
      { label: 'Standard (14px)', value: '14px' },
      { label: 'Large (15px)', value: '15px' },
    ]
  },
  {
    key: 'fontSizeBodySmall',
    label: 'Supporting / Caption',
    fontSizeKey: 'fontSizeBodySmall',
    defaultValue: '12px',
    options: [
      { label: 'Tiny (11px)', value: '11px' },
      { label: 'Standard (12px)', value: '12px' },
      { label: 'Normal (13px)', value: '13px' },
    ]
  },
  {
    key: 'fontSizeSubtitleSmall',
    label: 'Small Section / Tag',
    fontSizeKey: 'fontSizeSubtitleSmall',
    defaultValue: '13px',
    options: [
      { label: 'Compact (12px)', value: '12px' },
      { label: 'Standard (13px)', value: '13px' },
    ]
  },
  {
    key: 'fontSizeKeyMetric',
    label: 'Key Metric Display',
    fontSizeKey: 'fontSizeKeyMetric',
    defaultValue: '28px',
    options: [
      { label: 'Standard (24px)', value: '24px' },
      { label: 'Large (28px)', value: '28px' },
      { label: 'Hero (32px)', value: '32px' },
    ]
  },
  {
    key: 'fontSizeXS',
    label: 'Micro / Label',
    fontSizeKey: 'fontSizeXS',
    defaultValue: '11px',
    options: [
      { label: 'Micro (10px)', value: '10px' },
      { label: 'Standard (11px)', value: '11px' },
    ]
  },
];

export const auditDesignTokens: ThemeTokenItem[] = [
  {
    key: 'cornerRadius',
    label: 'Corner Rounding',
    tokenKey: 'cornerRadius',
    defaultValue: 'rounded-2xl',
    options: [
      { label: 'Sharp (rounded-none)', value: 'rounded-none' },
      { label: 'Soft (rounded-lg)', value: 'rounded-lg' },
      { label: 'Modern (rounded-2xl)', value: 'rounded-2xl' },
      { label: 'Pill (rounded-3xl)', value: 'rounded-3xl' },
    ]
  },
  {
    key: 'paddingScale',
    label: 'Padding Scale',
    tokenKey: 'paddingScale',
    defaultValue: 'p-4',
    options: [
      { label: 'Compact (p-2)', value: 'p-2' },
      { label: 'Standard (p-4)', value: 'p-4' },
      { label: 'Spacious (p-6)', value: 'p-6' },
    ]
  },
  {
    key: 'marginScale',
    label: 'Margin Scale',
    tokenKey: 'marginScale',
    defaultValue: 'gap-3',
    options: [
      { label: 'Tight (gap-2)', value: 'gap-2' },
      { label: 'Standard (gap-3)', value: 'gap-3' },
      { label: 'Spacious (gap-5)', value: 'gap-5' },
    ]
  },
  {
    key: 'shadowScale',
    label: 'Shadow Scale',
    tokenKey: 'shadowScale',
    defaultValue: 'shadow-sm',
    options: [
      { label: 'Flat (shadow-none)', value: 'shadow-none' },
      { label: 'Subtle (shadow-xs)', value: 'shadow-xs' },
      { label: 'Elevated (shadow-md)', value: 'shadow-md' },
    ]
  },
];

export const auditComponents: any[] = [];
export const auditElements: any[] = [];

/**
 * Deep Sea (Accessible) — WCAG AAA dark theme (all text pairs >= 7:1).
 * This is the default theme: the auditColors defaults above match it, so any
 * profile without an explicit palette renders Deep Sea. Pair with the AAA
 * type scale (root 'large' = 18px, titles 24-26px bold, body 18px, min 16px).
 */
export const deepSeaThemePalette: Record<string, string> = {
  background: '#0a1118',
  bgCard: '#111c26',
  border: '#54687c',
  text: '#eaf2f8',
  textSecondary: '#b9c9d6',
  textDarkPrimary: '#eaf2f8',
  textDarkSecondary: '#b9c9d6',
  textAccent: '#6fc3ff',
  textMuted: '#b9c9d6',
  button: '#0d4f96',
  neutralSetting: '#a3b6c9',
  success: '#34d399',
  textSuccess: '#5eeab8',
  warning: '#ffa3a3',
  textError: '#ffa3a3',
  caution: '#fcd34d',
  info: '#6fc3ff',
};

export const deepSeaFontSettings: Record<string, string> = {
  fontSize: 'large',
  fontSizeTitle: 'xxl',
  fontSizeSubtitle: 'xl',
  fontSizeDescription: 'large',
  fontSizeBody: 'large',
  fontSizeBodySmall: 'normal',
  fontSizeSubtitleSmall: 'normal',
  fontSizeKeyMetric: '4xl',
  fontSizeXS: 'small',
};

export const deepSeaSystemPreset = {
  name: 'Deep Sea (Accessible)',
  isSystem: true,
  profileUpdate: {
    fontFamily: 'Inter',
    ...deepSeaFontSettings,
    themePalette: { ...deepSeaThemePalette },
    themeOverrides: [],
  },
};

/**
 * Classic (Current) — the pre-Deep-Sea default look. Selecting it restores
 * the previous palette and type scale exactly, for users who prefer it.
 */
export const classicSystemPreset = {
  name: 'Classic (Current)',
  isSystem: true,
  profileUpdate: {
    fontFamily: 'Inter',
    fontSize: 'normal',
    fontSizeTitle: 'xxl',
    fontSizeSubtitle: 'large',
    fontSizeBody: 'normal',
    fontSizeBodySmall: 'tiny',
    fontSizeSubtitleSmall: 'small',
    fontSizeKeyMetric: '4xl',
    fontSizeXS: 'tiny',
    themePalette: {
      background: '#0f172a',
      bgCard: '#1e293b',
      border: '#334155',
      text: '#f8fafc',
      textSecondary: '#94a3b8',
      textDarkPrimary: '#f8fafc',
      textDarkSecondary: '#94a3b8',
      textAccent: '#6366f1',
      textMuted: '#64748b',
      button: '#4f46e5',
      neutralSetting: '#64748b',
      success: '#10b981',
      textSuccess: '#059669',
      warning: '#f43f5e',
      textError: '#e11d48',
      caution: '#f59e0b',
      info: '#3b82f6',
      nutrientCalories: '#6366f1',
      nutrientProtein: '#10b981',
      nutrientCarbs: '#0ea5e9',
      nutrientFat: '#f59e0b',
      nutrientSatFat: '#f43f5e',
      nutrientSodium: '#eab308',
    },
    themeOverrides: [],
  },
};
