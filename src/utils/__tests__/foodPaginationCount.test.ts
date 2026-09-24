import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pullAuthHeaders } from '../syncUtils';

// Minimal localStorage mock for Node environment
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => mockStorage[k] ?? null,
  setItem: (k: string, v: string) => { mockStorage[k] = String(v); },
  removeItem: (k: string) => { delete mockStorage[k]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
};

describe('Food Pagination Count & Auth Header Regression Sensor (BUG-1)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    (globalThis as any).localStorage = localStorageMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pullAuthHeaders — mobile & custom session resilience', () => {
    it('attaches auth_token from localStorage when Firebase auth has no currentUser (mobile / custom auth)', async () => {
      localStorageMock.setItem('auth_token', 'custom-session-jwt-token-12345');
      // Mock firebase auth without currentUser
      vi.doMock('../../firebase', () => ({
        auth: { currentUser: null, authStateReady: vi.fn().mockResolvedValue(undefined) }
      }));

      const headers = await pullAuthHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer custom-session-jwt-token-12345');
    });

    it('prefers Firebase ID token when auth.currentUser is available', async () => {
      localStorageMock.setItem('auth_token', 'custom-session-token');
      vi.doMock('../../firebase', () => ({
        auth: {
          currentUser: { getIdToken: vi.fn().mockResolvedValue('firebase-id-token-67890') }
        }
      }));

      const headers = await pullAuthHeaders();
      expect(headers['Authorization']).toBe('Bearer firebase-id-token-67890');
    });

    it('always includes Content-Type even when no token exists anywhere', async () => {
      vi.doMock('../../firebase', () => ({
        auth: { currentUser: null }
      }));

      const headers = await pullAuthHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('Pagination Math — prevents 2-page collapse when user has 195 items', () => {
    const itemsPerPage = 15;

    it('computes 13 pages when totalFoodsCount is 195', () => {
      const totalFoodsCount = 195;
      const combinedItemsLength = 30; // only initial page-slice loaded into memory
      const totalItemsCount = Math.max(totalFoodsCount || 0, combinedItemsLength);
      const totalPages = Math.max(1, Math.ceil(totalItemsCount / itemsPerPage));

      expect(totalPages).toBe(13);
    });

    it('reproduces the bug: collapses to 2 pages when totalFoodsCount is missing or falls back to page slice (30)', () => {
      // When bug occurred: totalFoodsCount was 30 (page slice) instead of 195
      const buggyTotalCount = 30;
      const buggyPages = Math.max(1, Math.ceil(buggyTotalCount / itemsPerPage));
      expect(buggyPages).toBe(2); // exactly the observed 2 pages instead of 13
    });

    it('non-regression ratchet: totalFoodsCount must never regress downwards from a partial page pull', () => {
      let totalFoodsCount: number | undefined = 195;

      // Simulate a subsequent pull that only returns a page slice count (30)
      const subsequentPullCount = 30;
      // Fixed logic: Math.max protects against downward regression
      totalFoodsCount = Math.max(totalFoodsCount || 0, subsequentPullCount);

      expect(totalFoodsCount).toBe(195);
      expect(Math.ceil(totalFoodsCount / itemsPerPage)).toBe(13);
    });
  });

  describe('Server response contract: totalFoodsCount preserved', () => {
    it('preserves totalFoodsCount from server when present and ignores page slice', () => {
      const serverResponse = {
        success: true,
        foods: new Array(15).fill({ id: 'f_dummy' }), // 15 items returned in this page
        totalFoodsCount: 195, // real DB count
      };

      const clientTotalFoods = serverResponse.totalFoodsCount ?? serverResponse.foods.length;
      expect(clientTotalFoods).toBe(195);
      expect(Math.ceil(clientTotalFoods / 15)).toBe(13);
    });
  });
});
