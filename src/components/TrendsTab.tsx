import React, { useState } from 'react';
import { UserProfile, FoodLog, BiomarkerLog, RecommendationReport } from '../types';
import { translations } from '../utils/translations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, BarChart2, Calendar, EyeOff } from 'lucide-react';

interface TrendsTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkerHistory: BiomarkerLog[];
  hideSensitive: boolean;
  report: RecommendationReport | null;
}

export default function TrendsTab({
  profile,
  foodLogs,
  biomarkerHistory,
  hideSensitive,
  report
}: TrendsTabProps) {
  const t = translations[profile.language] || translations.en;
  const [selectedMetric, setSelectedMetric] = useState<'calories' | 'saturatedFat' | 'protein' | 'ldl' | 'hba1c' | 'egfr' | 'steps'>('calories');
  const [rollingPeriod, setRollingPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const parseTarget = (val: any, fallback: number) => {
    if (val === null || val === undefined) return fallback;
    const clean = String(val).replace(/,/g, '').replace(/[^\d]/g, '');
    const parsed = parseInt(clean, 10);
    return isNaN(parsed) ? fallback : parsed;
  };

  // Generate continuous or logged timeline data for the chart
  const getChartData = () => {
    // Collect all unique dates from both logs
    const datesSet = new Set<string>();
    foodLogs.forEach(f => datesSet.add(f.date));
    biomarkerHistory.forEach(b => datesSet.add(b.date));
    
    let stepsHistory: { date: string, value: number }[] = [];
    if (selectedMetric === 'steps') {
      const historyStr = localStorage.getItem('googleStepsHistory');
      if (historyStr) {
        try {
          stepsHistory = JSON.parse(historyStr);
          stepsHistory.forEach(h => datesSet.add(h.date));
        } catch (e) {}
      }
      const today = new Date().toISOString().split('T')[0];
      datesSet.add(today);
    }

    // Sort dates chronologically
    const sortedDates = Array.from(datesSet).sort();

    // If there is zero data, pre-populate dummy points to allow beautiful visual rendering
    if (sortedDates.length === 0) {
      return [
        { date: '2026-06-20', value: 0 },
        { date: '2026-06-21', value: 0 },
        { date: '2026-06-22', value: 0 },
      ];
    }

    const compiled = sortedDates.map(dateStr => {
      // Aggregate foods for this day
      const daysFoods = foodLogs.filter(f => f.date === dateStr);
      const totalCalories = daysFoods.reduce((acc, f) => acc + ((f.nutrients && f.nutrients.calories) || 0), 0);
      const totalSatFat = daysFoods.reduce((acc, f) => acc + ((f.nutrients && f.nutrients.saturatedFat) || 0), 0);
      const totalProtein = daysFoods.reduce((acc, f) => acc + ((f.nutrients && f.nutrients.protein) || 0), 0);

      // Extract biomarker if logged on this day
      const dayBio = biomarkerHistory.find(b => b.date === dateStr);
      const ldlVal = dayBio?.biomarkers.ldl;
      const hba1cVal = dayBio?.biomarkers.hba1c;
      const egfrVal = dayBio?.biomarkers.egfr;

      let value = 0;
      if (selectedMetric === 'calories') value = totalCalories;
      if (selectedMetric === 'saturatedFat') value = totalSatFat;
      if (selectedMetric === 'protein') value = totalProtein;
      if (selectedMetric === 'ldl') value = Number(ldlVal || 0);
      if (selectedMetric === 'hba1c') value = Number(hba1cVal || 0);
      if (selectedMetric === 'egfr') value = Number(egfrVal || 0);
      if (selectedMetric === 'steps') {
        const today = new Date().toISOString().split('T')[0];
        if (dateStr === today) {
          const todaySteps = localStorage.getItem('googleSteps');
          value = todaySteps ? parseInt(todaySteps, 10) : (stepsHistory.find(h => h.date === dateStr)?.value || 0);
        } else {
          value = stepsHistory.find(h => h.date === dateStr)?.value || 0;
        }
      }

      return {
        date: dateStr,
        value: Number(value.toFixed(1))
      };
    });

    // Handle rolling aggregate depending on selection
    if (rollingPeriod === 'weekly') {
      // Group by weeks
      const grouped: { [key: string]: number[] } = {};
      compiled.forEach(item => {
        // Simple approximate week identifier (first 8 chars or custom week bracket)
        const weekKey = item.date.substring(0, 7) + "-W";
        if (!grouped[weekKey]) grouped[weekKey] = [];
        grouped[weekKey].push(item.value);
      });
      return Object.entries(grouped).map(([week, vals]) => ({
        date: week,
        value: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
      }));
    } else if (rollingPeriod === 'monthly') {
      const grouped: { [key: string]: number[] } = {};
      compiled.forEach(item => {
        const monthKey = item.date.substring(0, 7);
        if (!grouped[monthKey]) grouped[monthKey] = [];
        grouped[monthKey].push(item.value);
      });
      return Object.entries(grouped).map(([month, vals]) => ({
        date: month,
        value: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
      }));
    }

    return compiled;
  };

  const chartData = getChartData();

  const metricMeta = {
    calories: { label: 'Calories Consumed', unit: 'kcal', color: '#6366f1', target: report?.dailyNutrientTargets?.calories ? parseTarget(report.dailyNutrientTargets.calories, 1800) : 1800 },
    saturatedFat: { label: 'Saturated Fat', unit: 'g', color: '#ef4444', target: report?.dailyNutrientTargets?.saturatedFat ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15 },
    protein: { label: 'Protein Consumed', unit: 'g', color: '#3b82f6', target: report?.dailyNutrientTargets?.protein ? parseTarget(report.dailyNutrientTargets.protein, 95) : 95 },
    ldl: { label: 'LDL Cholesterol', unit: 'mg/dL', color: '#f59e0b', target: 100 },
    hba1c: { label: 'HbA1c Blood Glucose', unit: '%', color: '#8b5cf6', target: 5.7 },
    egfr: { label: 'eGFR Kidney Filtration', unit: 'mL/min', color: '#ec4899', target: 90 },
    steps: { label: 'Daily Steps', unit: 'steps', color: '#10b981', target: report?.dailyNutrientTargets?.steps ? parseTarget(report.dailyNutrientTargets.steps, 3000) : 3000 },
  }[selectedMetric];

  return (
    <div className="space-y-5 pb-24 animation-fade-in max-w-md mx-auto px-4 mt-4 font-sans text-slate-900">
      
      {/* Title */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          <h2 className="font-bold text-slate-950 dark:text-slate-100 text-sm font-display">Target Metric Trends</h2>
        </div>
        <span className="text-[10px] font-mono bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-full text-slate-400 font-bold uppercase tracking-wider">Recharts Activated</span>
      </div>

      {/* Select Controls Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 font-mono">Select Metric</label>
          <select
            id="trend-metric-selector"
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value as any)}
            className="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl px-2.5 py-2.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="calories">Calories (kcal)</option>
            <option value="steps">Daily Steps</option>
            <option value="saturatedFat">Saturated Fat (g)</option>
            <option value="protein">Protein (g)</option>
            <option value="ldl">LDL Cholesterol (mg/dL)</option>
            <option value="hba1c">HbA1c (%)</option>
            <option value="egfr">eGFR Kidney Filtration</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 font-mono">Time Roll</label>
          <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-1 rounded-xl">
            {(['daily', 'weekly', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setRollingPeriod(p)}
                className={`py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${
                  rollingPeriod === p
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Responsive Recharts Viewport */}
      <div id="trends-chart-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm relative">
        {hideSensitive && ['ldl', 'hba1c', 'egfr'].includes(selectedMetric) ? (
          /* Masked view to respect privacy toggles in trends as well */
          <div className="h-60 flex flex-col items-center justify-center text-center text-slate-400">
            <EyeOff className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs font-semibold">Sensitive biometric trends are currently hidden.</p>
            <p className="text-[10px] mt-1">Disable privacy shield in profile header to display charts.</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide font-mono block">
                  {metricMeta.label}
                </span>
                <span className="text-base font-bold text-slate-950 dark:text-slate-200 font-display">
                  Timeline ({metricMeta.unit})
                </span>
              </div>
              <div className="text-right text-[10px] font-mono text-slate-400 font-bold">
                Target: {metricMeta.target} {metricMeta.unit}
              </div>
            </div>

            <div className="h-60 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8" 
                    fontSize={9}
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, (dataMax: number) => Math.max(dataMax, metricMeta.target * 1.2)]}
                  />
                  <Tooltip 
                    contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }}
                    labelStyle={{ fontWeight: 'bold' }}
                  />
                  {/* Target reference boundary guideline line */}
                  <ReferenceLine 
                    y={metricMeta.target} 
                    stroke="#6366f1" 
                    strokeDasharray="4 4" 
                    label={{ value: 'Target', fill: '#6366f1', fontSize: 9, position: 'top' }} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke={metricMeta.color} 
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 1 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* Static Info Explainer */}
      <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-[24px] border border-slate-200 dark:border-slate-800/20 text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex gap-2 font-medium">
        <BarChart2 className="w-5 h-5 text-indigo-600 flex-shrink-0" />
        <p>
          This trend diagram combines nutrition intake logs and blood lab values over dated periods. Consistency is measured in accordance with modern cardiology guidelines.
        </p>
      </div>

    </div>
  );
}
