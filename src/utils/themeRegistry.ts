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
  { key: 'background', label: 'App Background', defaultValue: '#0f172a', category: 'Base' },
  { key: 'bgCard', label: 'Card Background', defaultValue: '#1e293b', category: 'Base' },
  { key: 'border', label: 'Border / Divider', defaultValue: '#334155', category: 'Base' },
  { key: 'text', label: 'Primary Text (Light)', defaultValue: '#f8fafc', category: 'Typography' },
  { key: 'textSecondary', label: 'Secondary Text (Light)', defaultValue: '#94a3b8', category: 'Typography' },
  { key: 'textDarkPrimary', label: 'Primary Text (Dark)', defaultValue: '#f8fafc', category: 'Typography' },
  { key: 'textDarkSecondary', label: 'Secondary Text (Dark)', defaultValue: '#94a3b8', category: 'Typography' },
  { key: 'textAccent', label: 'Accent Highlight', defaultValue: '#6366f1', category: 'Typography' },
  { key: 'textMuted', label: 'Muted Hint', defaultValue: '#64748b', category: 'Typography' },
  { key: 'button', label: 'Button Accent', defaultValue: '#4f46e5', category: 'Interactive' },
  { key: 'neutralSetting', label: 'Neutral Element', defaultValue: '#64748b', category: 'Base' },
  { key: 'success', label: 'Success Highlight', defaultValue: '#10b981', category: 'Feedback' },
  { key: 'textSuccess', label: 'Success Text', defaultValue: '#059669', category: 'Feedback' },
  { key: 'warning', label: 'Severe Warning', defaultValue: '#f43f5e', category: 'Feedback' },
  { key: 'textError', label: 'Error Text', defaultValue: '#e11d48', category: 'Feedback' },
  { key: 'caution', label: 'Caution Alert', defaultValue: '#f59e0b', category: 'Feedback' },
  { key: 'info', label: 'Information Blue', defaultValue: '#3b82f6', category: 'Feedback' },
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
