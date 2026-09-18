import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeFoodAgent, FoodAgentExecutorInput } from '../FoodAgentExecutor';

const mockInput: FoodAgentExecutorInput = {
  jobId: 'job_123',
  text: 'An apple',
  mode: 'review',
  profile: { timezone: 'UTC' },
  modelId: 'gemini-1.5-flash',
  requestId: 'req_123',
  activeFoodLogs: [],
  messages: []
};

describe('FoodAgentExecutor', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  it('yields progress then done on success', async () => {
    const mockResData = { final: true, result: { data: { name: 'Apple' }, mode: 'review' } };
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
    for await (const ev of executeFoodAgent(mockInput)) {
      events.push(ev);
    }

    expect(events.find(e => e.type === 'progress')).toBeDefined();
    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.data?.data?.name).toBe('Apple');
  });

  it('yields checkpoint when scoutItems are returned mid-stream', async () => {
    const mockScoutData = { scoutItems: [{ name: 'Apple' }], scoutContentType: 'visual' };
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(mockScoutData)}\n\n`));
        controller.close();
      }
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream
    });

    const events = [];
    for await (const ev of executeFoodAgent(mockInput)) {
      events.push(ev);
    }

    const cpEvent = events.find(e => e.type === 'checkpoint');
    expect(cpEvent).toBeDefined();
    expect(cpEvent?.checkpoint?.scoutItems[0].name).toBe('Apple');
  });

  it('classifies 504 timeout as transient error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 504,
      text: async () => 'Gateway Timeout'
    });

    const events = [];
    for await (const ev of executeFoodAgent(mockInput)) {
      events.push(ev);
    }

    const errEvent = events.find(e => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent?.errorClass).toBe('transient');
  });

  it('classifies parsing failure / 400 as permanent error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request'
    });

    const events = [];
    for await (const ev of executeFoodAgent(mockInput)) {
      events.push(ev);
    }

    const errEvent = events.find(e => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent?.errorClass).toBe('permanent');
  });

  it('handles Mode D (compare) execution correctly', async () => {
    const compareInput: FoodAgentExecutorInput = {
      ...mockInput,
      jobId: 'job_compare_123',
      text: 'Compare chicken breast vs tofu',
      mode: 'compare',
      lockedModeFamily: 'D'
    };

    const mockResData = { final: true, result: { comparison: { itemA: 'Chicken', itemB: 'Tofu' }, mode: 'compare' } };
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
    for await (const ev of executeFoodAgent(compareInput)) {
      events.push(ev);
    }

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent?.data?.comparison?.itemA).toBe('Chicken');

    // Verify fetch call payload
    const bodySent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(bodySent.userSelectedMode).toBe('compare');
  });

  it('handles edit mode execution with message history', async () => {
    const editInput: FoodAgentExecutorInput = {
      ...mockInput,
      jobId: 'job_edit_123',
      text: 'Make it brown rice instead',
      mode: 'edit',
      messages: [
        { id: 'm1', role: 'user', content: 'Chicken with white rice' },
        { id: 'm2', role: 'assistant', content: 'Here is your meal', data: { pendingFoodLog: { name: 'Chicken Rice', quantity: '1 bowl' } } }
      ]
    };

    const mockResData = { final: true, result: { data: { name: 'Chicken Brown Rice' }, mode: 'edit' } };
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
    for await (const ev of executeFoodAgent(editInput)) {
      events.push(ev);
    }

    const doneEvent = events.find(e => e.type === 'done');
    expect(doneEvent).toBeDefined();

    const bodySent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(bodySent.userSelectedMode).toBe('edit');
    expect(bodySent.history).toHaveLength(2);
  });
});
