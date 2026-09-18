import { JobStore } from "./jobs/JobStore";
import React, { useState, useCallback, useEffect } from 'react';
import { useAppProfile } from './hooks/useAppProfile';
import { useAppSync } from './hooks/useAppSync';
import { useJobPoller } from './hooks/useJobPoller';
import AppShell from './components/AppShell';
import AppTabs from './components/AppTabs';
import AppModals from './components/AppModals';
import { UserProfile } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'insights' | 'food' | 'medical' | 'trends'>('home');
  const [selectedModelId, setSelectedModelId] = useState<string>('gemini-3.5-flash-lite');
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [chatType, setChatType] = useState<'food' | 'medical' | 'front_desk' | 'food_idea' | 'daily_recommendation'>('food');
  const [agentType, setAgentType] = useState<any>(null);

  // Core Hooks
  const {
    profile,
    setProfile,
    saveProfile,
    hideSensitive,
    setHideSensitive,
    loginAsDemo,
    signOut
  } = useAppProfile();

  const {
    foodLogs,
    setFoodLogs,
    biomarkers,
    setBiomarkers,
    biomarkerHistory,
    setBiomarkerHistory,
    actions,
    setActions,
    dailyBenefits,
    setDailyBenefits,
    foodIdeas,
    setFoodIdeas,
    report,
    draftReport,
    syncState,
    cloudSync,
    forcePush,
    forcePushWithFoods,
    forcePull
  } = useAppSync(profile);

  const {
    activeJobId,
    setActiveJobId
  } = useJobPoller();

  // Authentication status
  const isLoggedIn = Boolean(profile && profile.email);

  // Chat/Modal launch handlers
  const handleOpenFrontDesk = useCallback(() => {
    setChatType('front_desk');
    setAgentType('front_desk');
    setIsChatOpen(true);
  }, []);

  const handleOpenLogMeal = useCallback(() => {
    setChatType('food');
    setAgentType(null);
    setIsChatOpen(true);
  }, []);

  const handleOpenLogMedical = useCallback(() => {
    setChatType('medical');
    setAgentType(null);
    setIsChatOpen(true);
  }, []);

  const handleOpenAgentChat = useCallback((type: any, options?: any) => {
    if (type === 'front_desk' || type === 'health_coach') {
      setChatType('front_desk');
      setAgentType(type);
    } else if (['food', 'food_idea'].includes(type)) {
      setChatType('food');
      setAgentType(type);
    } else {
      setChatType('medical');
      setAgentType(type);
    }
    setIsChatOpen(true);
  }, []);

  const handleCloseChat = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  const handleViewJob = useCallback((jobId: string) => {
    setActiveJobId(jobId);
    setChatType('food');
    setIsChatOpen(true);
  }, [setActiveJobId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).setActiveJobId = setActiveJobId;
      (window as any).JobStore = JobStore;
    }
  }, [setActiveJobId]);

  return (
    <AppShell
      activeTab={activeTab}
      onNavigateTab={setActiveTab}
      profile={profile}
      setProfile={setProfile}
      onSaveProfile={saveProfile}
      hideSensitive={hideSensitive}
      setHideSensitive={setHideSensitive}
      syncState={syncState}
      onSignOut={signOut}
      onCloudSync={cloudSync}
      onForcePush={forcePush}
      onForcePushWithFoods={forcePushWithFoods}
      onForcePull={forcePull}
      foodLogs={foodLogs}
      setFoodLogs={setFoodLogs}
      biomarkerHistory={biomarkerHistory}
      setBiomarkerHistory={setBiomarkerHistory}
      onOpenFrontDesk={handleOpenFrontDesk}
      onLogMeal={handleOpenLogMeal}
      onLogMedical={handleOpenLogMedical}
      onCompareMeal={() => handleOpenAgentChat('food_compare')}
      viewingJobId={activeJobId}
      onViewJob={handleViewJob}
      isLoggedIn={isLoggedIn}
      onLoginDemo={loginAsDemo}
    >
      <AppTabs
        activeTab={activeTab}
        profile={profile}
        foodLogs={foodLogs}
        setFoodLogs={setFoodLogs}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        setBiomarkerHistory={setBiomarkerHistory}
        actions={actions}
        setActions={setActions}
        dailyBenefits={dailyBenefits}
        setDailyBenefits={setDailyBenefits}
        foodIdeas={foodIdeas}
        setFoodIdeas={setFoodIdeas}
        report={report}
        draftReport={draftReport}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        hideSensitive={hideSensitive}
        syncState={syncState}
        onNavigateToTab={setActiveTab}
        onOpenAgentChat={handleOpenAgentChat}
        onLogMealClick={handleOpenLogMeal}
        onViewJob={handleViewJob}
        onSaveProfile={saveProfile}
      />

      <AppModals
        isChatOpen={isChatOpen}
        chatType={chatType}
        agentType={agentType}
        activeJobId={activeJobId}
        onCloseChat={handleCloseChat}
        profile={profile}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        foodLogs={foodLogs}
        setFoodLogs={setFoodLogs}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        setBiomarkerHistory={setBiomarkerHistory}
        actions={actions}
        report={report}
        onJobEnqueued={(jobId) => setActiveJobId(jobId)}
        onSaveProfile={saveProfile}
        onOpenAgentFromFrontDesk={(type) => {
          handleOpenAgentChat(type);
        }}
      />
    </AppShell>
  );
}
