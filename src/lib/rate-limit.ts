import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * In-process fixed-window rate limiter for the hub's expensive generation
 * proxies (/api/ai/chat, /api/ai/cla) — promotion-plan Phase-1 item 6.
 *
 * SERVERLESS HONESTY (read before trusting this): on Vercel every lambda
 * instance carries its own copy of the bucket map, so the limits are
 * per-instance, not global. That still caps the realistic abuse vector —
 * scripted hammering lands on a handful of warm instances and each one
 * refuses at the window edge — and it adds zero infrastructure. Core remains
 * the authoritative per-JWT rate limiter on its own endpoints; this layer
 * exists so the hub's own proxy surface cannot be used as a free relay.
 *
 * Buckets are pruned lazily when the map grows past PRUNE_THRESHOLD, so a
 * long-lived instance cannot leak unbounded memory on spoofed-IP floods
 * (each distinct key costs one small object, reclaimed at the next prune).
 */

export interface RateLimitRule {
  /** Requests allowed per window (e.g. burst tier and sustained tier). */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  /** false when at least one tier is exceeded. */
  ok: boolean;
  /** Requests left in the tightest tier for this window. */
  remaining: number;
  /** Epoch ms when the exceeded (or tightest) window resets. */
  resetAt: number;
  /** Whole seconds until reset — drop-in for the Retry-After header. */
  retryAfterSec: number;
  /** The limit that bound this request (first exceeded tier, else tightest). */
  limit: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const PRUNE_THRESHOLD = 4096;

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Evaluate the request against every tier. The first exceeded tier wins for
 * the returned numbers (its reset drives Retry-After); with no tier exceeded,
 * `remaining` reflects the tightest tier so X-RateLimit-Remaining is honest.
 */
export function rateLimit(key: string, rules: RateLimitRule[]): RateLimitResult {
  const now = Date.now();
  if (buckets.size > PRUNE_THRESHOLD) prune(now);

  let remaining = Number.POSITIVE_INFINITY;
  let resetAt = 0;
  let limit = 0;

  for (const rule of rules) {
    const bucketKey = `${key}:${rule.windowMs}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;

    if (bucket.count > rule.limit) {
      return {
        ok: false,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        limit: rule.limit,
      };
    }
    const left = rule.limit - bucket.count;
    if (left < remaining) {
      remaining = left;
      resetAt = bucket.resetAt;
      limit = rule.limit;
    }
  }

  return {
    ok: true,
    remaining: remaining === Number.POSITIVE_INFINITY ? 0 : remaining,
    resetAt,
    retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    limit,
  };
}

/**
 * Identity for the bucket key: the forwarded JWT when present (hashed — the
 * raw token never sits in a map key), else the client IP so anonymous
 * hammering is throttled too. Vercel populates x-forwarded-for.
 */
export function rateLimitKey(req: NextRequest, route: string): string {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  let identity: string;
  if (token) {
    identity = `t:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
  } else {
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    identity = `ip:${fwd || req.headers.get("x-real-ip")?.trim() || "unknown"}`;
  }
  return `${route}:${identity}`;
}

/** Standard rate-limit response headers for a handled request. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

/** 429 body + headers in the same shape the routes' other errors use. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: "rate_limited",
      detail: `Too many requests — try again in ${result.retryAfterSec}s.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        ...rateLimitHeaders(result),
      },
    },
  );
}
