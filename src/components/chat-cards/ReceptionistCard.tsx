import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { cleanWhatShouldIDoHeader } from '../../utils/formatUtils';
import { AgentCardProps } from './types';
import { translations } from '../../utils/translations';
import { interpolate } from '../../utils/i18n';
import { 
  Sparkles, 
  UserCheck, 
  Activity, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  Dna, 
  HeartPulse, 
  ChevronRight,
  ShieldAlert,
  SlidersHorizontal,
  Send,
  Scale
} from 'lucide-react';

export const ReceptionistCard: React.FC<AgentCardProps> = ({
  msg,
  messages = [],
  handleSend,
  onOpenAgentFromFrontDesk,
  onLogMedical,
  language,
}) => {
  const t = translations[language || 'en'] || translations.en;
  const isHandedOff = Array.isArray(messages) && messages.some(m => m.data?.isHandoffNotice || (m.role === 'assistant' && (m.agentType === 'health_baseline' || m.agentType === 'medical')));
  const agentResult = msg.agentResult || msg.data?.agentResult || msg.data || {};
  const {
    intent,
    targetAgent,
    status,
    missingFields,
    memory,
    isDisambiguationRequired,
    disambiguationContext,
    uiForm,
    handoffPayload,
    updatedProfile,
    newBiomarkerLogs,
    filledRows
  } = agentResult;

  // Local state for interactive UI form
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleFieldChange = (name: string, value: any) => {
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!handleSend) return;

    // Build user-friendly message from form values
    const entries = Object.entries(formValues)
      .filter(([_, v]) => v !== undefined && v !== '' && v !== null)
      .map(([k, v]) => {
        const fieldDef = uiForm?.fields?.find((f: any) => f.name === k);
        const label = fieldDef?.label || k;
        const unit = fieldDef?.unit ? ` ${fieldDef.unit}` : '';
        return `${label}: ${v}${unit}`;
      });

    if (entries.length > 0) {
      const formattedMessage = entries.join(', ');
      setIsSubmitted(true);
      handleSend(formattedMessage);
    }
  };

  const isHandoffReady = status === 'ready_for_handoff' || !!handoffPayload;
  let rawText = cleanWhatShouldIDoHeader(msg.content || agentResult.text || agentResult.userResponse || '');

  return (
    <div className="w-full flex flex-col gap-3 text-slate-800 dark:text-slate-100">
      {/* 1. Main Conversational Response */}
      {rawText && (
        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{rawText}</ReactMarkdown>
        </div>
      )}

      {/* 2. Disambiguation Alert Box */}
      {isDisambiguationRequired && disambiguationContext && (
        <div className="mt-2 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-amber-900 dark:text-amber-200">
            <div className="font-semibold text-amber-800 dark:text-amber-300 mb-0.5">
              {t.recepSafetyNote}
            </div>
            <p className="leading-normal">{disambiguationContext}</p>
          </div>
        </div>
      )}

      {/* 3. Inline Update Confirmation Badges */}
      {((updatedProfile && Object.keys(updatedProfile).length > 0) || (newBiomarkerLogs && newBiomarkerLogs.length > 0)) && (
        <div className="mt-1 flex flex-wrap gap-2 items-center">
          {updatedProfile?.weight && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-medium">
              <Scale className="w-3.5 h-3.5" />
              {t.recepWeight} {updatedProfile.weight} kg
            </span>
          )}
          {updatedProfile?.height && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-medium">
              <UserCheck className="w-3.5 h-3.5" />
              {t.recepHeight} {updatedProfile.height} cm
            </span>
          )}
          {updatedProfile?.age && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-medium">
              <UserCheck className="w-3.5 h-3.5" />
              {t.recepAge} {updatedProfile.age}
            </span>
          )}
          {newBiomarkerLogs && newBiomarkerLogs.map((log: any, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-medium">
              <HeartPulse className="w-3.5 h-3.5 text-blue-500" />
              {log.biomarker}: {log.value} {log.unit || ''}
            </span>
          ))}
        </div>
      )}

      {/* 4. Interactive UI Form Widget */}
      {uiForm && uiForm.fields && uiForm.fields.length > 0 && !isSubmitted && (
        <form 
          onSubmit={handleFormSubmit}
          className="mt-2 p-4 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
              {uiForm.title || t.recepFormTitle}
            </span>
          </div>

          {uiForm.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">{uiForm.description}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {uiForm.fields.map((field: any) => {
              const val = formValues[field.name] || '';
              return (
                <div key={field.name} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center justify-between">
                    <span>{field.label}</span>
                    {field.unit && <span className="text-[10px] text-slate-400">({field.unit})</span>}
                  </label>

                  {field.type === 'select' && field.options ? (
                    <div className="flex flex-col gap-1.5">
                      <select
                        value={val}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        className="text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                        required={field.required}
                      >
                        <option value="">{t.recepSelect}</option>
                        {field.options.map((opt: string) => (
                          <option key={opt} value={opt}>{opt.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
                        ))}
                      </select>
                      {field.options.length <= 5 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {field.options.map((opt: string) => {
                            const isSelected = val === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handleFieldChange(field.name, opt)}
                                className={`px-3 py-2 text-sm rounded-md transition-all cursor-pointer font-medium ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                {opt.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="relative flex items-center">
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        step={field.type === 'number' ? 'any' : undefined}
                        value={val}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder || interpolate(t.recepEnterField, { x: field.label.toLowerCase() })}
                        className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-100"
                        required={field.required}
                      />
                      {field.unit && (
                        <span className="absolute right-2.5 text-xs text-slate-400 pointer-events-none">
                          {field.unit}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="submit"
            className="mt-2 self-end inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <span>{uiForm.submitLabel || t.recepSubmit}</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {isSubmitted && (
        <div className="mt-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{t.recepSubmitted}</span>
        </div>
      )}

      {/* 5. Biomarker Extraction Table (if filledRows present) */}
      {filledRows && filledRows.length > 0 && (
        <div className="mt-2 p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Dna className="w-4 h-4 text-indigo-500" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {interpolate(t.recepPanel, { n: filledRows.length })}
              </span>
            </div>
            {onLogMedical && (
              <button
                type="button"
                onClick={() => onLogMedical(filledRows)}
                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {t.recepSyncLog}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400">
                  <th className="pb-1.5 font-medium">{t.recepColTest}</th>
                  <th className="pb-1.5 font-medium">{t.recepColResult}</th>
                  <th className="pb-1.5 font-medium">{t.recepColRange}</th>
                  <th className="pb-1.5 font-medium text-right">{t.recepColStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filledRows.map((row: any, idx: number) => {
                  const statusColor = 
                    row.status === 'optimal' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' :
                    row.status === 'borderline' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' :
                    row.status === 'risk' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' :
                    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

                  return (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2 font-medium text-slate-700 dark:text-slate-200">
                        {row.printed || row.key}
                      </td>
                      <td className="py-2 font-semibold text-slate-900 dark:text-slate-100">
                        {row.value} {row.unit || ''}
                      </td>
                      <td className="py-2 text-slate-500 dark:text-slate-400">
                        {row.assignedRange || row.printedRange || '—'}
                      </td>
                      <td className="py-2 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${statusColor}`}>
                          {row.status || t.recepStatusRecorded}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Handoff Card & Action Trigger */}
      {isHandoffReady && handoffPayload && (
        isHandedOff ? (
          <div className="mt-1 flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="font-medium">
                {handoffPayload.targetAgent === 'medical' ? t.recepMedicalSpecialist : t.recepHealthCoach}: {t.recepHandoffDone}
              </span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/50">
              {t.recepConnected}
            </span>
          </div>
        ) : (
          <div className="mt-2 p-4 bg-gradient-to-br from-indigo-50/80 via-purple-50/40 to-slate-50 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-slate-900 border border-indigo-200/80 dark:border-indigo-800/60 rounded-2xl shadow-xs flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wide">
                  {handoffPayload.targetAgent === 'health_coach' ? t.recepCoachReady : t.recepSpecialistReady}
                </span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 rounded-full">
                {t.recepHandoffFormulated}
              </span>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-normal">
              {handoffPayload.summaryForAgent}
            </p>

            {handoffPayload.actionableInsights && handoffPayload.actionableInsights.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {handoffPayload.actionableInsights.slice(0, 3).map((insight: string, i: number) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{insight}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {t.recepHandoffWorking}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{handoffPayload.targetAgent === 'medical' ? t.recepMedicalSpecialist : t.recepHealthCoach}</span>
              </span>
            </div>
          </div>
        )
      )}
    </div>
  );
};
