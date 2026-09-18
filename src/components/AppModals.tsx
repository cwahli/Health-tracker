import React from 'react';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, FoodIdea, RecommendationReport } from '../types';
import LogChat from './LogChat';

export interface AppModalsProps {
  isChatOpen: boolean;
  chatType: 'food' | 'medical' | 'front_desk' | 'food_idea' | 'daily_recommendation';
  agentType: any;
  activeJobId: string | null;
  onCloseChat: () => void;
  profile: UserProfile;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  foodLogs: FoodLog[];
  setFoodLogs: React.Dispatch<React.SetStateAction<FoodLog[]>>;
  biomarkers: Record<string, number | string>;
  biomarkerHistory: BiomarkerLog[];
  setBiomarkerHistory: React.Dispatch<React.SetStateAction<BiomarkerLog[]>>;
  actions: HealthAction[];
  report: RecommendationReport | null;
  onJobEnqueued?: (jobId: string, kind: 'food' | 'medical') => void;
  onSaveProfile?: (profile: UserProfile) => Promise<void>;
  onOpenAgentFromFrontDesk?: (agentType: string, options?: any) => void;
}

export default function AppModals({
  isChatOpen,
  chatType,
  agentType,
  activeJobId,
  onCloseChat,
  profile,
  selectedModelId,
  onChangeModelId,
  foodLogs,
  setFoodLogs,
  biomarkers,
  biomarkerHistory,
  setBiomarkerHistory,
  actions,
  report,
  onJobEnqueued,
  onSaveProfile,
  onOpenAgentFromFrontDesk
}: AppModalsProps) {
  if (!isChatOpen) return null;

  return (
    <LogChat
      isOpen={isChatOpen}
      type={chatType}
      agentType={agentType}
      jobId={activeJobId}
      profile={profile}
      selectedModelId={selectedModelId}
      onChangeModelId={onChangeModelId}
      onClose={onCloseChat}
      onLogFood={(newLog: FoodLog) => {
        setFoodLogs(prev => [newLog, ...prev]);
      }}
      onLogMedical={(newBiomarkers, profileUpdates, date, entries) => {
        if (entries && Array.isArray(entries)) {
          setBiomarkerHistory(prev => [
            ...entries.map((e: any, idx: number) => ({
              id: `bio_${Date.now()}_${idx}`,
              date: e.date || new Date().toISOString(),
              biomarkers: e.biomarkers || {}
            })),
            ...prev
          ]);
        }
        if (profileUpdates && onSaveProfile) {
          onSaveProfile({ ...profile, ...profileUpdates });
        }
      }}
      biomarkers={biomarkers}
      foodLogs={foodLogs}
      biomarkerHistory={biomarkerHistory}
      report={report}
      actions={actions}
      onJobEnqueued={onJobEnqueued}
      onSaveProfile={onSaveProfile}
      onOpenAgentFromFrontDesk={onOpenAgentFromFrontDesk}
    />
  );
}
