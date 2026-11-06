import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import VoiceReceptionistFab from './VoiceReceptionistFab';
import type { UserProfile } from '../types';
import {
  GeminiLiveAudioClient,
  isLiveVoiceSupported,
  mergeLiveTranscript,
} from '../services/geminiLiveAudioClient';

describe('VoiceReceptionistFab', () => {
  const mockSaveAndSync = () => Promise.resolve();
  const mockSetProfile = () => {};
  const mockSetActiveTab = () => {};

  it('renders trigger FAB button with accessible label', () => {
    const profile: UserProfile = {
      uid: 'user_123',
      email: 'test@example.com',
      nickname: 'Alex',
      language: 'en',
    };

    const html = renderToStaticMarkup(
      <VoiceReceptionistFab
        profile={profile}
        setProfile={mockSetProfile}
        saveAndSync={mockSaveAndSync}
        activeTab="home"
        setActiveTab={mockSetActiveTab}
      />
    );

    expect(html).toContain('aria-label="Open Voice Receptionist"');
    expect(html).toContain('id="voice-receptionist-fab"');
  });

  it('displays missing profile items indicator when fields are empty', () => {
    const incompleteProfile: UserProfile = {
      uid: 'user_new',
      email: 'newuser@example.com',
      language: 'en',
      // age, gender, height, weight, healthGoal missing
    };

    const html = renderToStaticMarkup(
      <VoiceReceptionistFab
        profile={incompleteProfile}
        setProfile={mockSetProfile}
        saveAndSync={mockSaveAndSync}
        activeTab="home"
        setActiveTab={mockSetActiveTab}
      />
    );

    expect(html).toContain('profile items to set');
  });

  it('hides missing badge when profile is complete', () => {
    const completeProfile: any = {
      uid: 'user_complete',
      email: 'complete@example.com',
      age: 32,
      gender: 'Male',
      ethnicity: 'Asian',
      height: 175,
      weight: 70,
      healthGoal: 'Lower cholesterol',
      language: 'en',
    };

    const html = renderToStaticMarkup(
      <VoiceReceptionistFab
        profile={completeProfile}
        setProfile={mockSetProfile}
        saveAndSync={mockSaveAndSync}
        activeTab="home"
        setActiveTab={mockSetActiveTab}
      />
    );

    expect(html).not.toContain('profile items to set');
  });

  it('renders correctly when profile is null (guest/onboarding state)', () => {
    const html = renderToStaticMarkup(
      <VoiceReceptionistFab
        profile={null}
        setProfile={mockSetProfile}
        saveAndSync={mockSaveAndSync}
        activeTab="home"
        setActiveTab={mockSetActiveTab}
      />
    );

    expect(html).toContain('aria-label="Open Voice Receptionist"');
    expect(html).toContain('id="voice-receptionist-fab"');
    expect(html).toContain('profile items to set');
  });
});

describe('VoiceReceptionistFab live voice (VOICE-LIVE-1)', () => {
  it('exposes a live-support probe that is boolean in any runtime', () => {
    expect(typeof isLiveVoiceSupported()).toBe('boolean');
  });

  it('constructs a disconnected live client without touching the DOM', () => {
    const client = new GeminiLiveAudioClient({});
    expect(client.isConnected).toBe(false);
  });

  it('sendText/interrupt/disconnect are safe no-ops before connect', async () => {
    const client = new GeminiLiveAudioClient({});
    expect(() => client.sendText('hello')).not.toThrow();
    expect(() => client.interrupt()).not.toThrow();
    expect(() => client.sendToolResult('id1', 'update_profile', { ok: true })).not.toThrow();
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(client.isConnected).toBe(false);
  });

  it('merges incremental live transcripts without duplicating overlaps', () => {
    // Empty base cases.
    expect(mergeLiveTranscript('', 'hello')).toBe('hello');
    expect(mergeLiveTranscript('hello', '')).toBe('hello');
    // Cumulative re-transcription replaces the prefix.
    expect(mergeLiveTranscript('my HbA1c', 'my HbA1c is 5.4')).toBe('my HbA1c is 5.4');
    // Repeated tail segment is absorbed.
    expect(mergeLiveTranscript('my HbA1c is 5.4', '5.4')).toBe('my HbA1c is 5.4');
    // Genuinely new segments append.
    expect(mergeLiveTranscript('ate tempeh', 'and rice')).toBe('ate tempeh and rice');
  });
});
