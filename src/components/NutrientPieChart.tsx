import React from 'react';
import { getNutrientColor } from '../utils/nutrition';
import { isLimitNutrient } from '../utils/nutrients';

interface NutrientPieChartProps {
  allowance: number;       // Daily allowance (e.g. 1500)
  alreadyConsumed: number; // Amount consumed BEFORE this meal/log (e.g. 750)
  mealValue: number;       // Amount in this meal/log (e.g. 500)
  nutrientKey: 'calories' | 'saturatedFat' | 'sodium' | string;
  size?: 'sm' | 'md' | 'lg';
}

export const NutrientPieChart: React.FC<NutrientPieChartProps> = ({
  allowance,
  alreadyConsumed,
  mealValue,
  nutrientKey,
  size = 'md'
}) => {
  // Safe bounds
  const A = Math.max(1, allowance);
  const C = Math.max(0, alreadyConsumed);
  const M = Math.max(0, mealValue);

  // Map nutrient keys to colors using master getNutrientColor
  const highlightColor = getNutrientColor(nutrientKey || '');
  const consumedColor = typeof highlightColor === 'string' && highlightColor.startsWith('rgb(') && highlightColor.endsWith(')')
    ? highlightColor.replace('rgb(', 'rgba(').replace(')', ', 0.2)')
    : highlightColor;

  const pctC = (C / A) * 100;
  const pctM = (M / A) * 100;
  const pctTotal = pctC + pctM;
  const wrapColor = isLimitNutrient(nutrientKey) ? 'var(--color-rose-500)' : 'var(--color-emerald-500)';

  let pieGradient = '';

  if (pctTotal <= 100) {
    // Under/equal to allowance
    // segment 1: 0% to pctC -> consumedColor (20% opacity of bright color)
    // segment 2: pctC to pctTotal -> highlightColor (full bright color)
    // segment 3: pctTotal to 100% -> Transparent
    pieGradient = `conic-gradient(
      ${consumedColor} 0% ${pctC}%, 
      ${highlightColor} ${pctC}% ${pctTotal}%, 
      transparent ${pctTotal}% 100%
    )`;
  } else {
    // Over allowance — rose wrap for ceiling nutrients, green wrap for goals
    if (C < A) {
      // Consumption exceeded target, but alreadyConsumed was under.
      const pctExcess = Math.min(pctTotal - 100, 100);
      pieGradient = `conic-gradient(
        ${wrapColor} 0% ${pctExcess}%,
        ${consumedColor} ${pctExcess}% ${pctC}%,
        ${highlightColor} ${pctC}% 100%
      )`;
    } else {
      // alreadyConsumed was already over or equal to target.
      const pctExcess = Math.min(pctM, 100);
      pieGradient = `conic-gradient(
        ${wrapColor} 0% ${pctExcess}%,
        ${consumedColor} ${pctExcess}% 100%
      )`;
    }
  }

  // Determine size classes
  const sizeClasses = {
    sm: 'w-4.5 h-4.5',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  };

  const tooltipText = `Allowance: ${A.toFixed(0)}, Already Consumed: ${C.toFixed(0)}, This Meal: ${M.toFixed(0)}`;

  return (
    <div 
      className={`${sizeClasses[size]} rounded-full bg-transparent overflow-hidden flex-shrink-0 relative border`}
      style={{ borderColor: consumedColor }}
      title={tooltipText}
    >
      <div 
        className="absolute inset-0 transition-all duration-500" 
        style={{ background: pieGradient }} 
      />
    </div>
  );
};
