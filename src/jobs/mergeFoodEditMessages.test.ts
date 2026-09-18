import { describe, expect, it } from 'vitest';
import { mergeFoodEditMessages, shouldMergeFoodEditTurn } from './mergeFoodEditMessages';

type AnyMessage = any;

function makeFoodLog(names: string[]) {
  const items = names.map((name, scoutIndex) => ({ scoutIndex, name }));
  return {
    id: 'meal_golden',
    name: 'Golden meal',
    itemsBreakdown: items,
    scoutItems: items,
  };
}

function assistantFoodMessage(id: string, content: string, foodLog: any, commands: any[] = []): AnyMessage {
  return {
    id,
    role: 'assistant',
    agentType: 'food',
    mode: 'edit',
    content,
    modificationCommand: commands,
    data: {
      pendingFoodLog: foodLog,
      scoutItems: foodLog?.scoutItems ?? [],
      agentResult: { modificationCommand: commands },
    },
  };
}

function userMessage(id: string, content: string): AnyMessage {
  return { id, role: 'user', content, timestamp: new Date(0).toISOString() };
}

function applyEdit(messages: AnyMessage[], incoming: AnyMessage): AnyMessage[] {
  const shouldMerge = shouldMergeFoodEditTurn({
    isMedicalJob: false,
    mode: 'edit',
    inputMode: 'edit',
    cleanMode: incoming.mode || 'modify',
    messages,
  });

  return shouldMerge ? mergeFoodEditMessages(messages, incoming) : [...messages, incoming];
}

describe('mergeFoodEditMessages', () => {
  it('golden: two remove_item then empty Q&A keeps removals', () => {
    let messages: AnyMessage[] = [
      assistantFoodMessage('assistant_initial', 'Initial meal', makeFoodLog(['apple', 'banana', 'carrot'])),
      userMessage('user_remove_apple', 'remove apple'),
    ];

    messages = applyEdit(
      messages,
      assistantFoodMessage(
        'assistant_remove_apple',
        'Removed apple',
        makeFoodLog(['banana', 'carrot']),
        [{ action: 'remove_item', target: 'apple' }],
      ),
    );

    messages.push(userMessage('user_remove_banana', 'remove banana'));
    messages = applyEdit(
      messages,
      assistantFoodMessage(
        'assistant_remove_banana',
        'Removed banana',
        makeFoodLog(['carrot']),
        [{ action: 'remove_item', target: 'banana' }],
      ),
    );

    messages.push(userMessage('user_empty_qa', ''));
    messages = applyEdit(messages, assistantFoodMessage('assistant_empty_qa', '', null, []));

    const assistants = messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);

    const final = assistants[0];
    expect(final?.data?.pendingFoodLog?.itemsBreakdown?.map((item: any) => item.name)).toEqual(['carrot']);
    expect(final?.data?.scoutItems?.map((item: any) => item.name)).toEqual(['carrot']);
  });
});
