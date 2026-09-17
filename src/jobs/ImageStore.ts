import * as idb from 'idb-keyval';

const memImages = new Map<string, string>();

export const ImageStore = {
  async set(key: string, dataUrl: string): Promise<void> {
    memImages.set(key, dataUrl);
    try {
      await idb.set(`img_${key}`, dataUrl);
    } catch {
      // idb optional
    }
  },

  async get(key: string): Promise<string | undefined> {
    if (memImages.has(key)) return memImages.get(key);
    try {
      const val = await idb.get(`img_${key}`);
      if (val) {
        memImages.set(key, val);
        return val;
      }
    } catch {
      // idb optional
    }
    return undefined;
  },

  async getImages(keys: string[]): Promise<Record<string, string>> {
    const res: Record<string, string> = {};
    for (const k of keys) {
      const v = await this.get(k);
      if (v) res[k] = v;
    }
    return res;
  },

  async delete(key: string): Promise<void> {
    memImages.delete(key);
    try {
      await idb.del(`img_${key}`);
    } catch {}
  },

  async clear(): Promise<void> {
    memImages.clear();
    try {
      await idb.clear();
    } catch {}
  },

  storeImage(key: string, dataUrl: string): Promise<void> {
    return this.set(key, dataUrl);
  },

  getImage(key: string): Promise<string | undefined> {
    return this.get(key);
  },

  removeImage(key: string): Promise<void> {
    return this.delete(key);
  }
};
