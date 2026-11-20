/** Sliding-window limiter. In-memory, so per-process; swap for Redis when scaling out. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  private prune(key: string, windowSec: number): number[] {
    const now = Date.now();
    const q = (this.hits.get(key) ?? []).filter((t) => now - t <= windowSec * 1000);
    this.hits.set(key, q);
    return q;
  }

  /** Record a hit. Returns false when the key is over its limit. */
  hit(key: string, limit: number, windowSec: number): boolean {
    const q = this.prune(key, windowSec);
    if (q.length >= limit) return false;
    q.push(Date.now());
    return true;
  }

  isBlocked(key: string, limit: number, windowSec: number): boolean {
    return this.prune(key, windowSec).length >= limit;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  clear() {
    this.hits.clear();
  }
}

const g = globalThis as unknown as { __limiter?: RateLimiter };
export const limiter = (g.__limiter ??= new RateLimiter());
