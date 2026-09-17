import { describe, it, expect } from 'vitest';
import { mergeFoodEditMessages, shouldMergeFoodEditTurn } from '../mergeFoodEditMessages';

describe('mergeFoodEditMessages', () => {
  const originalCard = {
    id: 'msg_assistant_job1',
    role: 'assistant',
    content: 'Sweetened tea analysis',
    pendingFoodLog: { name: 'Meal', nutrients: { calories: 660, protein: 43.5 } },
    data: {
      pendingFoodLog: {
        name: 'Es Teh Manis, Cah Kangkung, and Ikan Bakar Set with Rice and Sambal',
        nutrients: { calories: 660, protein: 43.5 },
        itemsBreakdown: [{ name: 'Sweet Iced Tea', nutrients: { calories: 104 } }],
      },
    },
  };
  const userEdit = {
    id: 'msg_user_2',
    role: 'user',
    content: 'the tea is unsweetened',
  };

  it('merges the edit result into the original card and does not append a second food card', () => {
    const assistant = {
      id: 'msg_assistant_job1_new',
      role: 'assistant',
      content: 'The unsweetened tea keeps added sugar minimal.',
      pendingFoodLog: { name: 'Grilled Fish and Vegetables with Unsweetened Tea', nutrients: { calories: 556 } },
      data: {
        pendingFoodLog: { name: 'Grilled Fish and Vegetables with Unsweetened Tea', nutrients: { calories: 556 } },
        mode: 'modify',
      },
    };

    const merged = mergeFoodEditMessages([originalCard, userEdit], assistant);
    expect(merged).toHaveLength(2);
    expect(merged[0].data.pendingFoodLog.nutrients.calories).toBe(556);
    // In-place update: latest message replaces the stale pre-edit narrative.
    expect(merged[0].content).toBe('The unsweetened tea keeps added sugar minimal.');
    expect(merged[0].content).not.toContain('Sweetened tea analysis');
    expect(merged[1].role).toBe('user');
    expect(merged[1].data?.pendingFoodLog).toBeUndefined();
    expect(merged.filter((m: any) => m.data?.pendingFoodLog || m.pendingFoodLog)).toHaveLength(1);
  });

  it('appends when there is no prior food card', () => {
    const user = { id: 'u1', role: 'user', content: 'Analyze this meal photo.' };
    const assistant = { id: 'a1', role: 'assistant', content: 'Done', pendingFoodLog: { name: 'Meal' }, data: { pendingFoodLog: { name: 'Meal' } } };
    const merged = mergeFoodEditMessages([user], assistant);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe('a1');
  });

  it('detects an edit follow-up as a merge turn', () => {
    expect(shouldMergeFoodEditTurn({
      mode: 'edit',
      messages: [originalCard, userEdit],
    })).toBe(true);
    expect(shouldMergeFoodEditTurn({
      isMedicalJob: true,
      mode: 'edit',
      messages: [originalCard, userEdit],
    })).toBe(false);
  });
});
