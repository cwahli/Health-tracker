export const getDynamicStyles = (profile: any) => {
  if (!profile) return '';
  const p = profile.themePalette || {};
  const fontSize = profile.fontSize || 'normal';
  const fontFamily = profile.fontFamily || 'Inter';
  const fontMono = profile.fontMono || 'JetBrains Mono';
  
  let fontSizeCss = '';
  if (fontSize === 'tiny') {
    fontSizeCss = `
      :root, html { font-size: 12px !important; }
    `;
  } else if (fontSize === 'small') {
    fontSizeCss = `
      :root, html { font-size: 14px !important; }
    `;
  } else if (fontSize === 'normal') {
    fontSizeCss = `
      :root, html { font-size: 16px !important; }
    `;
  } else if (fontSize === 'large') {
    fontSizeCss = `
      :root, html { font-size: 18px !important; }
    `;
  } else if (fontSize === 'xl') {
    fontSizeCss = `
      :root, html { font-size: 20px !important; }
    `;
  } else if (fontSize === 'xxl') {
    fontSizeCss = `
      :root, html { font-size: 24px !important; }
    `;
  }
  const sizeMap = {
    tiny: '12px',
    small: '14px',
    normal: '16px',
    large: '18px',
    xl: '20px',
    xxl: '24px',
    '3xl': '30px',
    '4xl': '36px',
    '5xl': '48px',
    '6xl': '60px'
  };
  const titleSize = profile.fontSizeTitle ? sizeMap[profile.fontSizeTitle as keyof typeof sizeMap] : '';
  const subtitleSize = profile.fontSizeSubtitle ? sizeMap[profile.fontSizeSubtitle as keyof typeof sizeMap] : '';
  const descSize = profile.fontSizeDescription ? sizeMap[profile.fontSizeDescription as keyof typeof sizeMap] : '';
  const smallSize = profile.fontSizeBodySmall ? sizeMap[profile.fontSizeBodySmall as keyof typeof sizeMap] : '';
  const subtitleSmallSize = profile.fontSizeSubtitleSmall ? sizeMap[profile.fontSizeSubtitleSmall as keyof typeof sizeMap] : '14px';
  const keyMetricSize = profile.fontSizeKeyMetric ? sizeMap[profile.fontSizeKeyMetric as keyof typeof sizeMap] : '36px';
  const xsSize = profile.fontSizeXS ? sizeMap[profile.fontSizeXS as keyof typeof sizeMap] : '10px';
  const bodySize = profile.fontSizeBody ? sizeMap[profile.fontSizeBody as keyof typeof sizeMap] : '16px';
  fontSizeCss += `
    :root {
      --font-size-title: ${titleSize || '24px'} !important;
      --font-size-subtitle: ${subtitleSize || '18px'} !important;
      --font-size-subtitle-small: ${subtitleSmallSize} !important;
      --font-size-body: ${bodySize} !important;
      --font-size-body-small: ${smallSize || '12px'} !important;
      --font-size-key-metric: ${keyMetricSize} !important;
      --font-size-xs: ${xsSize} !important;
    }
    .font-size-title { font-size: ${titleSize || '24px'} !important; }
    .font-size-subtitle { font-size: ${subtitleSize || '18px'} !important; }
    .font-size-subtitle-small { font-size: ${subtitleSmallSize} !important; }
    .font-size-body { font-size: ${bodySize} !important; }
    .font-size-body-small { font-size: ${smallSize || '12px'} !important; }
    .font-size-key-metric { font-size: ${keyMetricSize} !important; }
    .font-size-xs { font-size: ${xsSize} !important; }
  `;
  if (titleSize || subtitleSize || descSize || smallSize) {
    fontSizeCss += `
      ${titleSize ? `h1, h2, h3, .font-display, .text-xl, .text-2xl, .text-3xl, .text-4xl, .text-5xl { font-size: ${titleSize} !important; line-height: 1.3 !important; }` : ''}
      ${subtitleSize ? `h4, h5, .subtitle-text, .text-lg { font-size: ${subtitleSize} !important; line-height: 1.4 !important; }` : ''}
      ${descSize ? `p, .desc-text, .text-base, .text-md { font-size: ${descSize} !important; line-height: 1.5 !important; }` : ''}
      ${smallSize ? `small, .text-sm, .text-xs, .text-[11px], .text-[10px], .text-[9px], .body-small { font-size: ${smallSize} !important; line-height: 1.5 !important; }` : ''}
    `;
  }
  let fontCss = `
    :root {
      --font-sans: "${fontFamily}", ui-sans-serif, system-ui, sans-serif !important;
      --font-display: "${fontFamily}", sans-serif !important;
      --font-mono: "${fontMono}", ui-monospace, monospace !important;
    }
    body {
      font-family: var(--font-sans) !important;
    }
  `;
  let colorCss = '';
  colorCss += `
    :root {
  `;
  if (p.button) {
    colorCss += `
      --color-indigo-500: ${p.button} !important;
      --color-indigo-600: ${p.button} !important;
      --color-indigo-700: ${p.button}dd !important;
      --color-indigo-50: ${p.button}12 !important;
      --color-indigo-950: ${p.button}25 !important;
    `;
  }
  if (p.background) {
    colorCss += `
      --app-bg: ${p.background} !important;
      --color-slate-50: ${p.background} !important;
    `;
  }
  if (p.bgCard) {
    colorCss += `--app-bg-card: ${p.bgCard} !important;`;
  }
  if (p.border) {
    colorCss += `
      --app-border: ${p.border} !important;
      --color-slate-200: ${p.border} !important;
    `;
  }
  if (p.warning) {
    colorCss += `
      --color-rose-500: ${p.warning} !important;
      --color-rose-600: ${p.warning} !important;
      --color-rose-800: ${p.warning} !important;
      --color-rose-50: ${p.warning}12 !important;
      --color-rose-100: ${p.warning}22 !important;
    `;
  }
  if (p.caution) {
    colorCss += `
      --color-amber-500: ${p.caution} !important;
      --color-amber-600: ${p.caution} !important;
      --color-amber-50: ${p.caution}12 !important;
    `;
  }
  if (p.success) {
    colorCss += `
      --color-emerald-500: ${p.success} !important;
      --color-emerald-600: ${p.success} !important;
      --color-emerald-50: ${p.success}12 !important;
    `;
  }
  if (p.text) {
    colorCss += `
      --app-text: ${p.text} !important;
      --color-slate-900: ${p.text} !important;
    `;
  }
  if (p.textSecondary) {
    colorCss += `
      --app-text-secondary: ${p.textSecondary} !important;
      --color-slate-500: ${p.textSecondary} !important;
    `;
  }
  if (p.textDarkPrimary) {
    colorCss += `--theme-text-dark-primary: ${p.textDarkPrimary} !important;`;
  }
  if (p.textDarkSecondary) {
    colorCss += `--theme-text-dark-secondary: ${p.textDarkSecondary} !important;`;
  }
  if (p.textAccent) {
    colorCss += `
      --color-text-accent: ${p.textAccent} !important;
      --color-indigo-400: ${p.textAccent} !important;
    `;
  }
  if (p.textMuted) {
    colorCss += `
      --color-text-muted: ${p.textMuted} !important;
      --color-slate-400: ${p.textMuted} !important;
    `;
  }
  if (p.textSuccess) {
    colorCss += `
      --color-text-success: ${p.textSuccess} !important;
      --color-green-400: ${p.textSuccess} !important;
    `;
  }
  if (p.textError) {
    colorCss += `
      --color-text-error: ${p.textError} !important;
      --color-red-400: ${p.textError} !important;
    `;
  }
  if (p.neutralSetting) {
    colorCss += `
      --app-neutral: ${p.neutralSetting} !important;
      --color-slate-700: ${p.neutralSetting} !important;
    `;
  }
  if (p.info) {
    colorCss += `
      --color-blue-500: ${p.info} !important;
    `;
  }
  if (p.nutrientCalories) {
    colorCss += `
      --color-nutrient-calories: ${p.nutrientCalories} !important;
    `;
  }
  if (p.nutrientProtein) {
    colorCss += `
      --color-nutrient-protein: ${p.nutrientProtein} !important;
    `;
  }
  if (p.nutrientCarbs) {
    colorCss += `
      --color-nutrient-carbohydrates: ${p.nutrientCarbs} !important;
    `;
  }
  if (p.nutrientFat) {
    colorCss += `
      --color-nutrient-totalFat: ${p.nutrientFat} !important;
    `;
  }
  if (p.nutrientSatFat) {
    colorCss += `
      --color-nutrient-saturatedFat: ${p.nutrientSatFat} !important;
    `;
  }
  if (p.nutrientSodium) {
    colorCss += `
      --color-nutrient-sodium: ${p.nutrientSodium} !important;
    `;
  }
  // Generic emitter for all keys in themePalette
  Object.entries(p).forEach(([key, val]) => {
    if (val && typeof val === 'string') {
      colorCss += `--color-${key}: ${val} !important;\n`;
    }
  });
  if (profile.customColors && Array.isArray(profile.customColors)) {
    profile.customColors.forEach((color: any) => {
      const activeVal = p[color.key] || color.defaultHex;
      if (activeVal) {
        colorCss += `      --color-${color.key}: ${activeVal} !important;\n`;
      }
    });
  }
  colorCss += `
    }
  `;
  if (profile.themeOverrides && Array.isArray(profile.themeOverrides)) {
    profile.themeOverrides.forEach(override => {
      colorCss += `
        ${override.selector} {
          ${override.property}: ${override.variable} !important;
        }
      `;
    });
  }
  // Spacing, Corner Radius, and Shadows Design Tokens
  const marginScale = profile?.marginScale || 'normal';
  const paddingScale = profile?.paddingScale || 'normal';
  const cornerRadius = profile?.cornerRadius || 'normal';
  const shadowScale = profile?.shadowScale || 'normal';
  const marginFactor = marginScale === 'compact' ? '0.75' : marginScale === 'relaxed' ? '1.25' : '1';
  const paddingFactor = paddingScale === 'compact' ? '0.75' : paddingScale === 'relaxed' ? '1.25' : '1';
  const radiusFactor = cornerRadius === 'none' ? '0' : cornerRadius === 'small' ? '0.5' : cornerRadius === 'large' ? '1.5' : cornerRadius === 'pill' ? '2.5' : '1';
  const shadowFactor = shadowScale === 'none' ? '0' : shadowScale === 'light' ? '0.5' : shadowScale === 'heavy' ? '1.75' : '1';
  let designTokensCss = `
    :root {
      --spacing-factor: ${paddingFactor} !important;
      --margin-factor: ${marginFactor} !important;
      --radius-factor: ${radiusFactor} !important;
      --shadow-factor: ${shadowFactor} !important;
    }
    
    /* Global Card & Button Roundness Overrides */
    .rounded-sm { border-radius: calc(0.125rem * var(--radius-factor)) !important; }
    .rounded, .rounded-md { border-radius: calc(0.375rem * var(--radius-factor)) !important; }
    .rounded-lg { border-radius: calc(0.5rem * var(--radius-factor)) !important; }
    .rounded-xl { border-radius: calc(0.75rem * var(--radius-factor)) !important; }
    .rounded-2xl { border-radius: calc(1rem * var(--radius-factor)) !important; }
    .rounded-3xl { border-radius: calc(1.5rem * var(--radius-factor)) !important; }
    .rounded-full { border-radius: ${cornerRadius === 'none' ? '0 !important' : '9999px !important'}; }
    /* Shadow scale overrides */
    .shadow-sm { box-shadow: 0 1px 2px 0 rgba(0,0,0,calc(0.05 * var(--shadow-factor))) !important; }
    .shadow, .shadow-md { box-shadow: 0 4px 6px -1px rgba(0,0,0,calc(0.08 * var(--shadow-factor))), 0 2px 4px -1px rgba(0,0,0,calc(0.04 * var(--shadow-factor))) !important; }
    .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,calc(0.1 * var(--shadow-factor))), 0 4px 6px -2px rgba(0,0,0,calc(0.05 * var(--shadow-factor))) !important; }
    .shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,calc(0.1 * var(--shadow-factor))), 0 10px 10px -5px rgba(0,0,0,calc(0.04 * var(--shadow-factor))) !important; }
    .shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0,0,0,calc(0.25 * var(--shadow-factor))) !important; }
    /* Dynamic Spacing scale classes */
    .p-1 { padding: calc(0.25rem * var(--spacing-factor)) !important; }
    .p-1.5 { padding: calc(0.375rem * var(--spacing-factor)) !important; }
    .p-2 { padding: calc(0.5rem * var(--spacing-factor)) !important; }
    .p-3 { padding: calc(0.75rem * var(--spacing-factor)) !important; }
    .p-4 { padding: calc(1rem * var(--spacing-factor)) !important; }
    .p-5 { padding: calc(1.25rem * var(--spacing-factor)) !important; }
    .p-6 { padding: calc(1.5rem * var(--spacing-factor)) !important; }
    .p-8 { padding: calc(2rem * var(--spacing-factor)) !important; }
    .px-1 { padding-left: calc(0.25rem * var(--spacing-factor)) !important; padding-right: calc(0.25rem * var(--spacing-factor)) !important; }
    .px-2 { padding-left: calc(0.5rem * var(--spacing-factor)) !important; padding-right: calc(0.5rem * var(--spacing-factor)) !important; }
    .px-3 { padding-left: calc(0.75rem * var(--spacing-factor)) !important; padding-right: calc(0.75rem * var(--spacing-factor)) !important; }
    .px-4 { padding-left: calc(1rem * var(--spacing-factor)) !important; padding-right: calc(1rem * var(--spacing-factor)) !important; }
    .px-6 { padding-left: calc(1.5rem * var(--spacing-factor)) !important; padding-right: calc(1.5rem * var(--spacing-factor)) !important; }
    
    .py-1 { padding-top: calc(0.25rem * var(--spacing-factor)) !important; padding-bottom: calc(0.25rem * var(--spacing-factor)) !important; }
    .py-2 { padding-top: calc(0.5rem * var(--spacing-factor)) !important; padding-bottom: calc(0.5rem * var(--spacing-factor)) !important; }
    .py-3 { padding-top: calc(0.75rem * var(--spacing-factor)) !important; padding-bottom: calc(0.75rem * var(--spacing-factor)) !important; }
    .py-4 { padding-top: calc(1rem * var(--spacing-factor)) !important; padding-bottom: calc(1rem * var(--spacing-factor)) !important; }
    .py-6 { padding-top: calc(1.5rem * var(--spacing-factor)) !important; padding-bottom: calc(1.5rem * var(--spacing-factor)) !important; }
    .m-1 { margin: calc(0.25rem * var(--margin-factor)) !important; }
    .m-2 { margin: calc(0.5rem * var(--margin-factor)) !important; }
    .m-3 { margin: calc(0.75rem * var(--margin-factor)) !important; }
    .m-4 { margin: calc(1rem * var(--margin-factor)) !important; }
    
    .mt-1 { margin-top: calc(0.25rem * var(--margin-factor)) !important; }
    .mt-2 { margin-top: calc(0.5rem * var(--margin-factor)) !important; }
    .mt-3 { margin-top: calc(0.75rem * var(--margin-factor)) !important; }
    .mt-4 { margin-top: calc(1rem * var(--margin-factor)) !important; }
    .mt-6 { margin-top: calc(1.5rem * var(--margin-factor)) !important; }
    .mt-8 { margin-top: calc(2rem * var(--margin-factor)) !important; }
    .mb-1 { margin-bottom: calc(0.25rem * var(--margin-factor)) !important; }
    .mb-2 { margin-bottom: calc(0.5rem * var(--margin-factor)) !important; }
    .mb-3 { margin-bottom: calc(0.75rem * var(--margin-factor)) !important; }
    .mb-4 { margin-bottom: calc(1rem * var(--margin-factor)) !important; }
    .mb-6 { margin-bottom: calc(1.5rem * var(--margin-factor)) !important; }
    .mb-8 { margin-bottom: calc(2rem * var(--margin-factor)) !important; }
  `;
  return `
    ${fontSizeCss}
    ${fontCss}
    ${colorCss}
    ${designTokensCss}
  `;
};
