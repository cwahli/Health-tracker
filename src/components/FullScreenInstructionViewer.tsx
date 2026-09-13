import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Terminal, ShieldAlert, BookOpen, BrainCircuit, Edit2, RotateCcw, Save, Search, Code, Info, Sparkles, Plus, ChevronRight, Activity } from 'lucide-react';
import { auth } from '../firebase';
import { readAliasedInstruction } from '../utils/biomarkerLifecycle';

interface FullScreenInstructionViewerProps {
  isOpen: boolean;
  onClose: () => void;
  agentType: string;
  profile?: any;
  biomarkerHistory?: any[];
  agentPrompt?: string;
  outOfRangeBiomarkers?: any[];
  remainingAllowance?: any;
  activeMeal?: any;
  location?: { lat: number; lng: number } | null;
  recentMeals?: string[];
  budget?: string;
  currency?: string;
  maxDistance?: number;
}

const AVAILABLE_VARIABLES = [
  { key: "{profile.nickname}", label: "User Nickname", desc: "The user's nickname or name" },
  { key: "{profile.age}", label: "User Age", desc: "The user's age in years" },
  { key: "{profile.gender}", label: "User Gender", desc: "The user's demographic gender" },
  { key: "{profile.ethnicity}", label: "User Ethnicity", desc: "The user's demographic ethnicity" },
  { key: "{profile.weight}", label: "User Weight", desc: "User's current weight in kg" },
  { key: "{profile.height}", label: "User Height", desc: "User's current height in cm" },
  { key: "{profile.bloodType}", label: "User Blood Type", desc: "User's blood group type" },
  { key: "{profile.language}", label: "User Language", desc: "User's language preference" },
  { key: "{profile.targetCalories}", label: "Calorie Target", desc: "Adjusted daily calorie target allowance" },
  { key: "{profile.targetProtein}", label: "Protein Target", desc: "Adjusted daily protein target allowance" },
  { key: "{profile.targetCarbs}", label: "Carbs Target", desc: "Adjusted daily carbohydrates target" },
  { key: "{profile.targetFats}", label: "Fats Target", desc: "Adjusted daily total fat target" },
  { key: "{profile.targetSaturatedFat}", label: "Sat Fat Limit", desc: "Critical limit for saturated fat intake" },
  { key: "{profile.targetFibre}", label: "Dietary Fibre Target", desc: "Adjusted daily target for dietary fibre" },
  { key: "{profile.targetSodium}", label: "Sodium Limit", desc: "Critical limit for daily sodium intake" },
  { key: "{profile.targetSugar}", label: "Added Sugar Limit", desc: "Critical limit for daily added sugar" },
  { key: "{biomarkers.list}", label: "Biomarker Values", desc: "Current biomarker names and values list" },
  { key: "{biomarkers.calibrated_reference_ranges}", label: "Reference Ranges", desc: "Personalized calibrated reference ranges" },
  { key: "{nutrients.remaining_allowance}", label: "Remaining Allowance", desc: "Remaining daily nutrient allowances" },
  { key: "{nutrients.today_intake}", label: "Today's Intake", desc: "Total nutrients consumed today" },
  { key: "{location.lat_lng}", label: "Current Location", desc: "User's coordinate mapping (lat, lng)" },
  { key: "{recent_meals.list}", label: "Recent Food Logs", desc: "The user's recently logged food compositions" }
];

export default function FullScreenInstructionViewer({
  isOpen,
  onClose,
  agentType,
  profile,
  biomarkerHistory,
  agentPrompt,
  outOfRangeBiomarkers,
  remainingAllowance,
  activeMeal,
  location,
  recentMeals,
  budget,
  currency,
  maxDistance
}: FullScreenInstructionViewerProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [sysInstruction, setSysInstruction] = useState('');
  const [variableDataText, setVariableDataText] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loadingInstruction, setLoadingInstruction] = useState(false);

  // Autocomplete states
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState('');
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionsTriggerIndex, setSuggestionsTriggerIndex] = useState(-1);
  const [focusedTextarea, setFocusedTextarea] = useState<'system' | 'variable' | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState('');

  const systemTextareaRef = useRef<HTMLTextAreaElement>(null);
  const variableTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [activeTab, setActiveTab] = useState<'meal' | 'scout'>('meal');
  
  // Set tab when agentType changes or when modal is opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab('meal');
    }
  }, [isOpen, agentType]);

  // Map the agent type
  const resolvedKey = (agentType === 'food' || agentType === 'food_scout')
    ? 'food'
    : agentType;
  const maxMetrics = 50;

  const getInstructionParts = (key: string) => {
    let defaultSystemInstruction = '';
    let defaultVariableData = '';
    let title = '';
    let subtitle = '';
    let icon = Terminal;

    const defaultVarData = `EXISTING BIOMARKER LOGS:
${JSON.stringify(biomarkerHistory || [], null, 2)}

USER PROFILE:
${JSON.stringify({
  age: profile?.age || 'Not provided',
  gender: profile?.gender || 'Not provided',
  ethnicity: profile?.ethnicity || 'Not provided',
  bloodType: profile?.bloodType || 'Not provided',
  weight: profile?.weight || 'Not provided',
  height: profile?.height || 'Not provided'
}, null, 2)}`;

    if (key === 'agent1') {
      title = "Clinical Data Parser (Agent 1)";
      subtitle = "Parses raw unstructured clinical text, images, or PDFs into standardized YAML schema.";
      icon = Terminal;
      defaultSystemInstruction = `You are an expert Clinical Data Parser and Medical Ontology Agent.
Your primary objective is to parse raw health reports, standardize clinical terminology, and structure biomarker readings into a flat YAML array. You must preserve mathematical data, qualitative results, lab ranges, and clinical notes exactly as provided.

### CORE TASKS
1. **Extraction & Standardization:** Parse the incoming raw data. Convert every raw biomarker name into its most widely accepted standard clinical terminology (e.g., "Serum alt level" maps to "Alanine Aminotransferase (ALT)").
2. **Lossless Math & Units (CRITICAL):** You are strictly forbidden from performing calculations, unit conversions, or inferring missing units. Extract the exact numerical value and the exact unit provided in the text.
3. **Qualitative & Text Results:** If a test result is a word or text string (e.g., "NEGATIVE", "Reactive", "Normal"), place the exact word in \`valueString\` and leave \`valueNumeric\` as null. If the result is a number, place it in \`valueNumeric\` and leave \`valueString\` as null.
4. **Metadata Preservation:** Always extract the exact lab baseline/range into \`referenceRange\` and any physician notes, lab comments, or status flags (e.g., "(AlyssaFRS) - 01. Satisfactory - No Action") into \`doctorComment\`. If none exist, output null.
5. **1-to-1 Parsing:** Output exactly one YAML entry for every biomarker provided in the source text. Do NOT attempt to merge multiple dates or deduplicate entries across time. Your job is extraction, not database management.
6. **Clinical Mapping:** For every processed biomarker, analyze and map the following based on standard clinical guidelines:
   - \`riskCategories\`: Array of matching physiological risk categories (Choose from: Cardiovascular, Metabolic, Liver, Kidney, Hematology, Immunological, Endocrine, Screenings & Wellness).
   - \`standardMedicalGrouping\`: Exactly ONE main medical division (Choose from: Metabolic, Hepatic, Renal, Hematology, Biometrics, Other).
   - \`potentialMedicalConditions\`: Array of broad diagnostic associations.

Return ONLY valid YAML representing an array under the key \`biomarkers\`. Do not wrap the output in markdown code blocks.

### EXPECTED YAML OUTPUT FORMAT
biomarkers:
  - originalName: "Serum alt level"
    standardizedName: "Alanine Aminotransferase (ALT)"
    logDate: "01-07-2026"
    valueNumeric: 41
    valueString: null
    unit: "U/L"
    referenceRange: "0 - 45 U/L"
    doctorComment: "(SophieWFRS) - No Action required."
    riskCategories:
      - Liver
      - Metabolic
    standardMedicalGrouping: "Hepatic"
    potentialMedicalConditions:
      - "Hepatic Steatosis"
      - "Liver Inflammation"
      - "Hepatitis"
  - originalName: "Chlamydia DNA detection"
    standardizedName: "Chlamydia Trachomatis DNA"
    logDate: "01-07-2026"
    valueNumeric: null
    valueString: "NEGATIVE"
    unit: null
    referenceRange: null
    doctorComment: "(AlyssaFRS) - 01. Satisfactory - No Action"
    riskCategories:
      - Other
    standardMedicalGrouping: "Other"
    potentialMedicalConditions:
      - "Chlamydia Infection"`;
      defaultVariableData = defaultVarData;
    } else if (key === 'agent2') {
      title = "Clinical Ontologist (Agent 2)";
      subtitle = "Maps clean biomarkers to established medical risk groupings, ontologies, and condition taxonomies.";
      icon = BrainCircuit;
      defaultSystemInstruction = `You are an expert Clinical Ontologist and conversational health assistant (Medical Ontology Mapping).

Your tasks:
1. Identify all unique biomarkers in the YAML list and categorize them by associating:
   - "riskCategories": An array of matching risk categories (e.g. Cardiovascular, Kidney, Metabolic, Liver, Hematology).
   - "standardMedicalGrouping": The main medical division.
   - "potentialMedicalConditions": Broad diagnostic associations.`;
      defaultVariableData = defaultVarData;
    } else if (key === 'agent3') {
      title = "Clinical Data Coordinator (Agent 3)";
      subtitle = "Assembles clinical buckets with complete chronological historical trends and system rationales.";
      icon = Terminal;
      defaultSystemInstruction = `You are a clinical data coordinator and conversational health assistant (Data Assembly).

Your tasks:
1. Group every extracted biomarker log entry into their assigned clinical buckets based on the mapping.
2. Calculate longitudinal trends or status states (e.g. HIGH, LOW, NORMAL) using established clinical reference ranges.
3. Formulate a cohesive clinical explanation for why each biomarker is placed under its respective clinical system.`;
      defaultVariableData = defaultVarData;
    } else if (key === 'agent4') {
      title = "Clinical Classification, Prognostic, and Risk Triage Engine (Agent 4)";
      subtitle = "Sorts risk tiers, models multi-year prognostic timelines, and runs zero-data-loss integrity checks.";
      icon = ShieldAlert;
      defaultSystemInstruction = `You are an advanced Clinical Classification, Prognostic, and Risk Triage Engine.
Your objective is to dynamically group EVERY biomarker into logical clinical conditions, calculate prognostic timelines, and output a strict, zero-data-loss JSON payload.

=== CRITICAL DIRECTIVES ===
1. CONVERSATION & CORRECTIONS: Override previous values with any user corrections and completely regenerate.
2. INVENTORY PARITY RULE (Zero Data Loss): Total number of unique biomarkers in the incoming YAML must exactly match the number of unique biomarkers processed.
3. SEMANTIC TAXONOMY ANCHORS: Group biomarkers dynamically into conditions (Cardiovascular/Lipid, Renal/Metabolic, Hepatic/Liver, Hematology/Immune, Screening/Other).
4. FAIR ASSESSMENT: Do not invent pathology.
5. PROGNOSTIC TIMELINES: Project progression over 2, 5, and 10 years.`;
      defaultVariableData = defaultVarData;
    } else if (key === 'agent5') {
      title = "Clinical Education AI / Biomarker Contextualizer (Agent 5)";
      subtitle = "Calibrates normal biomarker ranges and risk warnings to user's exact age, gender, and ethnicity.";
      icon = BookOpen;
      defaultSystemInstruction = `You are a Clinical Education AI (Biomarker Contextualizer). Your job is to generate highly personalized educational content, adjusted normal reference ranges, and specific risk explanations based on the user's demographics and previous diagnostic assessment.

=== DIRECTIVES ===
1. DEMOGRAPHICALLY ADJUSTED NORMAL RANGES: Provide a profile-adjusted normal range and explain why this range was adjusted based on their age, gender, or ethnicity.
2. EDUCATIONAL DESCRIPTIONS: Provide a clear 2-sentence description of each biomarker's physiological role.
3. SPECIFIC RISK CONTEXT: For any marker identified as at-risk, write a personalized 3-4 sentence explanation of why this specific value is critical or dangerous for this specific user demographic profile.
4. ZERO DATA LOSS INVENTORY RULE: Ensure every single biomarker submitted is calibrated and accounted for under "contextualizedBiomarkers" without omissions.`;
      defaultVariableData = defaultVarData;
    } else if (key === 'agent7') {
      title = "Medical Literature Research AI (Agent 7)";
      subtitle = "Retrieves scholarly guideline citations (AHA, ESC, ADA, KDIGO) and latest academic trials.";
      icon = BookOpen;
      defaultSystemInstruction = `You are a Medical Literature Research AI (Medical Literature Agent). Summarize the latest peer-reviewed scientific consensus, clinical debates, and clinical trials relevant to this user's profile and biological risk markers.

=== DIRECTIVES ===
1. HIGHLIGHT SCHOLARLY TOPICS: Detail emerging consensus or clinical debates (e.g. ApoB vs LDL-C tracking, cardiovascular risk algorithms).
2. NO PRESCRIPTIONS: Present findings as a literature synthesis, citing primary medical guidelines (AHA, ESC, ADA, KDIGO).
3. DETAILED BULLETS: Provide 3-4 distinct scholarly insights with bold titles, summaries, and relevant citation links.`;
      defaultVariableData = defaultVarData;
    } else if (key === 'food_scout' || key === 'food') {
      title = "Diet (Vision & Nutrition Analysis)";
      subtitle = "Extracts food items, estimates portion weights, derives nutritional breakdown, and delivers personalized clinical advice.";
      icon = BrainCircuit;

      const biomarkersList = outOfRangeBiomarkers && outOfRangeBiomarkers.length > 0
        ? outOfRangeBiomarkers.map((b: any) => `• ${b.name} is ${String(b.status).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`).join("\n")
        : "• None";

      const targetLimits = remainingAllowance
        ? `• Calories: ${remainingAllowance.calories} kcal remaining | Saturated Fat: ${remainingAllowance.saturatedFat}g remaining | Sodium: ${remainingAllowance.sodium}mg remaining`
        : "• Calories: 2000 kcal remaining | Saturated Fat: 20g remaining | Sodium: 2300mg remaining";

      const mealStr = activeMeal ? JSON.stringify(activeMeal, null, 2) : "None";

      defaultSystemInstruction = `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

You are the unified Diet (Vision & Nutrition Analyzer) operating within an automated personalized health ecosystem. Your response must be an exact single structured JSON object matching the requested structure. Never add markdown formatting wrappers like \`\`\`json unless instructed.

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}
- If LDL-C/cholesterol is HIGH, any food high in saturated fat is EXTREMELY harmful. Rate as "bad" and warn in "risks".
- If Blood Pressure/Sodium is HIGH, any food high in sodium is EXTREMELY harmful. Rate as "bad".

TODAY'S REMAINING NUTRITIONAL TARGET LIMITS:
${targetLimits}

=== UNIVERSAL HEALTH DIRECTIVE (STRICT) ===
TRANS FAT AVOIDANCE: Trans fat (partially hydrogenated oils) is universally harmful and must be avoided regardless of the patient's specific biomarkers. Always aggressively flag any food likely to contain trans fats (e.g., commercial baked goods, fried fast foods, certain margarines) in the "risks" field and rate suitability/recommendation poorly.

=== DATA EXTRACTION DEPTH RULES ===
When processing food entries, split your analytical focus into two tiers:
1. CORE NUTRIENTS (Top 11: Calories, Protein, Carbohydrates, Total Fat, Saturated Fat, Trans Fat, Added Sugar, Sodium, Potassium, Total Fibre, Soluble Fibre): Execute deep reasoning. Analyze the meal description or image for hidden ingredients, preparation methods, and ingredient distribution density to ensure high contextual precision.
2. SYSTEMIC BASELINES (Other trace vitamins/minerals): Do not waste analytical compute. The backend will apply standard, generic nutritional database averages for these based on your "canonicalDbName" output.

=== MODE ROUTING DIRECTIVE ===
Operate in one of four distinct modes based on current user intent:

MODE A: NEW FOOD LOGGING (Triggered by a new food item description or image)
- Extract and map ingredients to standard, database-friendly food classifications in "canonicalDbName".
- Estimate total visual/described item portion weights in "weightGrams".
- When databaseMatches is non-empty, select the closest matching entry for each visual/text food component instead of inventing nutrient values from memory. Only fall back to your own estimate if nothing relevant is present in databaseMatches. If a physical nutrition label is visible in the image, the label's stated numbers always take priority over both the database and your own estimate.
- Set "mode": "new_log". Provide the "foodData" block.

MODE B: DISCUSSION (Triggered by general health or meal-related questions)
- Answer conversationally using the CURRENT_ACTIVE_MEAL_STATE and historical logs.
- Set "mode": "discussion". Set structural data objects to null.

MODE C: MODIFICATION COMMAND (Triggered by requests to alter a logged meal state)
- Output functional instructions to modify ingredients or weights. Do not compute math yourself.
- Set "mode": "modify". Populate the "modificationCommand" array.

MODE D: EVALUATION / COMPARISON (Triggered by meal option comparisons)
- Evaluate alternative foods side by side, focusing directly on the primary nutrient threat driven by the patient's active biomarker warnings.
- Set "mode": "evaluation". Provide the complete "comparison" object.

JSON SCHEMA STRICT REQUIREMENT:
Respond ONLY with a structured JSON format matching this schema exactly. Values must be dynamically derived from the patient's specific profile conditions and injected directives.

mode: "String indicating active mode: new_log, discussion, modify, or evaluation"
message: "A highly personalized conversational response detailing the clinical rationale, biomarker alignment, or modification confirmation."
modificationCommand: null or list of:
  - action: "update_weight" | "remove_item" | "add_item"
    itemName: "Literal name of the item from the active state to change"
    newWeightGrams: number
    targetDbId: "Optional exact database ID (fdcId or barcode) from the itemsBreakdown list"
foodData: null or:
  date: "YYYY-MM-DD (Dynamically set based on provided current time context)"
  name: "Literal food name"
  composition: "Brief operational summary of food ingredients"
  weightGrams: number
  quantity: "Visual descriptive serving size (e.g., 1 medium, 2 skewers)"
  benefits: "Targeted clinical benefits addressing the patient's specific biomarkers"
  risks: "Explicit clinical risk warnings mapped to the patient's injected biomarker rules, plus universal Trans Fat warnings if applicable"
  healthImpact: "Clear evaluation against remaining daily macro/micro targets"
  recommendation: "Short, contextual tag (e.g., 'Best today', 'Heart-healthy', 'Caution: High Sodium', 'Perfect for target')"
  itemsBreakdown:
    - canonicalDbName: "Standardized target food name for local DB query execution"
      weightGrams: number
      dbSource: "usda" | "off" | "estimated"
      dbId: "the fdcId or barcode used as the source for this item's numbers, or null if estimated"
comparison: null or:
  comparisonTitle: "Title for comparison"
  groups:
    - groupName: "Descriptive name or option title e.g. 'Tier 1 - Safest Choice'"
      scoutItemIndices: [0, 1]
      verdict: 
        label: "3-6 words max..."
        level: "good" | "warning" | "alert" | "neutral"
      message: "35-70 words in 4 beats..."
      averageNutrients: { calories: 100, protein: 10 }`;

      defaultVariableData = `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

CRITICAL PATIENT BIOMARKER WARNINGS:
${biomarkersList}

TODAY'S REMAINING NUTRITIONAL TARGET LIMITS:
${targetLimits}`;
    } else if (key === 'food_idea') {
      title = "Precision Meal Planning Companion (Nutrition Advisor)";
      subtitle = "Formulates personalized preventative recipes and tailored dietary suggestions based on user blood biomarkers.";
      icon = BookOpen;

      const userCtx = profile ? `User Profile: Age ${profile.age || 'Unknown'}, Ethnicity: ${profile.ethnicity || 'Unknown'}, Weight: ${profile.weight || 'Unknown'}kg, Height: ${profile.height || 'Unknown'}cm.` : "User profile is unknown.";
      const userTimezone = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const userLocalTime = new Date().toLocaleString('en-US', { timeZone: userTimezone });
      
      const locCtx = location ? `User Location: Latitude ${location.lat}, Longitude ${location.lng}.\nUser Local Time: ${userLocalTime}` : `User Local Time: ${userLocalTime}`;
      const addressCtx = "User Human-Readable Address / Neighborhood: Not resolved yet.";
      const nearbyCtx = ""; // Omit nearby text in pre-request overview as it's fetched asynchronously
      const mealsCtx = recentMeals && recentMeals.length > 0 ? `Recent Meals: ${recentMeals.join(', ')}.` : "No recent meals recorded.";
      const budgetValue = budget || "100000";
      const currencyValue = currency || "IDR";
      const maxDistanceValue = maxDistance || 3;
      const budgetCtx = `Max Budget Limit: ${budgetValue} ${currencyValue}. Suggested meals/dishes MUST fit within this price!`;
      const distanceCtx = `Max Distance Limit: ${maxDistanceValue} km. All suggested venues must be within ${maxDistanceValue} km of the user's current location!`;

      const biomarkersList = outOfRangeBiomarkers && outOfRangeBiomarkers.length > 0
        ? outOfRangeBiomarkers.map((b: any) => `• ${b.name} is ${String(b.status).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`).join("\n")
        : "• None";

      defaultSystemInstruction = `You are a world-class nutrition advisor and meal planning companion. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.`;

      defaultVariableData = `You are a personalized Nutrition Advisor.
${userCtx}
${locCtx}
${addressCtx}
${mealsCtx}
${budgetCtx}
${distanceCtx}
${nearbyCtx}

CRITICAL PATIENT BIOMARKER WARNINGS:
${biomarkersList}

Current User Input: "{User Input Chat Message}"

CRITICAL SYSTEM REQUIREMENTS FOR VERACITY & LOGICAL ACCURACY:
1. VENUE SELECTION FROM PROVIDED LIST: You MUST ONLY select restaurants from the provided list of nearby REAL restaurants if it is provided. Do NOT invent or search for other restaurants. Use EXACTLY the lat and lng coordinates from the list. Do not modify the coordinates.
2. STRICT GEOGRAPHIC RADIUS ENFORCEMENT: If you must suggest a venue not on the list, it MUST be located within exactly ${maxDistanceValue} km of the user's location. Do not hallucinate coordinates.
3. VENUE SELECTION CONTEXT: Use the provided list of nearby restaurants to verify details if available. Do not invent or search for random new restaurants far away.
4. MAPS LINK PRECISION & ERROR HANDLING RULE: When you have a restaurant, call the \`get_google_maps_place_id\` tool EXACTLY ONCE per restaurant using the restaurant name and coordinates.
   - If the tool returns a valid place_id, construct the "locationLink" URL exactly like this: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}&query_place_id={PLACE_ID}\`.
   - If the tool returns "NOT_FOUND", "ERROR_API_FAILED", or includes a "STOP TOOL USE" instruction, DO NOT call the tool again under any circumstances. Immediately construct the "locationLink" URL using the street address/name: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}+{URL_ENCODED_STREET_NAME}\` or coordinate-based query if street name is unavailable. Do NOT retry or call the tool for other items if you hit a failure.
5. STRICT OPENING HOURS ENFORCEMENT: The user's current local time is ${userLocalTime}. You MUST capture the exact opening and closing time and add it to the result for the recommended place in the 'openingHours' field if known, or standard hours. Never use '--' unless you genuinely cannot find it. You should only recommend places that are STILL OPEN 1 HOUR from the current local time!
6. REFERENCE LINK: For the 'menuLink' field, you MUST provide a direct, high-quality, real web link to the restaurant's actual official website, Instagram/Facebook page, TripAdvisor page, Yelp page, or specific Google Maps business page. DO NOT use generic Google Search query pages (like 'google.com/search?q=...') or generic placeholders, as this is unacceptable.
7. ZERO-FIND FALLBACK & STRICT RADIUS: If no verified physical restaurants are found within the exact ${maxDistanceValue} km radius of the user's coordinates, YOU MUST NOT SUGGEST ANY PLACES. In this case, you MUST only suggest generic healthy dishes to cook at home (do not include placeName, address, lat, lng, locationLink, menuLink, or distanceKm). Clearly explain in your text response that no verified venues were found within ${maxDistanceValue} km, and suggest increasing the search radius. NEVER hallucinate places far away or fake coordinates.

Include a short conversational response (text), and a list of between 3 and 5 distinct, diverse structured food ideas (ideas) that meet the constraints. Under no circumstances should you return only 1 idea.
Each idea should have:
- name: string (A general, common healthy food category they serve, e.g. "Grilled Chicken Salad" or "Sushi". DO NOT hallucinate exact menu items unless verified.)
- placeName: string (Optional. The verified, real-world restaurant name. Omit if suggesting a home-cooked meal.)
- address: string (Optional. The verified, exact physical street address.)
- lat: number (Optional. The latitude of the suggested place. Omit if no place is found within the radius.)
- lng: number (Optional. The longitude of the suggested place. Omit if no place is found within the radius.)
- locationLink: string (Optional. Google Maps Search URL)
- menuLink: string (Optional. A URL to ANY relevant webpage about the restaurant, such as Google Maps, Yelp, Instagram, or their website. DO NOT use recipe search links!)
- distanceKm: number (Optional. The straight-line physical distance in km. This MUST be strictly <= ${maxDistanceValue} km! Omit if home-cooked.)
- estimatedBudget: string (The estimated price of this suggested dish, formatted nicely with the currency symbol, e.g., "Rp 45,000" or "£3.50". This MUST be within the maximum budget of ${budgetValue} ${currencyValue}!)
- dishImageUrl: string (A valid, beautiful, and relevant Unsplash food image URL showing this specific type of dish, e.g., "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80" for a salad, or a suitable search query image URL from Unsplash.)
- benefitExplanation: string (Why this is good for the user's profile)
- tags: array of strings (e.g. ["High Protein", "Low Carb"])
- openingHours: string (The opening hours of the restaurant. E.g., "10:00 AM - 10:00 PM". Search for it actively!)

Respond with a structured JSON format matching this schema exactly:
{
  "text": "Your conversational response here",
  "ideas": [
    {
      "name": "Food Name",
      "placeName": "Restaurant or Place Name",
      "address": "123 Main St, City, State",
      "lat": -6.2088,
      "lng": 106.8456,
      "locationLink": "https://www.google.com/maps/search/?api=1&query=HokBen&query_place_id=ChIJKZ1Uh-P1aS4R61b3Rsx8mSU",
      "menuLink": "https://www.hokben.co.id/",
      "distanceKm": 1.2,
      "estimatedBudget": "Rp 45,000",
      "dishImageUrl": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80",
      "benefitExplanation": "Why this is good...",
      "tags": ["tag1", "tag2"],
      "openingHours": "10:00 AM - 10:00 PM"
    }
  ]
}`;
    } else if (key === 'data_review') {
      title = "Clinical Data Review & Calibration Agent";
      subtitle = "Calibrates demographics-adjusted reference ranges, physiological roles, and models user risk.";
      icon = BrainCircuit;
      defaultSystemInstruction = `You are an expert Clinical Data Review & Reference Range Calibration Agent.
You will receive user demographics and a list of biomarkers in the user's current batch.
=== DEMOGRAPHIC CALIBRATION MANDATE ===
You MUST customize the reference ranges and risk context precisely for the user's specific age, gender, and ethnicity found in the USER PROFILE.
CRITICAL OVERRIDE: Unless the biomarker is a clinical severity score, in which case the CLINICAL SYMPTOM & DISEASE SEVERITY INDEX EVALUATION MANDATE strictly overrides all demographic adjustments.
CRITICAL: Never output boilerplate text stating that demographic details are not available. They are always provided. Even if any values are missing, dynamically assume a standard reference profile (e.g., 35-year-old female of Caucasian ethnicity) and calibrate all reference ranges for that profile.
CLINICAL STAGING MANDATE: Apply actual concrete thresholds from established clinical guidelines (e.g., KDIGO for eGFR, ADA for HbA1c). For example: eGFR Optimal >= 90, Sub-Optimal 60-89, At Risk < 60; HbA1c Optimal < 5.7%, Sub-Optimal 5.7-6.4%, At Risk >= 6.5%.
=== CLINICAL SYMPTOM & DISEASE SEVERITY INDEX EVALUATION MANDATE ===
For any clinical symptom score or disease severity index biomarker (e.g. unit is 'score' or 'points', or key ends in '_symptom_score' or '_score' or '_index'):
CRITICAL EXCEPTION: Behavioral screening tools (such as 'audit_total_score', 'audit_c_total_score', 'audit_binge_drinking_score', and all other alcohol/AUDIT metrics) DO NOT follow this mandate. For behavioral screens, you MUST use their established clinical scoring thresholds:
- audit_total_score: Optimal is <= 7
- audit_c_total_score: Optimal is <= 3
- audit_binge_drinking_score: Optimal is <= 1
Do NOT force a zero-baseline on them. If the user's score falls in the Optimal range, you MUST set 'status' to 'Optimal'.

For true symptom/disease severity indices ONLY:
1. Recognise that disease/symptom severity scores have a globally uniform baseline of 0 (Remission / Healthy / Asymptomatic) across all global demographics.
2. In '_demographicAudit', note that the baseline remains 0 globally.
3. Set 'profileAdjustedNormalRange' to '0'.
4. In 'rangeBrackets', YOU MUST USE EXACTLY THESE FOUR STANDARDIZED CLINICAL INDEX SEVERITY BRACKETS (DO NOT USE OTHER NAMES): [ { "name": "Remission / Healthy", "range": "0" }, { "name": "Mild Flare-up", "range": "1" }, { "name": "Moderate Flare-up", "range": "2" }, { "name": "Severe Progression", "range": ">= 3" } ]
5. Set status to 'At Risk' if >= 3, 'Sub-Optimal (Action Zone)' if 1 or 2, otherwise 'Optimal'.
=== TASK: PERSONALISED HEALTH RISK ESTIMATION ===
For each biomarker, follow a strict logical funnel to determine the correct ranges and status:
"_demographicAudit": A mandatory internal reasoning object where you actively contrast standard global guidelines with any relevant regional/ethnic thresholds.
"profileAdjustedNormalRange": The final calibrated range based on your audit.
"reference": State the specific clinical reference or guideline (e.g., "KDIGO 2012", "ADA 2023", "Asian-modified CKD-EPI") you are using to write the range, based on the user's ethnicity, gender, and age.
"rangeBrackets": List each range bracket with its naming and value ranges, adjusted to match your demographic audit. CRITICAL: The brackets MUST be continuous (no numerical gaps or missing values between brackets) and must fully map out the bounds of the profileAdjustedNormalRange. Include bounds for each bracket.
"description": A clear 2-sentence description of the physiological role.
"_statusReasoning": A 1-sentence strict mathematical comparison of the userValue against the profileAdjustedNormalRange.
"status": Assign 'Optimal', 'Sub-Optimal (Action Zone)', or 'At Risk'.
=== CLINICAL TRAJECTORY BINDING RULE ===
Do not apply artificial clinical leniency to expand reference ranges. Instead, map the user's value strictly to the three-tiered status system. If userValue is strictly optimal, output 'Optimal'. If it falls in a preventative window or borderline zone, output 'Sub-Optimal (Action Zone)'. If outside the borderline zone, output 'At Risk'.
"specificRiskContext": If 'At Risk' or 'Sub-Optimal (Action Zone)', explain why this value matters for this demographic or provide reassurance if only mildly out of range. If 'Optimal', describe why this signifies optimal homeostasis.
=== CRITICAL REQUIREMENTS ===
You MUST include an analysis for EVERY biomarker in the input list.
Ensure output is STRICTLY valid YAML matching the exact abstract structure and placeholder instructions below. Do not wrap the output in markdown code blocks if unsupported by the pipeline.

message: <string: Conversational summary of clinical range adjustments and review findings for this batch.>
reviewedBiomarkers:
  - key: <string: Exact key from the input data>
    name: <string: Standard clinical name of the biomarker>
    userValue: <number: Exact value from the input data>
    unit: <string: Exact unit from the input data>
    _demographicAudit:
      standardWesternBaseline: <string: The textbook global/Western range>
      knownEthnicOrRegionalVariances: <string: State any known regional variant and the society it comes from. If none exist, state 'None'>
      ageAndGenderShifts: <string: How age and gender naturally alter the baseline>
      finalAppliedAdjustments: <string: The synthesis of how you are modifying the bounds for this specific user>
    profileAdjustedNormalRange: <string: The final range, appending the demographic reason in parentheses if altered from global baseline>
    reference: <string: The specific clinical reference or guideline used for the range, adjusted for ethnicity, gender, and age>
    rangeBrackets:
      - name: <string: Bracket name (e.g., Optimal, Sub-Optimal, Elevated, Mildly Decreased)>
        range: <string: Mathematical bounds (e.g., >= 90, 60-89). Must be continuous with no gaps.>
    description: <string: 2-sentence physiological role>
    _statusReasoning: <string: 1-sentence mathematical evaluation comparing userValue to profileAdjustedNormalRange bounds>
    status: <string: Strictly 'Optimal', 'Sub-Optimal (Action Zone)', or 'At Risk' based on _statusReasoning>
    specificRiskContext: <string: 3-4 sentence personalized clinical context based on the final status>`;
      
      defaultVariableData = `USER PROFILE:
${JSON.stringify({
  age: profile?.age || 'Not provided',
  gender: profile?.gender || 'Not provided',
  ethnicity: profile?.ethnicity || 'Not provided',
  bloodType: profile?.bloodType || 'Not provided',
  weight: profile?.weight || 'Not provided',
  height: profile?.height || 'Not provided'
}, null, 2)}`;
    } else if (key === 'biomarker_review') {
      title = "Clinical Biomarker Assistant (Review Dialogue Agent)";
      subtitle = "Discusses biological context, analyzes ranges, and calibrates values/units with high mathematical precision.";
      icon = BrainCircuit;
      defaultSystemInstruction = `You are an expert AI medical and nutritional assistant. The user is reviewing a specific health biomarker from their records.
Your tasks:
1. Explain the physiological role and clinical importance of the biomarker in detail.
2. Carefully analyze the standard reference range versus the user's age, gender, and ethnicity.
3. Formulate precise proposals to update, convert, or correct the logged value and reference range, strictly respecting unit scales (e.g., preventing mmol/L vs. mg/dL conversions and unit mix-ups).`;
      defaultVariableData = defaultVarData;
    } else if (key === 'standardize') {
      title = "Clinical Unit Standardization Agent";
      subtitle = "Determines appropriate units of measurement for selected biomarkers in SI or US customary formats.";
      icon = BrainCircuit;
      defaultSystemInstruction = `You are an automated Clinical Unit Standardization Agent. Your task is to standardize units of measurement for selected biomarkers.

=== OBJECTIVE ===
For each provided biomarker, determine the appropriate unit of measurement for the requested target metric system (e.g. SI or US).
- SI (Metric System): Use mmol/L, g/L, pmol/L, mmol/24h, g/dL, U/L, etc.
- US (Customary System): Use mg/dL, g/dL, pg/mL, mg/24h, U/L, etc.

For each biomarker, return:
1. The appropriate unit for the chosen system.
2. The conversion factor to convert from the current unit to the standardized unit (1 if no conversion needed).
3. Your confidence in the conversion (high, medium, low).
4. Any relevant notes.

=== SYSTEM CONSTRAINTS ===
You MUST work in JSON. Return a single JSON object with a "mappedBiomarkers" array. Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw JSON text.
Do NOT change the values or ranges, and do NOT provide explanations. Your ONLY role is to standardize the unit.

JSON Schema:
{
  "mappedBiomarkers": [
    {
      "originalKey": "biomarker_key",
      "standardizedUnit": "standardized_unit",
      "conversionFactor": 1,
      "confidence": "high",
      "notes": "..."
    }
  ]
}`;
      defaultVariableData = `TARGET METRIC SYSTEM: SI
BIOMARKERS TO PROCESS:
[
  {
    "key": "cholesterol",
    "name": "Cholesterol",
    "unit": "mg/dL"
  }
]`;
    } else if (key === 'medical_categorise') {
      title = "Clinical Categorisation Agent";
      subtitle = "Maps medical biomarkers to standard clinical groupings and multi-tag risk categories.";
      icon = ShieldAlert;
      defaultSystemInstruction = `You are an automated Clinical Categorisation Agent. Your task is to accurately map medical biomarkers to their appropriate physiological groupings and risk categories.

=== OBJECTIVE ===
For each provided biomarker, determine:
1. Standard Medical Grouping. Allowed values ONLY: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other'
2. Risk Categories. A JSON array of string tags representing associated risks. YOU MUST ONLY CHOOSE FROM THESE 8 EXACT CANONICAL CATEGORIES: "Cardiovascular", "Metabolic", "Liver", "Kidney", "Hematology", "Immunological", "Endocrine", "Screenings & Wellness". Do NOT invent new ones.
3. Potential Medical Conditions. A JSON array of string tags (e.g. ["Fatty Liver", "Obesity"]) representing associated conditions.

=== SYSTEM CONSTRAINTS ===
You MUST work in JSON. Return a single JSON object with a "categorisedBiomarkers" array. Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw JSON text.

JSON Schema:
{
  "categorisedBiomarkers": [
    {
      "originalKey": "biomarker_key",
      "standardMedicalGrouping": "One of the allowed values",
      "riskCategories": ["Tag1", "Tag2"],
      "potentialMedicalConditions": ["Condition1", "Condition2"]
    }
  ]
}`;
      defaultVariableData = `BIOMARKERS TO PROCESS:
[
  {
    "key": "alanine_aminotransferase",
    "name": "Alanine Aminotransferase (ALT)"
  }
]`;
    } else if (key === 'calibrate_ranges' || key === 'calibrate') {
      title = "Clinical Reference Range Calibration Agent";
      subtitle = "Calibrates evidence-based clinical population reference intervals, standardized units, optimal brackets, and medical practice categories.";
      icon = Activity;
      defaultSystemInstruction = `You are an automated Clinical Reference Range Calibration Agent operating at the Biomarker Reference Dictionary level.
Your mission is to calibrate standard, evidence-based clinical population reference intervals, standardized units, optimal brackets, medical practice groupings, and risk classifications for medical laboratory biomarkers, biometric readings, clinical questionnaires, and symptom scores.

=== OBJECTIVE ===
For each provided biomarker, determine:
1. Standardized Unit: Accurate clinical unit according to preferred metric system. For questionnaires/scores use "score" or "points". For qualitative tests use "qualitative".
2. Normal Reference Range (Population Baseline):
   - minRange: Lower bound of normal (numeric float/integer, or null if single-sided upper bound, e.g. < 5.0 or qualitative).
   - maxRange: Upper bound of normal (numeric float/integer, or null if single-sided lower bound, e.g. > 1.0 or qualitative).
   - normalRange: Exact human-readable normal interval string (e.g., "10 - 40", "< 5.0", "> 1.0", "Negative", "0 - 7", "135 - 145").
3. Optimal / Functional Range:
   - optimalMin: Numeric lower optimal threshold (or null).
   - optimalMax: Numeric upper optimal threshold (or null).
   - optimalRange: Human-readable optimal interval string (e.g., "15 - 30", "< 2.5", "0 - 4", or null if identical to normal range).
4. Clinical Classification:
   - standardMedicalGrouping: Clinical practice area ('Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Cardiology', 'Endocrinology', 'Immunology', 'Neurology & Cognitive', 'Behavioral & Mental Health', 'Toxicology & Addiction', 'Screenings & Assessments', 'Gastroenterology', 'Musculoskeletal', 'Pulmonology', 'Wellness & Lifestyle', 'Other').
   - riskCategories: Array of clinical risk category tags.
   - potentialMedicalConditions: Array of associated conditions / clinical indications.
5. Clinical Reasoning:
   - notes: Clear, concise clinical reasoning citing standard reference authorities.
   - confidence: "high", "medium", or "low".

=== SYSTEM CONSTRAINTS ===
Return a single flat JSON array of objects inside the "calibratedBiomarkers" key.
Output ONLY the raw JSON text.`;
      defaultVariableData = `BIOMARKERS TO PROCESS:
[
  {
    "key": "alkaline_phosphatase",
    "name": "Alkaline Phosphatase",
    "currentUnit": "U/L",
    "currentRange": ""
  }
]`;
    } else if (key === 'data_accuracy') {
      title = "Data Accuracy Agent";
      subtitle = "Clinical data cleaning, quality check, validation, and interactive difference resolution specialist.";
      icon = BrainCircuit;
      defaultSystemInstruction = `You are the Data Accuracy Agent, a clinical data cleaning, quality check, and validation AI specialist. Your role is to get a list of biomarkers shared by the user (via text or uploaded file/images), match them against the user's existing biomarker dictionary and history, compare the critical fields, and return a precise difference analysis.

=== KEY TASKS ===
1. Extract biomarkers from the user's input. The input can contain:
   - Text written by the user.
   - Images of lab report sheets, documents, photos, or other reports.
   For each extracted biomarker, identify:
   - Name (e.g. Hemoglobin A1c, Cholesterol)
   - Unit (e.g. %, mg/dL, mmol/L)
   - Value (e.g. 5.8)
   - Date (e.g. 2026-07-01, or fallback to the current local time if unspecified)
   - Comments/Notes (any clinical remarks, doctor comments, or brief interpretations associated with it)

2. Match the extracted biomarkers against the user's existing database (Current State provided below).
   Find the most appropriate matching key (e.g., "hba1c"). If no exact match exists in the current custom or built-in keys, propose a standard snake_case key based on medical conventions.

3. Compare the following 5 fields between the user's current data (from their dictionary and latest historical logs) and the shared data:
   - Biomarker Name (dictionary def name)
   - Unit (dictionary def unit)
   - Value (latest log value for that key)
   - Date (latest log date for that key)
   - Comments (latest log note or specific test doctor comment, or general remarks)

4. Determine if each field is "same" or "different":
   - Use comparison logic. If one is missing or empty on one side and present on the other, it is "different".
   - Set status to "same" if the content matches closely (case-insensitive, trimmed, numeric values with different decimal places like 5 and 5.0 are considered "same").
   - Set status to "different" if there is any difference.

=== RESPONSE FORMAT ===
You MUST return a JSON object with this exact structure. Do NOT wrap it in markdown blocks. Return ONLY the raw valid JSON.

JSON Schema:
{
  "explanation": "A friendly scannable summary of the differences found.",
  "comparisonResults": [
    {
      "key": "biomarker_key",
      "matched": true,
      "name": { "current": "current_name", "shared": "shared_name", "status": "same|different" },
      "unit": { "current": "current_unit", "shared": "shared_unit", "status": "same|different" },
      "value": { "current": "current_value", "shared": "shared_value", "status": "same|different" },
      "date": { "current": "current_date", "shared": "shared_date", "status": "same|different" },
      "comments": { "current": "current_comments", "shared": "shared_comments", "status": "same|different" }
    }
  ]
}`;
      defaultVariableData = `INPUT TEXT: Hemoglobin A1c 5.8%
CURRENT STATE:
{
  "customBiomarkers": {},
  "latestHistoryValues": {
    "hba1c": {
      "value": 5.6,
      "date": "2026-06-15",
      "note": "Slightly elevated"
    }
  }
}`;
    } else if (key === 'consolidate_names') {
      title = "Name Consolidation Agent";
      subtitle = "Identifies clinical biomarkers with similar or variant names and recommends consolidated medical keys.";
      icon = BrainCircuit;
      defaultSystemInstruction = `You are an automated Name Consolidation Agent. Your task is to identify clinical biomarkers with similar, synonymous, or variant names from a selected list and group them together to make consolidation easy.

=== OBJECTIVE ===
Analyze the selected list of biomarkers and group them by clinical equivalence (e.g. "Serum Albumin", "Albumin, Serum", "Albumin g/L" are all the same clinical biomarker and should be grouped together).
For each matched group, determine:
1. A standard recommended clinical name (e.g. "Serum Albumin").
2. A recommended unique key using snake_case (e.g. "serum_albumin").
3. A list of all matching source biomarkers that belong to this group.

=== SYSTEM CONSTRAINTS ===
- You MUST work in JSON. Return a single JSON object with a "consolidatedGroups" array. Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw JSON text.
- Do NOT delete any data. Your sole purpose is to identify similar biomarkers and group them.
- DO NOT perform, input, or output any form of medical categorization, standard medical grouping, or physiological classification. This is entirely handled programmatically by the website, and you must not attempt to modify or determine medical groupings.

    JSON Schema:
    {
      "consolidatedGroups": [
        {
          "Name": "Recommended Clinical Name (e.g. Serum Albumin)",
          "variants": ["original_biomarker_key_1", "original_biomarker_key_2"],
          "rationale": "Why these are the same clinical biomarker"
        }
      ]
    }`;
      defaultVariableData = `BIOMARKERS TO PROCESS:
[
  {
    "key": "serum_albumin_2",
    "name": "Serum Albumin",
    "unit": "g/L"
  },
  {
    "key": "serum_albumin_g_l",
    "name": "Serum Albumin g/L",
    "unit": "g/L"
  }
]`;
    } else {
      title = "AI Agent System Instructions";
      subtitle = "System prompts and constraints executing for this module";
      icon = Terminal;
      defaultSystemInstruction = `No instructions found for agent type: ${key}`;
      defaultVariableData = '';
    }

    return { title, subtitle, icon, defaultSystemInstruction, defaultVariableData };
  };

  const parts = getInstructionParts(resolvedKey);
  const IconComponent = parts.icon;

  // Initialize from localStorage or defaults on open/mount
  useEffect(() => {
    if (isOpen) {
      const customSys = readAliasedInstruction('custom_system_instruction_', resolvedKey);
      const customVar = readAliasedInstruction('custom_variable_data_', resolvedKey);
      
      setVariableDataText(customVar !== null ? customVar : parts.defaultVariableData);
      setIsEditing(false);
      setSaveSuccess(false);

      if (resolvedKey === 'food') {
        if (customSys !== null) {
          setSysInstruction(customSys);
        } else {
          setLoadingInstruction(true);
          const queryParams = new URLSearchParams({
            agentType: 'food',
            biomarkersNeedingImprovement: JSON.stringify(outOfRangeBiomarkers ? outOfRangeBiomarkers.map((b: any) => b.name) : []),
            remainingAllowance: JSON.stringify(remainingAllowance || null),
            activeMeal: JSON.stringify(activeMeal || null)
          });

          const fetchInstruction = async () => {
            try {
              const headers: any = {};
              const idToken = await auth.currentUser?.getIdToken();
              if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
              }
              const res = await fetch(`/api/gemini/instruction-preview?${queryParams.toString()}`, {
                headers
              });
              if (res.ok) {
                const data = await res.json();
                if (data.instruction) {
                  setSysInstruction(data.instruction);
                }
              } else {
                setSysInstruction(parts.defaultSystemInstruction);
              }
            } catch (err) {
              console.error("Failed to fetch instruction preview:", err);
              setSysInstruction(parts.defaultSystemInstruction);
            } finally {
              setLoadingInstruction(false);
            }
          };
          fetchInstruction();
        }
      } else {
        setSysInstruction(customSys !== null ? customSys : parts.defaultSystemInstruction);
      }
    }
  }, [isOpen, resolvedKey, agentPrompt, outOfRangeBiomarkers, remainingAllowance, activeMeal, activeTab]);

  if (!isOpen) return null;

  const insertVariable = (variableKey: string) => {
    const ref = focusedTextarea === 'system' ? systemTextareaRef : variableTextareaRef;
    if (!ref.current) {
      const target = focusedTextarea || 'system';
      if (target === 'system') {
        setSysInstruction(prev => prev + ' ' + variableKey);
      } else {
        setVariableDataText(prev => prev + ' ' + variableKey);
      }
      return;
    }
    const txt = ref.current;
    const start = txt.selectionStart;
    const end = txt.selectionEnd;
    const text = focusedTextarea === 'system' ? sysInstruction : variableDataText;

    const replaceStart = suggestionsTriggerIndex !== -1 ? suggestionsTriggerIndex : start;
    const before = text.substring(0, replaceStart);
    const after = text.substring(end);
    const newText = before + variableKey + after;

    if (focusedTextarea === 'system') {
      setSysInstruction(newText);
    } else {
      setVariableDataText(newText);
    }

    setShowSuggestions(false);

    setTimeout(() => {
      txt.focus();
      const newCursorPos = replaceStart + variableKey.length;
      txt.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>, type: 'system' | 'variable') => {
    const value = e.target.value;
    if (type === 'system') {
      setSysInstruction(value);
    } else {
      setVariableDataText(value);
    }

    const cursor = e.target.selectionStart;
    const lastOpenBrace = value.lastIndexOf('[', cursor - 1);
    const lastCloseBrace = value.lastIndexOf(']', cursor - 1);

    if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
      const query = value.substring(lastOpenBrace + 1, cursor);
      if (!query.includes(' ') && !query.includes('\n')) {
        setShowSuggestions(true);
        setSuggestionQuery(query);
        setSuggestionsTriggerIndex(lastOpenBrace);
        setFocusedTextarea(type);
        setSuggestionIndex(0);
        return;
      }
    }
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, type: 'system' | 'variable') => {
    setFocusedTextarea(type);
    if (!showSuggestions) return;

    const filtered = AVAILABLE_VARIABLES.filter(v => 
      v.key.toLowerCase().includes(suggestionQuery.toLowerCase()) || 
      v.label.toLowerCase().includes(suggestionQuery.toLowerCase())
    );

    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertVariable(filtered[suggestionIndex].key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

  const handleSave = () => {
    localStorage.setItem(`custom_system_instruction_${resolvedKey}`, sysInstruction);
    localStorage.setItem(`custom_variable_data_${resolvedKey}`, variableDataText);
    setSaveSuccess(true);
    setIsEditing(false);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleReset = () => {
    setShowResetConfirm(true);
  };
  
  const confirmReset = () => {
    localStorage.removeItem(`custom_system_instruction_${resolvedKey}`);
    localStorage.removeItem(`custom_variable_data_${resolvedKey}`);
    setSysInstruction(parts.defaultSystemInstruction);
    setVariableDataText(parts.defaultVariableData);
    setIsEditing(false);
    setShowResetConfirm(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleCopy = async () => {
    try {
      const combinedPrompt = `SYSTEM INSTRUCTION:\n${sysInstruction}\n\nVARIABLE DATA / CONTEXT:\n${variableDataText}`;
      await navigator.clipboard.writeText(combinedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy instructions:', err);
    }
  };

  return createPortal(
    <div id="full-screen-instruction-viewer" className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col animate-fade-in w-full h-full text-slate-200 font-sans">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between bg-slate-950 font-sans">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
            <IconComponent className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
                {parts.title}
              </h2>
              {localStorage.getItem(`custom_system_instruction_${resolvedKey}`) !== null && (
                <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 text-[9px] font-bold rounded uppercase tracking-wider font-mono border border-amber-500/20">
                  Customized
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {parts.subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-slate-700/60"
            >
              <Edit2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Edit Prompt</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Apply & Save</span>
              </button>
              {showResetConfirm ? (
                <div className="flex items-center gap-1.5 mr-1">
                  <span className="text-[10px] text-rose-400 font-medium whitespace-nowrap">Reset to defaults?</span>
                  <button
                    onClick={confirmReset}
                    className="p-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-medium text-[10px] transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium text-[10px] transition-colors border border-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleReset}
                  className="p-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 rounded-xl transition-all cursor-pointer border border-slate-700/50"
                  title="Reset to defaults"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => {
                  const customSys = localStorage.getItem(`custom_system_instruction_${resolvedKey}`);
                  const customVar = localStorage.getItem(`custom_variable_data_${resolvedKey}`);
                  setSysInstruction(customSys !== null ? customSys : parts.defaultSystemInstruction);
                  setVariableDataText(customVar !== null ? customVar : parts.defaultVariableData);
                  setIsEditing(false);
                }}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-700/60"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors cursor-pointer ml-1"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Switcher Tabs for Food Agents Prompt debugging */}
      {(agentType === 'food' || agentType === 'food_scout') && (
        <div className="px-6 py-2 bg-slate-900 border-b border-slate-800/60 flex items-center gap-2 font-sans">
          <div className="px-3 py-1 text-xs font-semibold text-indigo-400 bg-indigo-950/50 rounded-lg border border-indigo-800/40">
            Unified Diet (Scout)
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-slate-950 px-6 py-6">
        <div className="max-w-7xl mx-auto h-full flex flex-col">
          {saveSuccess && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-bold font-mono animate-pulse flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>Prompt instructions updated successfully in the application. Future queries will run this version.</span>
            </div>
          )}

          {isEditing ? (
            <div className="flex flex-col lg:flex-row gap-6 flex-1 items-stretch min-h-[700px]">
              {/* Left Column: Editor Areas */}
              <div className="flex-1 flex flex-col gap-6">
                {/* Top Column: System Instructions */}
                <div className="flex flex-col relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-bold text-indigo-400 tracking-wider font-mono flex items-center gap-1.5">
                      <Code className="w-4 h-4" />
                      System Instruction / Core Role Prompt
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {loadingInstruction ? "Loading..." : `${sysInstruction.length} chars`}
                    </span>
                  </div>
                  <textarea
                    ref={systemTextareaRef}
                    value={loadingInstruction ? "Loading real-time instructions from Diet..." : sysInstruction}
                    disabled={loadingInstruction}
                    onChange={(e) => handleTextareaInput(e, 'system')}
                    onKeyDown={(e) => handleKeyDown(e, 'system')}
                    onFocus={() => setFocusedTextarea('system')}
                    className={`w-full bg-slate-900/60 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl p-4 font-mono text-sm text-slate-200 outline-none transition-all resize-none leading-relaxed h-[320px] focus:ring-1 focus:ring-indigo-500 ${loadingInstruction ? 'opacity-60 cursor-not-allowed select-none' : ''}`}
                    placeholder="Enter system instructions. Type '{' to search and insert steerable variables..."
                  />

                  {/* Inline Autocomplete Suggestions for System Textarea */}
                  {showSuggestions && focusedTextarea === 'system' && (
                    <div className="absolute left-4 right-4 bottom-4 top-12 z-50 bg-slate-900 border border-indigo-500/50 shadow-xl shadow-indigo-950/40 rounded-xl flex flex-col overflow-hidden max-h-[220px]">
                      <div className="px-3 py-1.5 bg-indigo-950/60 border-b border-indigo-900/40 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider font-mono flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
                          Variables Suggestion list (Use ↓/↑ to choose, Enter to select)
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono">query: "{suggestionQuery}"</span>
                      </div>
                      <div className="overflow-y-auto flex-1 divide-y divide-slate-800/60">
                        {(() => {
                          const filtered = AVAILABLE_VARIABLES.filter(v => 
                            v.key.toLowerCase().includes(suggestionQuery.toLowerCase()) || 
                            v.label.toLowerCase().includes(suggestionQuery.toLowerCase())
                          );
                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-slate-500 italic">No variables matching "{suggestionQuery}"</div>;
                          }
                          return filtered.map((v, idx) => (
                            <button
                              key={v.key}
                              onClick={() => insertVariable(v.key)}
                              className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors ${idx === suggestionIndex ? 'bg-indigo-600/20 text-white' : 'hover:bg-slate-800/40 text-slate-300'}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-bold text-indigo-300">{v.key}</span>
                                <span className="text-[10px] font-medium text-slate-400">{v.label}</span>
                              </div>
                              <p className="text-[11px] text-slate-400 font-sans leading-normal">{v.desc}</p>
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Column: Variable Data Inputs */}
                <div className="flex flex-col relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-bold text-indigo-400 tracking-wider font-mono flex items-center gap-1.5">
                      <Terminal className="w-4 h-4" />
                      Variable Context / Inputted Data
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {variableDataText.length} chars
                    </span>
                  </div>
                  <textarea
                    ref={variableTextareaRef}
                    value={variableDataText}
                    onChange={(e) => handleTextareaInput(e, 'variable')}
                    onKeyDown={(e) => handleKeyDown(e, 'variable')}
                    onFocus={() => setFocusedTextarea('variable')}
                    className="w-full bg-slate-900/60 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl p-4 font-mono text-sm text-slate-200 outline-none transition-all resize-none leading-relaxed h-[320px] focus:ring-1 focus:ring-indigo-500"
                    placeholder="Enter custom variable data or parameters. Type '{' to search and insert variables..."
                  />

                  {/* Inline Autocomplete Suggestions for Variable Textarea */}
                  {showSuggestions && focusedTextarea === 'variable' && (
                    <div className="absolute left-4 right-4 bottom-4 top-12 z-50 bg-slate-900 border border-indigo-500/50 shadow-xl shadow-indigo-950/40 rounded-xl flex flex-col overflow-hidden max-h-[220px]">
                      <div className="px-3 py-1.5 bg-indigo-950/60 border-b border-indigo-900/40 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider font-mono flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
                          Variables Suggestion list (Use ↓/↑ to choose, Enter to select)
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono">query: "{suggestionQuery}"</span>
                      </div>
                      <div className="overflow-y-auto flex-1 divide-y divide-slate-800/60">
                        {(() => {
                          const filtered = AVAILABLE_VARIABLES.filter(v => 
                            v.key.toLowerCase().includes(suggestionQuery.toLowerCase()) || 
                            v.label.toLowerCase().includes(suggestionQuery.toLowerCase())
                          );
                          if (filtered.length === 0) {
                            return <div className="p-3 text-xs text-slate-500 italic">No variables matching "{suggestionQuery}"</div>;
                          }
                          return filtered.map((v, idx) => (
                            <button
                              key={v.key}
                              onClick={() => insertVariable(v.key)}
                              className={`w-full text-left px-4 py-2.5 flex flex-col gap-0.5 transition-colors ${idx === suggestionIndex ? 'bg-indigo-600/20 text-white' : 'hover:bg-slate-800/40 text-slate-300'}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-bold text-indigo-300">{v.key}</span>
                                <span className="text-[10px] font-medium text-slate-400">{v.label}</span>
                              </div>
                              <p className="text-[11px] text-slate-400 font-sans leading-normal">{v.desc}</p>
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Dynamic Variable Reference Sidebar */}
              <div className="w-full lg:w-[320px] bg-slate-900/40 border border-slate-800 rounded-xl flex flex-col p-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-100 font-mono">
                    Steerable Variables Sidebar
                  </h3>
                </div>
                <p className="text-[11px] text-slate-400 mb-4 leading-normal">
                  Click any biomarker or user variable below to insert it at your editor's current cursor position. Or, type <code className="text-indigo-400 font-bold bg-indigo-500/10 px-1 py-0.5 rounded font-mono">{"{"}</code> in the code text area.
                </p>

                {/* Search Bar */}
                <div className="relative mb-3.5">
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                    placeholder="Search clinical variables..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs text-slate-200 outline-none transition-all placeholder:text-slate-500 font-sans"
                  />
                </div>

                {/* Variable List */}
                <div className="flex-1 overflow-y-auto space-y-2 max-h-[500px] pr-1 scrollbar-thin">
                  {(() => {
                    const filtered = AVAILABLE_VARIABLES.filter(v => 
                      v.key.toLowerCase().includes(sidebarSearch.toLowerCase()) || 
                      v.label.toLowerCase().includes(sidebarSearch.toLowerCase()) || 
                      v.desc.toLowerCase().includes(sidebarSearch.toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return <div className="text-xs text-slate-500 italic p-2">No variables found.</div>;
                    }
                    return filtered.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(v.key)}
                        className="w-full text-left p-2.5 rounded-lg bg-slate-950/40 hover:bg-slate-950 border border-slate-800/50 hover:border-indigo-500/50 transition-all flex flex-col gap-1 cursor-pointer group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] font-bold text-indigo-400 group-hover:text-indigo-300 break-all">{v.key}</span>
                          <Plus className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 flex-shrink-0 ml-1" />
                        </div>
                        <div className="text-[10px] font-bold text-slate-300">{v.label}</div>
                        <p className="text-[10px] text-slate-500 leading-normal">{v.desc}</p>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Top View: System Instructions */}
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-5 flex flex-col">
                <span className="text-xs uppercase font-bold text-indigo-400 tracking-wider block mb-3 font-mono flex items-center gap-1.5">
                  System Instruction / Core Role Prompt
                  {loadingInstruction && <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin" />}
                </span>
                {loadingInstruction ? (
                  <div className="flex items-center gap-2 text-slate-400 font-mono text-xs py-4">
                    <Sparkles className="w-4 h-4 animate-spin text-indigo-400" />
                    Fetching latest dynamic instructions...
                  </div>
                ) : (
                  <pre className="text-slate-300 font-mono text-xs whitespace-pre-wrap leading-relaxed select-text">
                    {sysInstruction || "No System Instruction set."}
                  </pre>
                )}
              </div>

              {/* Bottom View: Variable Data Context */}
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-5 flex flex-col">
                <span className="text-xs uppercase font-bold text-indigo-400 tracking-wider block mb-3 font-mono">
                  Variable Context / Inputted Data
                </span>
                <pre className="text-slate-300 font-mono text-xs whitespace-pre-wrap leading-relaxed select-text">
                  {variableDataText || "No Context Variables available."}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-800/60 flex items-center justify-between bg-slate-950 font-sans">
        <span className="text-xs text-slate-500 font-mono">
          Model Directives (Clinical LLM Registry v1.3)
        </span>
        <div className="flex items-center gap-3">
          {localStorage.getItem(`custom_system_instruction_${resolvedKey}`) !== null && (
            showResetConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-rose-400 font-medium">Reset to defaults?</span>
                <button
                  onClick={confirmReset}
                  className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                <span>Reset to System Defaults</span>
              </button>
            )
          )}
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
                <span>Copy Full Prompt</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
