/**
 * Q-8.5 — Receptionist process board.
 * Dummy UC + handoff. No live Gemini / 10-UC click-through.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JobStore } from '../src/jobs/JobStore';
import { clearChatMemoryKeys, CHAT_MEMORY_PREFIXES } from '../src/utils/storageUtils';
import { enforceReadyHandoffContract, maybePromoteHandoff } from '../src/server/receptionist/call_agent.js';
import { buildCanonicalRunTree, determinePack } from '../src/utils/debugRunTree';
import { classifyDump, evaluateContracts } from '../src/utils/dumpContract';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
    keys: async () => Array.from(store.keys()),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UC02 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../prototype/receptionist/benchmark/UC-02.json'), 'utf-8')
);

/** QUALITY.md §1.3.1 receptionist process exits. */
const DESK_EXITS = [
  { exit: 'Empty-demo wipe', classId: 'CHAT_STALE' },
  { exit: 'UC handoff reaches the specialist', classId: 'HANDOFF' },
  { exit: 'Handoff record from/to/dropped keys', classId: 'HANDOFF' },
  { exit: 'Specialist then uses food or bio process board', classId: 'WRONG_PLACE' },
  { exit: 'Front Desk is not a second meal analyzer', classId: 'WRONG_PLACE' },
] as const;

function runPostProcessor(output: any, ctx: { currentUserMessage?: string; existingUserProfile?: any }) {
  const promoted = maybePromoteHandoff({ ...output }, ctx);
  return enforceReadyHandoffContract(promoted, ctx);
}

describe('Q-8.5 receptionist process board — §1.3.1 desk exits', () => {
  it('audits every QUALITY.md §1.3.1 receptionist process exit', () => {
    expect(DESK_EXITS.map((r) => r.exit)).toEqual([
      'Empty-demo wipe',
      'UC handoff reaches the specialist',
      'Handoff record from/to/dropped keys',
      'Specialist then uses food or bio process board',
      'Front Desk is not a second meal analyzer',
    ]);
  });

  it('empty-demo wipe (CHAT_STALE): resetAllJobs + clearChatMemoryKeys', () => {
    JobStore.clearForTests();
    JobStore.createJob({ id: 'desk_r1' });
    JobStore.createJob({ id: 'desk_r2' });
    expect(JobStore.getAllJobs().length).toBe(2);
    JobStore.resetAllJobs();
    expect(JobStore.getAllJobs().length).toBe(0);
    expect(JobStore.getJob('desk_r1')).toBeUndefined();

    const store = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] || null,
    };
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });
    localStorage.setItem('last_sent_payload_demo_x_front_desk', '{}');
    localStorage.setItem('active_session_id_front_desk_none', 's1');
    localStorage.setItem('jobstore_jobs', '{}');
    localStorage.setItem('chat_messages_demo_front_desk', '[]');
    localStorage.setItem('preferred_language', 'en');
    clearChatMemoryKeys();
    expect(localStorage.getItem('last_sent_payload_demo_x_front_desk')).toBeNull();
    expect(localStorage.getItem('active_session_id_front_desk_none')).toBeNull();
    expect(localStorage.getItem('jobstore_jobs')).toBeNull();
    expect(localStorage.getItem('chat_messages_demo_front_desk')).toBeNull();
    expect(localStorage.getItem('preferred_language')).toBe('en');
    expect(CHAT_MEMORY_PREFIXES.length).toBeGreaterThan(0);
  });

  it('UC-02 handoff reaches the specialist; incomplete stays needs_info with no specialist job', () => {
    const [ucTurn1, ucTurn2] = UC02.turns;
    const incomplete = runPostProcessor({
      intent: ucTurn1.expectedOutput.intent,
      targetAgent: ucTurn1.expectedOutput.targetAgent,
      status: ucTurn1.expectedOutput.status,
      missingFields: ucTurn1.expectedOutput.expectedMissingFields,
      handoffPayload: null,
      userResponse: 'What would you like to work on?',
      memory: { goalSummary: 'User wants general health', userProfileSnapshot: {} },
    }, {
      currentUserMessage: ucTurn1.userMessage,
      existingUserProfile: null,
    });
    expect(incomplete.status).toBe('needs_info');
    expect(incomplete.handoffPayload).toBeNull();
    expect(incomplete.missingFields).toEqual(expect.arrayContaining(['age', 'gender']));

    const snapshot = {
      age: 28, gender: 'female', heightCm: 162, weightKg: 54,
      activityLevel: 'lightly_active', language: 'en',
    };
    const complete = runPostProcessor({
      intent: ucTurn2.expectedOutput.intent,
      targetAgent: ucTurn2.expectedOutput.targetAgent,
      status: 'needs_info',
      missingFields: [],
      handoffPayload: null,
      userResponse: '',
      memory: {
        goalSummary: 'Afternoon energy crashes and poor sleep; improve vitality',
        userProfileSnapshot: snapshot,
      },
    }, {
      currentUserMessage: ucTurn2.userMessage,
      existingUserProfile: snapshot,
    });
    expect(complete.status).toBe('ready_for_handoff');
    expect(complete.handoffPayload).toBeTruthy();
    expect(complete.handoffPayload.targetAgent).toBe('health_coach');
  });

  it('handoff record from/to + dropped keys PASS; missing specialist is MISSING', () => {
    const pass = buildCanonicalRunTree({
      pack: 'receptionist',
      jobId: 'job_fd_handoff',
      status: 'succeeded',
      handoffChain: ['Front Desk', 'Health Coach'],
      handoffs: [{
        from: 'Front Desk',
        to: 'Health Coach',
        jobId: 'job_fd_handoff',
        keysDropped: ['photos'],
        received: { targetAgent: 'health_coach' },
      }],
    });
    expect(pass.pack).toBe('receptionist');
    expect(pass.handoffs[0].from).toBe('Front Desk');
    expect(pass.handoffs[0].to).toBe('Health Coach');
    expect(pass.handoffs[0].jobId).toBe('job_fd_handoff');
    expect(pass.handoffs[0].keysDropped).toEqual(['photos']);
    expect(pass.contract.find((e) => e.law === 'Handoff from/to + same jobId if transfer')?.result).toBe('PASS');

    const miss = buildCanonicalRunTree({
      pack: 'receptionist',
      jobId: 'job_fd_miss',
      status: 'succeeded',
      backendLogs: 'ready_for_handoff to Health Coach',
    });
    const missLaw = miss.contract.find((e) => e.law === 'Handoff from/to + same jobId if transfer');
    expect(missLaw?.result).toBe('FAIL');
    expect(missLaw?.fault).toBe('MISSING');
    expect(classifyDump(miss).some((f) => f.id === 'HANDOFF_CONTRACT_MISSING')).toBe(true);
  });

  it('after handoff, food pack still scores food laws; medical pack flags meal scout tape WRONG_PLACE', () => {
    const foodInput = {
      pack: 'food' as const,
      jobId: 'job_after_food',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 420 kcal\nAnalyzeFinished succeeded',
      pendingFoodLog: { nutrients: { calories: 420 } },
      dispatches: [
        { id: 't1/scout', agent: 'scout', model: 'gemini-3.5-flash-lite', latency_ms: 1000 },
        { id: 't1/dietitian', agent: 'dietitian', model: 'gemini-3.5-flash-lite', latency_ms: 2000 },
      ],
    };
    expect(determinePack(foodInput)).toBe('food');
    const foodTree = buildCanonicalRunTree(foodInput);
    const foodEvals = evaluateContracts(foodTree);
    expect(foodEvals.find((e) => e.law === 'Matrix calc matches ledger')?.result).toBe('PASS');
    expect(foodEvals.find((e) => e.law === 'SSE {final,result}')?.result).toBe('PASS');

    const medicalInput = {
      pack: 'medical' as const,
      jobId: 'job_after_med',
      status: 'succeeded',
      extractedData: [{ biomarker: 'hdl', value: 50 }],
      scoutItems: [{ originalName: 'Soto' }],
    };
    expect(determinePack(medicalInput)).toBe('medical');
    const medTree = buildCanonicalRunTree(medicalInput);
    const scoutLaw = medTree.contract.find((e) => e.law === 'Meal scout tape off non-food pack');
    expect(scoutLaw?.result).toBe('FAIL');
    expect(scoutLaw?.fault).toBe('WRONG_PLACE');
    expect(classifyDump(medTree).some((f) => f.id === 'SCOUT_ON_NON_FOOD')).toBe(true);
    expect(medTree.dispatches.some((d) => d.agent === 'scout')).toBe(false);
  });

  it('Front Desk is not a second meal analyzer — fd/front_desk, food ledger laws n/a', () => {
    const fd = buildCanonicalRunTree({
      pack: 'receptionist',
      jobId: 'job_fd_only',
      status: 'succeeded',
      agentType: 'front_desk',
    });
    expect(fd.dispatches[0]?.id).toBe('fd/front_desk');
    expect(fd.contract.find((e) => e.law === 'pendingFoodLog -> succeeded before R2')?.result).toBe('n/a');
    expect(fd.contract.find((e) => e.law === 'Matrix calc matches ledger')?.result).toBe('n/a');
    expect(fd.contract.find((e) => e.law === 'AnalyzeFinished count = 1')?.result).toBe('n/a');
    expect(fd.contract.find((e) => e.law === 'Dialog on_card kcal = ledger')?.result).toBe('n/a');
    expect(fd.contract.find((e) => e.law === 'Meal scout tape off non-food pack')?.result).toBe('PASS');
    expect(classifyDump(fd).length).toBe(0);
  });
});

describe('Q-8.5 JobStore isolation', () => {
  beforeEach(() => {
    JobStore.clearForTests();
  });

  it('resetAllJobs is idempotent on an empty store', () => {
    JobStore.resetAllJobs();
    expect(JobStore.getAllJobs().length).toBe(0);
  });
});
