import { FastifyRequest } from 'fastify';

export class RateLimiter {
  private rates = new Map<string, number[]>();

  limit(key: string, maximum: number, seconds: number, nowSeconds: number): void {
    let q = this.rates.get(key);
    if (!q) {
      q = [];
      this.rates.set(key, q);
    }
    const cutoff = nowSeconds - seconds;
    while (q.length > 0 && q[0] < cutoff) {
      q.shift();
    }
    if (q.length >= maximum) {
      throw new Error('Please wait before trying again');
    }
    q.push(nowSeconds);
  }

  clear(): void {
    this.rates.clear();
  }

  prune(nowSeconds: number, maxAgeSeconds: number): void {
    const cutoff = nowSeconds - maxAgeSeconds;
    for (const [key, timestamps] of this.rates) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
        this.rates.delete(key);
      }
    }
  }
}

export function getClientIp(request: FastifyRequest, trustProxy = false): string {
  if (trustProxy) {
    const xff = request.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      return xff;
    }
  }
  return request.ip || '?';
}
