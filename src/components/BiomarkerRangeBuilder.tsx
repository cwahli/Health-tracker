import React, { useState } from 'react';
import { RangeConfig, CustomRangeDef, SimpleRange, BracketRange, Severity, CustomRangeFilter } from '../types';
import { Plus, Trash2, ChevronDown, Check } from 'lucide-react';

interface BiomarkerRangeBuilderProps {
  rangeConfig?: RangeConfig;
  customRanges?: CustomRangeDef[];
  normalRangeStr?: string;
  onChange: (rangeConfig?: RangeConfig, customRanges?: CustomRangeDef[]) => void;
}

const SEVERITY_OPTIONS: Severity[] = ['Normal', 'Borderline at risk', 'At risk'];

const defaultSimpleRange: SimpleRange = {
  type: 'simple',
  conditions: [
    { operator: '>=', value: 0, alias: 'Elevated', severity: 'At risk' },
    { operator: '<', value: 0, alias: 'Healthy', severity: 'Normal' }
  ]
};



const defaultBracketRange: BracketRange = {
  type: 'bracket',
  brackets: [
    { min: null, max: 0, alias: 'Normal', severity: 'Normal' },
    { min: 0, max: null, alias: 'High', severity: 'At risk' }
  ]
};



export const parseNormalRangeStr = (val: string | undefined, type: 'simple' | 'bracket'): RangeConfig => {
    if (!val) return type === 'simple' ? defaultSimpleRange : defaultBracketRange;
    val = val.trim().toLowerCase();
    
    if (type === 'bracket') {
      const bracketMatch = val.match(/^([\d.]+)\s*-\s*([\d.]+)(?:\s+.*)?$/);
      if (bracketMatch) {
        const min = parseFloat(bracketMatch[1]);
        const max = parseFloat(bracketMatch[2]);
        if (!isNaN(min) && !isNaN(max)) {
          return {
            type: 'bracket',
            brackets: [
              { min: null, max: min, alias: 'Low', severity: 'At risk' },
              { min: min, max: max, alias: 'Normal', severity: 'Normal' },
              { min: max, max: null, alias: 'High', severity: 'At risk' }
            ]

          };
        }
      }
      
      const lessMatch = val.match(/^(<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/);
      if (lessMatch) {
        const v = parseFloat(lessMatch[2]);
        if (!isNaN(v)) {
            return {
                type: 'bracket',
                brackets: [
                    { min: null, max: v, alias: 'Normal', severity: 'Normal' },
                    { min: v, max: null, alias: 'High', severity: 'At risk' }
                ]

            }
        }
      }
      const greaterMatch = val.match(/^(>|>=|over|greater than|above)\s*([\d.]+)(?:\s+.*)?$/);
      if (greaterMatch) {
        const v = parseFloat(greaterMatch[2]);
        if (!isNaN(v)) {
            return {
                type: 'bracket',
                brackets: [
                    { min: null, max: v, alias: 'Low', severity: 'At risk' },
                    { min: v, max: null, alias: 'Normal', severity: 'Normal' }
                ]

            }
        }
      }
      
      const plainMatch = val.match(/^([\d.]+)(?:\s+.*)?$/);
      if (plainMatch) {
        const v = parseFloat(plainMatch[1]);
        if (!isNaN(v)) {
            return {
                type: 'bracket',
                brackets: [
                    { min: null, max: v, alias: 'Normal', severity: 'Normal' },
                    { min: v, max: null, alias: 'High', severity: 'At risk' }
                ]

            }
        }
      }
      
      return defaultBracketRange;
    } else {
      const lessMatch = val.match(/^(<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/);
      if (lessMatch) {
        const v = parseFloat(lessMatch[2]);
        if (!isNaN(v)) {
          const isLessEq = lessMatch[1] === '<=';
          return {
            type: 'simple',
            conditions: [
              { operator: isLessEq ? '<=' : '<', value: v, alias: 'Healthy', severity: 'Normal' },
              { operator: isLessEq ? '>' : '>=', value: v, alias: 'Elevated', severity: 'At risk' }
            ]

          };
        }
      }
      const greaterMatch = val.match(/^(>|>=|over|greater than|above)\s*([\d.]+)(?:\s+.*)?$/);
      if (greaterMatch) {
        const v = parseFloat(greaterMatch[2]);
        if (!isNaN(v)) {
          const isGreaterEq = greaterMatch[1] === '>=';
          return {
            type: 'simple',
            conditions: [
              { operator: isGreaterEq ? '>=' : '>', value: v, alias: 'Healthy', severity: 'Normal' },
              { operator: isGreaterEq ? '<' : '<=', value: v, alias: 'Low', severity: 'At risk' }
            ]

          };
        }
      }
      
      const plainMatch = val.match(/^([\d.]+)(?:\s+.*)?$/);
      if (plainMatch) {
        const v = parseFloat(plainMatch[1]);
        if (!isNaN(v)) {
          return {
            type: 'simple',
            conditions: [
              { operator: '<', value: v, alias: 'Healthy', severity: 'Normal' },
              { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
            ]

          };
        }
      }
      
      return defaultSimpleRange;
    }


};

export const BiomarkerRangeBuilder: React.FC<BiomarkerRangeBuilderProps> = ({ rangeConfig, customRanges = [], normalRangeStr, onChange }) => {
  const [activeTab, setActiveTab] = useState<'normal' | 'custom'>('normal');

  const updateNormalRange = (newRange: RangeConfig | undefined) => {
    onChange(newRange, customRanges);
  };

  const updateCustomRanges = (newCustom: CustomRangeDef[]) => {
    onChange(rangeConfig, newCustom);
  };

  return (
    <div className="border border-theme-border rounded-xl overflow-hidden mt-4 bg-slate-50 dark:bg-slate-900">
      <div className="flex border-b border-theme-border bg-white dark:bg-slate-950">
        <button
          type="button"
          className={`flex-1 py-2 text-xs font-bold transition-colors ${activeTab === 'normal' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          onClick={() => setActiveTab('normal')}
        >
          Normal Range
        </button>
        <button
          type="button"
          className={`flex-1 py-2 text-xs font-bold transition-colors ${activeTab === 'custom' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
          onClick={() => setActiveTab('custom')}
        >
          Custom Overrides
        </button>
      </div>

      <div className="p-4">
        {activeTab === 'normal' && (
          <RangeEditor 
            range={rangeConfig}
            normalRangeStr={normalRangeStr} 
            onChange={updateNormalRange} 
            title="Base Normal Range"
          />
        )}

        {activeTab === 'custom' && (
          <div className="space-y-4">
            {customRanges.map((cr, idx) => (
              <div key={cr.id || `custom_range_${idx}`} className="border border-theme-border rounded-lg p-3 bg-white dark:bg-slate-950">
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-theme-border">
                  <h4 className="text-xs font-bold text-theme-neutral">Custom Range Override #{idx + 1}</h4>
                  <button type="button" onClick={() => {
                    const next = [...customRanges];
                    next.splice(idx, 1);
                    updateCustomRanges(next);
                  }} className="text-rose-500 hover:bg-rose-50 p-1 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Range Name / Source</label>
                    <input
                      type="text"
                      value={cr.name || ''}
                      onChange={e => {
                        const next = [...customRanges];
                        next[idx].name = e.target.value;
                        updateCustomRanges(next);
                      }}
                      className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-theme-border rounded px-2.5 py-1.5 text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                      placeholder="e.g. Chinese Lipid Guidelines"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Gender</label>
                    <select
                      value={cr.filters.gender || ''}
                      onChange={e => {
                        const next = [...customRanges];
                        next[idx].filters.gender = e.target.value;
                        updateCustomRanges(next);
                      }}
                      className="w-full text-xs bg-slate-50 border border-theme-border rounded px-2 py-1.5"
                    >
                      <option value="">Any</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Ethnicity</label>
                    <select
                      value={cr.filters.ethnicity || ''}
                      onChange={e => {
                        const next = [...customRanges];
                        next[idx].filters.ethnicity = e.target.value;
                        updateCustomRanges(next);
                      }}
                      className="w-full text-xs bg-slate-50 border border-theme-border rounded px-2 py-1.5"
                    >
                      <option value="">Any</option>
                      <option value="asian">Asian</option>
                      <option value="black">Black</option>
                      <option value="caucasian">Caucasian</option>
                      <option value="hispanic">Hispanic</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Min Age</label>
                    <input
                      type="number"
                      value={cr.filters.minAge || ''}
                      onChange={e => {
                        const next = [...customRanges];
                        next[idx].filters.minAge = e.target.value ? Number(e.target.value) : '';
                        updateCustomRanges(next);
                      }}
                      className="w-full text-xs bg-slate-50 border border-theme-border rounded px-2 py-1.5"
                      placeholder="e.g. 18"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Max Age</label>
                    <input
                      type="number"
                      value={cr.filters.maxAge || ''}
                      onChange={e => {
                        const next = [...customRanges];
                        next[idx].filters.maxAge = e.target.value ? Number(e.target.value) : '';
                        updateCustomRanges(next);
                      }}
                      className="w-full text-xs bg-slate-50 border border-theme-border rounded px-2 py-1.5"
                      placeholder="e.g. 65"
                    />
                  </div>
                </div>

                <RangeEditor 
                  range={cr.range}
                  normalRangeStr={normalRangeStr} 
                  onChange={(r) => {
                    const next = [...customRanges];
                    if (r) {
                      next[idx].range = r;
                    }
                    updateCustomRanges(next);
                  }}
                />
              </div>
            ))}

            <button
              type="button"
              onClick={() => {
                const newCustom: CustomRangeDef = {
                  id: 'cr_' + Date.now(),
                  filters: {},
                  range: defaultBracketRange
                };
                updateCustomRanges([...customRanges, newCustom]);
              }}
              className="w-full py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800 border-dashed rounded-lg text-xs font-bold flex items-center justify-center gap-1 hover:bg-indigo-100"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Custom Override
            </button>
          </div>
        )}
      </div>
    </div>
  );

};

const RangeEditor: React.FC<{ range?: RangeConfig, normalRangeStr?: string, onChange: (r?: RangeConfig) => void, title?: string }> = ({ range, normalRangeStr, onChange, title }) => {
  return (
    <div className="space-y-3">
      {title && <h4 className="text-xs font-bold text-theme-neutral">{title}</h4>}
      
      {!range ? (
        <div className="flex gap-2">
          {normalRangeStr && normalRangeStr.trim().length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const str = normalRangeStr.trim();
                let type = 'simple';
                if (str.match(/^([\d.]+)\s*-\s*([\d.]+)(?:\s+.*)?$/)) type = 'bracket';
                onChange(parseNormalRangeStr(normalRangeStr, type as 'simple' | 'bracket'));
              }}
              className="flex-1 py-2 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-semibold hover:bg-slate-50 text-indigo-600 dark:text-indigo-400"
            >
              Edit Range Configuration
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange(defaultSimpleRange)}
                className="flex-1 py-2 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-semibold hover:bg-slate-50"
              >
                Create Simple Range
              </button>
              <button
                type="button"
                onClick={() => onChange(defaultBracketRange)}
                className="flex-1 py-2 bg-white dark:bg-slate-800 border border-theme-border rounded-lg text-xs font-semibold hover:bg-slate-50"
              >
                Create Bracket Range
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <select
              value={range.type}
              onChange={e => {
                if (e.target.value === 'simple') onChange(parseNormalRangeStr(normalRangeStr, 'simple'));
                else onChange(parseNormalRangeStr(normalRangeStr, 'bracket'));
              }}
              className="text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-theme-border rounded px-2 py-1"
            >
              <option value="simple">Simple Range</option>
              <option value="bracket">Bracket Range</option>
            </select>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-[10px] text-rose-500 hover:underline"
            >
              Remove Range
            </button>
          </div>

          {range.type === 'simple' && (
            <div className="space-y-2 bg-white dark:bg-slate-800 p-3 rounded-lg border border-theme-border">
              <div className="flex items-center gap-2">
                <select
                  value={range.conditions[0].operator}
                  onChange={e => {
                    const next = { ...range };
                    next.conditions[0].operator = e.target.value as any;
                    // Auto update opposite
                    if (e.target.value === '>=') next.conditions[1].operator = '<';
                    if (e.target.value === '<=') next.conditions[1].operator = '>';
                    if (e.target.value === '>') next.conditions[1].operator = '<=';
                    if (e.target.value === '<') next.conditions[1].operator = '>=';
                    onChange(next);
                  }}
                  className="bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                >
                  <option value=">=">&gt;=</option>
                  <option value="<=">&lt;=</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                </select>
                <input
                  type="number"
                  value={range.conditions[0].value}
                  onChange={e => {
                    const next = { ...range };
                    const val = Number(e.target.value);
                    next.conditions[0].value = val;
                    next.conditions[1].value = val;
                    onChange(next);
                  }}
                  className="w-16 bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                />
                <span className="text-xs font-semibold text-slate-500">is</span>
                <input
                  type="text"
                  placeholder="Alias (e.g. Elevated)"
                  value={range.conditions[0].alias}
                  onChange={e => {
                    const next = { ...range };
                    next.conditions[0].alias = e.target.value;
                    onChange(next);
                  }}
                  className="flex-1 bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                />
                <select
                  value={range.conditions[0].severity}
                  onChange={e => {
                    const next = { ...range };
                    next.conditions[0].severity = e.target.value as any;
                    onChange(next);
                  }}
                  className="bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-[10px] font-bold"
                >
                  {SEVERITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                <span className="w-12 text-center text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">
                  {range.conditions[1].operator}
                </span>
                <span className="w-16 text-center text-xs font-bold text-theme-text-secondary">
                  {range.conditions[1].value}
                </span>
                <span className="text-xs font-semibold text-slate-500">is</span>
                <input
                  type="text"
                  placeholder="Alias (e.g. Healthy)"
                  value={range.conditions[1].alias}
                  onChange={e => {
                    const next = { ...range };
                    next.conditions[1].alias = e.target.value;
                    onChange(next);
                  }}
                  className="flex-1 bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                />
                <select
                  value={range.conditions[1].severity}
                  onChange={e => {
                    const next = { ...range };
                    next.conditions[1].severity = e.target.value as any;
                    onChange(next);
                  }}
                  className="bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-[10px] font-bold"
                >
                  {SEVERITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}

          {range.type === 'bracket' && (
            <div className="space-y-2">
              {range.brackets.map((br, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-theme-border">
                  <span className="text-[10px] font-bold text-slate-400">From</span>
                  <input
                    type="number"
                    placeholder="Min"
                    value={br.min === null ? '' : br.min}
                    onChange={e => {
                      const next = { ...range };
                      next.brackets[i].min = e.target.value === '' ? null : Number(e.target.value);
                      onChange(next);
                    }}
                    className="w-16 bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                  />
                  <span className="text-[10px] font-bold text-slate-400">to</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={br.max === null ? '' : br.max}
                    onChange={e => {
                      const next = { ...range };
                      next.brackets[i].max = e.target.value === '' ? null : Number(e.target.value);
                      onChange(next);
                    }}
                    className="w-16 bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                  />
                  <span className="text-xs font-semibold text-slate-500">=</span>
                  <input
                    type="text"
                    placeholder="Alias (e.g. Normal)"
                    value={br.alias}
                    onChange={e => {
                      const next = { ...range };
                      next.brackets[i].alias = e.target.value;
                      onChange(next);
                    }}
                    className="flex-1 min-w-[80px] bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-xs"
                  />
                  <select
                    value={br.severity}
                    onChange={e => {
                      const next = { ...range };
                      next.brackets[i].severity = e.target.value as any;
                      onChange(next);
                    }}
                    className="bg-slate-50 dark:bg-slate-900 border border-theme-border rounded px-2 py-1 text-[10px] font-bold"
                  >
                    {SEVERITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...range };
                      next.brackets.splice(i, 1);
                      onChange(next);
                    }}
                    className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const next = { ...range };
                  next.brackets.push({ min: null, max: null, alias: 'New Bracket', severity: 'Normal' });
                  onChange(next);
                }}
                className="text-[10px] font-bold text-indigo-600 flex items-center gap-1 hover:underline px-1"
              >
                <Plus className="w-3 h-3" /> Add Bracket
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );


};

export default BiomarkerRangeBuilder;
