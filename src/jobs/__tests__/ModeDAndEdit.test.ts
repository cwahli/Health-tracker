import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeFoodAgent, FoodAgentExecutorInput } from '../FoodAgentExecutor';

describe('Mode D and Mode Edit Async Execution', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  it('sends userSelectedMode compare for Mode D food_compare jobs', async () => {
    const input: FoodAgentExecutorInput = {
      jobId: 'job_compare_1',
      text: 'Compare these two meals',
      mode: 'compare',
      lockedModeFamily: 'D',
      profile: { timezone: 'UTC' },
      modelId: 'gemini-3.5-flash-lite',
      requestId: 'req_compare_1',
      activeFoodLogs: [],
      messages: []
    };

    const mockResData = {
      final: true,
      result: {
        mode: 'evaluation',
        comparison: {
          groups: [
            { title: 'Option 1', scoutItemIndices: [0], items: ['Chicken Salad'] },
            { title: 'Option 2', scoutItemIndices: [1], items: ['Beef Burger'] }
          ]
        }
      }
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(mockResData)}\n\n`));
        controller.close();
      }
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream
    });

    const events = [];
    for await (const ev of executeFoodAgent(input)) {
      events.push(ev);
    }

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.data?.mode).toBe('evaluation');
    expect(doneEvent?.data?.comparison?.groups.length).toBe(2);

    const fetchCall = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(fetchCall[1].body);
    expect(sentBody.userSelectedMode).toBe('compare');
  });

  it('sends userSelectedMode modify and preserves activeMeal for Mode Edit jobs', async () => {
    const activeMeal = {
      id: 'food_123',
      name: 'Grilled Salmon',
      weightGrams: 200,
      nutrients: { calories: 400, protein: 40, totalFat: 20, carbohydrates: 0 }
    };

    const input: FoodAgentExecutorInput = {
      jobId: 'job_edit_1',
      text: 'Actually only ate 150g',
      mode: 'edit',
      lockedModeFamily: 'A',
      profile: { timezone: 'UTC' },
      modelId: 'gemini-3.5-flash-lite',
      requestId: 'req_edit_1',
      activeFoodLogs: [],
      messages: [
        {
          id: 'msg_1',
          role: 'assistant',
          content: 'Meal analyzed',
          data: { pendingFoodLog: activeMeal }
        }
      ]
    };

    const mockResData = {
      final: true,
      result: {
        mode: 'modify',
        data: {
          ...activeMeal,
          weightGrams: 150,
          nutrients: { calories: 300, protein: 30, totalFat: 15, carbohydrates: 0 }
        }
      }
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(mockResData)}\n\n`));
        controller.close();
      }
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream
    });

    const events = [];
    for await (const ev of executeFoodAgent(input)) {
      events.push(ev);
    }

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.data?.mode).toBe('modify');

    const fetchCall = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(fetchCall[1].body);
    expect(sentBody.userSelectedMode).toBe('edit');
    expect(sentBody.activeMeal).toBeDefined();
    expect(sentBody.activeMeal.name).toBe('Grilled Salmon');
  });
});
