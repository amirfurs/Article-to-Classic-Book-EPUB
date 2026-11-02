/**
 * In-Memory Buffer Cache
 * Ensures instant EPUB retrieval in serverless environments (like Vercel)
 * where the filesystem is ephemeral or read-only.
 */

const cache = new Map();
const MAX_CACHE_ITEMS = 100;
const TTL_MS = 60 * 60 * 1000; // 1 hour

export const bufferCache = {
  set(id, data) {
    if (!id || !data) return;
    
    // Evict oldest if capacity reached
    if (cache.size >= MAX_CACHE_ITEMS) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    
    cache.set(id, {
      ...data,
      timestamp: Date.now()
    });
  },

  get(id) {
    if (!id) return null;
    const item = cache.get(id);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > TTL_MS) {
      cache.delete(id);
      return null;
    }
    return item;
  },

  has(id) {
    return this.get(id) !== null;
  },

  delete(id) {
    cache.delete(id);
  },

  clear() {
    cache.clear();
  }
};

