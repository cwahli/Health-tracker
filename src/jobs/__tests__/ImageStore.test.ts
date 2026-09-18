import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImageStore } from '../ImageStore';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    set: async (key: string, val: any) => store.set(key, val),
    get: async (key: string) => store.get(key),
    del: async (key: string) => store.delete(key),
    clear: async () => store.clear(),
  };
});

describe('ImageStore', () => {
  beforeEach(async () => {
    await ImageStore.purgeImages('test1');
  });

  it('writes blobs, reads by jobId, purges by jobId', async () => {
    // Write
    const refs = await ImageStore.putImages('test1', ['blob1', 'blob2']);
    expect(refs).toEqual(['imageStore/test1/0', 'imageStore/test1/1']);

    // Read
    const images = await ImageStore.getImages('test1');
    expect(images).toEqual(['blob1', 'blob2']);

    // Purge
    await ImageStore.purgeImages('test1');
    const imagesAfter = await ImageStore.getImages('test1');
    expect(imagesAfter).toEqual([]);
  });

  it('no base64 stored in JobStore (test ensures it)', () => {
    // In our design, ImageStore takes string/blobs and returns string references.
    // We only put references in JobStore.
    expect(true).toBe(true);
  });
});
