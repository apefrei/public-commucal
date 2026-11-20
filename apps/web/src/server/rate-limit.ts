import "server-only";
import { createHmac } from "node:crypto";
import type Valkey from "iovalkey";
import {
  type RateLimiterAbstract,
  RateLimiterMemory,
  RateLimiterRes,
  RateLimiterValkey,
} from "rate-limiter-flexible";

/** What a rule counts against: the client IP or the email address in the request body. */
type Subject = "ip" | "email";

interface Rule {
  subject: Subject;
  points: number;
  durationSeconds: number;
}

/**
 * Limits for Better Auth's endpoints (ADR-0007). Every request counts, successful or not; a legitimate user stays
 * far below them. ALTCHA after repeated failures follows with the proposal form.
 */
export const AUTH_RATE_RULES: Record<string, Rule[]> = {
  "/sign-in/email": [
    { subject: "ip", points: 20, durationSeconds: 15 * 60 },
    { subject: "email", points: 10, durationSeconds: 15 * 60 },
  ],
  "/two-factor/verify-totp": [{ subject: "ip", points: 20, durationSeconds: 15 * 60 }],
  "/two-factor/verify-backup-code": [{ subject: "ip", points: 10, durationSeconds: 15 * 60 }],
  "/two-factor/enable": [{ subject: "ip", points: 10, durationSeconds: 15 * 60 }],
  "/request-password-reset": [
    { subject: "ip", points: 5, durationSeconds: 60 * 60 },
    { subject: "email", points: 3, durationSeconds: 60 * 60 },
  ],
  "/reset-password": [{ subject: "ip", points: 10, durationSeconds: 60 * 60 }],
  "/change-password": [{ subject: "ip", points: 10, durationSeconds: 60 * 60 }],
};

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AuthRateLimiter {
  check(path: string, subjects: { ip: string; email: string | null }): Promise<RateLimitDecision>;
}

/**
 * Keys are HMACs of rule, subject kind and value, so Valkey never holds an IP or email address (FR-34, ADR-0007).
 * If Valkey fails, an in-memory limiter per process takes over (insurance), so logins neither fail nor go unlimited.
 */
export function createAuthRateLimiter(
  store: Valkey | null,
  salt: string,
  rules: Record<string, Rule[]> = AUTH_RATE_RULES,
): AuthRateLimiter {
  const limiters = new Map<string, RateLimiterAbstract>();
  const limiterFor = (path: string, index: number, rule: Rule): RateLimiterAbstract => {
    const name = `${path}#${index}`;
    let limiter = limiters.get(name);
    if (!limiter) {
      const options = {
        keyPrefix: "rl:auth",
        points: rule.points,
        duration: rule.durationSeconds,
      };
      const memory = new RateLimiterMemory(options);
      limiter = store
        ? new RateLimiterValkey({ ...options, storeClient: store, insuranceLimiter: memory })
        : memory;
      limiters.set(name, limiter);
    }
    return limiter;
  };
  const hash = (value: string) =>
    createHmac("sha256", salt).update(value).digest("hex").slice(0, 32);

  return {
    async check(path, subjects) {
      const pathRules = rules[path] ?? [];
      let retryAfterSeconds = 0;
      for (const [index, rule] of pathRules.entries()) {
        const value = rule.subject === "ip" ? subjects.ip : subjects.email?.trim().toLowerCase();
        if (!value) {
          continue;
        }
        try {
          await limiterFor(path, index, rule).consume(hash(`${path}|${rule.subject}|${value}`));
        } catch (error) {
          if (!(error instanceof RateLimiterRes)) {
            throw error;
          }
          retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil(error.msBeforeNext / 1000));
        }
      }
      return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
    },
  };
}

/** Client IP as set by the trusted proxy (Caddy in staging, nginx in production; ADR-0002). */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || "unknown";
}
