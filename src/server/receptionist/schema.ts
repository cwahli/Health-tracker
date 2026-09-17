/**
 * Receptionist & Onboarding Agent Schema
 * Defines structured memory, inputs, outputs, UI forms, disambiguation, and handoffs.
 */

export type ReceptionistIntent =
  | "weight_loss"
  | "muscle_gain"
  | "general_wellness"
  | "health_improvement"
  | "biomarker_review"
  | "add_health_data"
  | "profile_update"
  | "meal_logging"
  | "general_inquiry"
  | "unknown";

export type TargetAgent =
  | "health_coach"
  | "medical"
  | "biomarker_specialist"
  | "biomarker_review"
  | "coach"
  | "nutritionist"
  | "fitness_specialist"
  | "general_receptionist";

export type ReceptionistStatus = "needs_info" | "ready_for_handoff";

export interface UserProfileSnapshot {
  name?: string | null;
  age?: number | null;
  gender?: string | null;
  ethnicity?: string | null;
  bloodType?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activityLevel?: string | null;
  medicalHistory?: string[] | null;
  dietaryPreferences?: string[] | null;
  targetWeightKg?: number | null;
  language?: string | null;
}

export interface CategorizedInsights {
  biometrics?: string[];
  lifestyle?: string[];
  symptoms?: string[];
  clinicalNotes?: string[];
}

export interface UserMemory {
  goalSummary: string;
  userProfileSnapshot: UserProfileSnapshot;
  preferencesAndConstraints?: Record<string, unknown>;
  conversationState: "onboarding_gather_info" | "ready_for_handoff" | "ongoing_support";
  pendingItems: string[];
  keyInsights: string[];
  categorizedInsights?: CategorizedInsights;
  lastInteractionSummary?: string;
  workHistoryLog?: string[];
  lastUpdated?: string;
}

export interface ActivityOrTaskItem {
  id: string;
  category: "biomarkers" | "nutrition" | "fitness" | "sleep" | "general";
  title: string;
  status: "completed_on_track" | "pending" | "overdue" | "inconsistent";
  priority?: "low" | "medium" | "high";
  lastCompleted?: string | null;
  details?: string | null;
}

export interface UIFormField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "multiselect";
  options?: string[];
  unit?: string;
  placeholder?: string;
  required: boolean;
}

export interface UIForm {
  formId: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: UIFormField[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface ModificationCommand {
  action: "update_biomarker" | "remove_biomarker" | "update_profile";
  keyName: string;
  newValue?: string | number;
  oldValue?: string | number;
  date?: string;
  unit?: string;
  reason?: string;
}

export interface ReceptionistInputPayload {
  currentUserMessage: string;
  chatHistory: ChatMessage[];
  existingUserProfile?: UserProfileSnapshot | null;
  existingMemory?: UserMemory | null;
  existingActivitiesAndTasks?: ActivityOrTaskItem[] | null;
  language?: string | null;
  biomarkers?: Record<string, any> | null;
  foodLogs?: any[] | null;
  biomarkerHistory?: any[] | null;
  images?: string[] | null;
  systemCurrentDate?: string | null;
  userTimezone?: string | null;
  specialistContainers?: Record<string, any> | null;
}

export interface HandoffPayload {
  targetAgent: TargetAgent;
  intent: ReceptionistIntent;
  summaryForAgent: string;
  actionableInsights: string[];
  recommendedTasks?: ActivityOrTaskItem[];
  consolidatedUserProfile?: UserProfileSnapshot;
  consolidatedMemory?: UserMemory;
  rawLabReport?: string;
  images?: string[];
  compareDishes?: { dishA: string; dishB: string };
  literatureTopic?: string;
}

export interface ExtractedBiomarkerLog {
  biomarker: string;
  value: number;
  unit?: string;
  date?: string;
}

export interface ReceptionistOutput {
  intent: ReceptionistIntent;
  targetAgent: TargetAgent;
  status: ReceptionistStatus;
  missingFields: string[];
  collectedData: Record<string, unknown>;
  memory: UserMemory;
  userResponse: string;
  isDisambiguationRequired?: boolean;
  disambiguationContext?: string | null;
  uiForm?: UIForm | null;
  handoffPayload: HandoffPayload | null;
  newBiomarkerLogs?: ExtractedBiomarkerLog[] | null;
  updatedProfile?: Record<string, unknown> | null;
  modificationCommand?: ModificationCommand[] | null;
}
