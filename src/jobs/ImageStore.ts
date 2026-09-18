import { set, get, del, keys } from 'idb-keyval';

export const ImageStore = {
  async putImages(jobId: string, images: (string | Blob)[]): Promise<string[]> {
    const refs: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const key = `imageStore/${jobId}/${i}`;
      await set(key, images[i]);
      refs.push(key);
    }
    return refs;
  },

  async getImages(jobId: string): Promise<(string | Blob)[]> {
    const images: (string | Blob)[] = [];
    let i = 0;
    while (true) {
      const key = `imageStore/${jobId}/${i}`;
      const img = await get<string | Blob>(key);
      if (!img) break;
      images.push(img);
      i++;
    }
    return images;
  },

  async purgeImages(jobId: string): Promise<void> {
    let i = 0;
    while (true) {
      const key = `imageStore/${jobId}/${i}`;
      const img = await get<string | Blob>(key);
      if (!img) break;
      await del(key);
      i++;
    }
  },

  async purgeAllOldImages(maxAgeMs: number): Promise<void> {
    try {
      const allKeys = await keys();
      const now = Date.now();
      for (const key of allKeys) {
        if (typeof key === 'string' && key.startsWith('imageStore/')) {
          const match = key.match(/^imageStore\/(?:job|med)_(\d+)/);
          if (match) {
            const timestamp = parseInt(match[1], 10);
            if (now - timestamp > maxAgeMs) {
              await del(key);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error purging old images:', e);
    }
  }
};

