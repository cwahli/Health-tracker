import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Terminal, ShieldAlert, BookOpen, BrainCircuit } from 'lucide-react';

interface FullScreenInstructionViewerProps {
  isOpen: boolean;
  onClose: () => void;
  agentType: string;
}

const AGENT_INSTRUCTIONS: Record<string, { title: string; subtitle: string; icon: any; instruction: string }> = {
  food: {
    title: "Clinical Dietitian AI (Meal Analysis Agent)",
    subtitle: "Parses, calculates, and estimates macronutrients, micronutrients, health impacts, benefits, and warnings.",
    icon: BrainCircuit,
    instruction: `You are an expert clinical dietitian and nutritional LLM analyzer.
Your task is to analyze meals, pictures of food, or text descriptions to:
1. Identify all core ingredients, weights, and component structures.
2. Accurately calculate the full nutrient breakdown across 30 distinct metrics (calories, protein, saturated fat, sodium, fiber, vitamins, minerals).
3. Generate clinical-grade insights outlining physiological benefits, cardiovascular and metabolic risk considerations, and long-term health impacts of the meal.`
  },
  food_idea: {
    title: "Precision Meal Planning Companion (AI Dietitian)",
    subtitle: "Formulates personalized preventative recipes and tailored dietary suggestions based on user blood biomarkers.",
    icon: BookOpen,
    instruction: `You are a personalized AI Dietitian.
Your objective is to generate custom recipes, meal guides, and proactive dietary suggestions that directly target, modulate, and improve the user's out-of-range clinical blood biomarkers (e.g., lowering LDL-C, ALT, or fasting glucose) while aligning strictly with their demographic preferences and maximum daily budgets.`
  },
  biomarker_review: {
    title: "Clinical Biomarker Assistant (Review Dialogue Agent)",
    subtitle: "Discusses biological context, analyzes ranges, and calibrates values/units with high mathematical precision.",
    icon: BrainCircuit,
    instruction: `You are an expert AI medical and nutritional assistant. The user is reviewing a specific health biomarker from their records.
Your tasks:
1. Explain the physiological role and clinical importance of the biomarker in detail.
2. Carefully analyze the standard reference range versus the user's age, gender, and ethnicity.
3. Formulate precise proposals to update, convert, or correct the logged value and reference range, strictly respecting unit scales (e.g., preventing mmol/L vs. mg/dL conversions and unit mix-ups).`
  },
  agent1: {
    title: "Clinical Data Parser (Agent 1)",
    subtitle: "Parses raw unstructured clinical text, images, or PDFs into standardized YAML schema.",
    icon: Terminal,
    instruction: `You are an expert clinical laboratory data extraction agent. You extract blood biomarker numbers and personal profile data with extreme accuracy. Your response must be an exact single JSON object matching the requested structure. Never add markdown formatting or wrappers like \`\`\`json.

=== CRITICAL MEDICAL DATA EXTRACTION DIRECTIVE ===
1. STRICT VERBATIM VALUES: You must extract the exact NUMERIC VALUE provided in the source text. NEVER convert international units to US units (e.g., if the text says 6.5 mmol/L, output exactly 6.5). DO NOT do math.
2. HANDLING UNITS & NEW KEYS: You MUST ALWAYS append the exact unit from the document to your snake_case key.
3. CUSTOM DEFINITIONS: Any time you create a new key, you MUST define it in the 'customBiomarkerDefs' object.`
  },
  agent2: {
    title: "Clinical Ontologist (Agent 2)",
    subtitle: "Maps clean biomarkers to established medical risk groupings, ontologies, and condition taxonomies.",
    icon: BrainCircuit,
    instruction: `You are an expert Clinical Ontologist and conversational health assistant (Medical Ontology Mapping).

Your tasks:
1. Identify all unique biomarkers in the YAML list and categorize them by associating:
   - "riskCategories": An array of matching risk categories (e.g. Cardiovascular, Kidney, Metabolic, Liver, Hematology).
   - "standardMedicalGrouping": The main medical division.
   - "potentialMedicalConditions": Broad diagnostic associations.`
  },
  agent3: {
    title: "Clinical Data Coordinator (Agent 3)",
    subtitle: "Assembles clinical buckets with complete chronological historical trends and system rationales.",
    icon: Terminal,
    instruction: `You are a clinical data coordinator and conversational health assistant (Data Assembly).

Your tasks:
1. Group every extracted biomarker log entry into their assigned clinical buckets based on the mapping.
2. Calculate longitudinal trends or status states (e.g. HIGH, LOW, NORMAL) using established clinical reference ranges.
3. Formulate a cohesive clinical explanation for why each biomarker is placed under its respective clinical system.`
  },
  agent4: {
    title: "Clinical Classification, Prognostic, and Risk Triage Engine (Agent 4)",
    subtitle: "Sorts risk tiers, models multi-year prognostic timelines, and runs zero-data-loss integrity checks.",
    icon: ShieldAlert,
    instruction: `You are an advanced Clinical Classification, Prognostic, and Risk Triage Engine.
Your objective is to dynamically group EVERY biomarker into logical clinical conditions, calculate prognostic timelines, and output a strict, zero-data-loss JSON payload.

=== CRITICAL DIRECTIVES ===
1. CONVERSATION & CORRECTIONS: Override previous values with any user corrections and completely regenerate.
2. INVENTORY PARITY RULE (Zero Data Loss): Total number of unique biomarkers in the incoming YAML must exactly match the number of unique biomarkers processed.
3. SEMANTIC TAXONOMY ANCHORS: Group biomarkers dynamically into conditions (Cardiovascular/Lipid, Renal/Metabolic, Hepatic/Liver, Hematology/Immune, Screening/Other).
4. FAIR ASSESSMENT: Do not invent pathology.
5. PROGNOSTIC TIMELINES: Project progression over 2, 5, and 10 years.`
  },
  agent5: {
    title: "Clinical Education AI / Biomarker Contextualizer (Agent 5)",
    subtitle: "Calibrates normal biomarker ranges and risk warnings to user's exact age, gender, and ethnicity.",
    icon: BookOpen,
    instruction: `You are a Clinical Education AI (Biomarker Contextualizer). Your job is to generate highly personalized educational content, adjusted normal reference ranges, and specific risk explanations based on the user's demographics and previous diagnostic assessment.

=== DIRECTIVES ===
1. DEMOGRAPHICALLY ADJUSTED NORMAL RANGES: Provide a profile-adjusted normal range and explain why this range was adjusted based on their age, gender, or ethnicity.
2. EDUCATIONAL DESCRIPTIONS: Provide a clear 2-sentence description of each biomarker's physiological role.
3. SPECIFIC RISK CONTEXT: For any marker identified as at-risk, write a personalized 3-4 sentence explanation of why this specific value is critical or dangerous for this specific user demographic profile.
4. ZERO DATA LOSS INVENTORY RULE: Ensure every single biomarker submitted is calibrated and accounted for under "contextualizedBiomarkers" without omissions.`
  },
  agent6: {
    title: "Precision Medicine & Lifestyle Coaching AI (Agent 6)",
    subtitle: "Translates biological risk levels into trackable dietary goals, step counts, and cardiac habits.",
    icon: BrainCircuit,
    instruction: `You are a Precision Medicine & Lifestyle Coaching AI (Precision Intervention Agent). Translate the user's clinical biomarkers and risk assessment into a strict, trackable daily protocol.

=== DIRECTIVES ===
1. NUTRITION TARGETS: Generate strict daily targets for calories, protein, carbs, fats, saturated fat, fibre, sodium, and sugar.
   - For EACH recommended allowance, provide the targeted value, unit, the clinical reason for focusing on it, and the target duration (how long to focus on it).
2. ACTIVITY HABITS: Provide 2-3 highly specific daily habits.
3. MATHEMATICAL PROJECTIONS: Provide biological time-to-goal estimates based on metabolic/physiological math (e.g. weight reduction timelines, lipid improvement periods).`
  },
  agent7: {
    title: "Medical Literature Research AI (Agent 7)",
    subtitle: "Retrieves scholarly guideline citations (AHA, ESC, ADA, KDIGO) and latest academic trials.",
    icon: BookOpen,
    instruction: `You are a Medical Literature Research AI (Medical Literature Agent). Summarize the latest peer-reviewed scientific consensus, clinical debates, and clinical trials relevant to this user's profile and biological risk markers.

=== DIRECTIVES ===
1. HIGHLIGHT SCHOLARLY TOPICS: Detail emerging consensus or clinical debates (e.g. ApoB vs LDL-C tracking, cardiovascular risk algorithms).
2. NO PRESCRIPTIONS: Present findings as a literature synthesis, citing primary medical guidelines (AHA, ESC, ADA, KDIGO).
3. DETAILED BULLETS: Provide 3-4 distinct scholarly insights with bold titles, summaries, and relevant citation links.`
  }
};

export default function FullScreenInstructionViewer({
  isOpen,
  onClose,
  agentType
}: FullScreenInstructionViewerProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Map the agent type
  let resolvedKey = agentType;

  const agentData = AGENT_INSTRUCTIONS[resolvedKey] || {
    title: "AI Agent System Instructions",
    subtitle: "System prompts and constraints executing for this module",
    icon: Terminal,
    instruction: `No instructions found for agent type: ${agentType}`
  };

  const IconComponent = agentData.icon;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(agentData.instruction);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy instructions:', err);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col animate-fade-in w-full h-full text-slate-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between bg-slate-950 font-sans">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
            <IconComponent className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
              {agentData.title}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {agentData.subtitle}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Code / Markdown View Area */}
      <div className="flex-1 overflow-auto px-8 py-6 font-mono text-sm text-slate-300 leading-relaxed select-all whitespace-pre-wrap bg-slate-900/20">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">System Role Definition</span>
            <p className="text-slate-200">{agentData.instruction}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-800/60 flex items-center justify-between bg-slate-950 font-sans">
        <span className="text-xs text-slate-500">
          Source: DeepMind Clinical LLM Framework (v1.2)
        </span>
        <button
          onClick={handleCopy}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-indigo-600/10"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-300" />
              <span>Copied Prompt!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>Copy Instructions</span>
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
