import type Valkey from "iovalkey";
import { describe, expect, it } from "vitest";
import { clientIp, createAuthRateLimiter } from "./rate-limit";

const rules = {
  "/sign-in/email": [
    { subject: "ip" as const, points: 3, durationSeconds: 60 },
    { subject: "email" as const, points: 2, durationSeconds: 60 },
  ],
};

/** Minimal stand-in for iovalkey: records keys and counts like the Lua script of rate-limiter-flexible. */
function fakeValkey(options: { failing?: boolean } = {}) {
  const counts = new Map<string, number>();
  const client = {
    status: "ready",
    defineCommand() {},
    async rlflxIncr([key, points]: string[]) {
      if (options.failing) {
        throw new Error("connection lost");
      }
      const next = (counts.get(key ?? "") ?? 0) + Number(points);
      counts.set(key ?? "", next);
      return [next, 60_000];
    },
  };
  return { client: client as unknown as Valkey, counts };
}

describe("auth rate limiter", () => {
  it("blocks per IP after the limit and reports when to retry", async () => {
    const limiter = createAuthRateLimiter(null, "salt", rules);
    for (let attempt = 0; attempt < 3; attempt++) {
      const decision = await limiter.check("/sign-in/email", { ip: "203.0.113.7", email: null });
      expect(decision.allowed).toBe(true);
    }
    const blocked = await limiter.check("/sign-in/email", { ip: "203.0.113.7", email: null });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(
      (await limiter.check("/sign-in/email", { ip: "198.51.100.1", email: null })).allowed,
    ).toBe(true);
  });

  it("limits per account across IPs, ignoring case", async () => {
    const limiter = createAuthRateLimiter(null, "salt", rules);
    await limiter.check("/sign-in/email", { ip: "192.0.2.1", email: "Anna@Example.ch" });
    await limiter.check("/sign-in/email", { ip: "192.0.2.2", email: "anna@example.ch" });
    const third = await limiter.check("/sign-in/email", {
      ip: "192.0.2.3",
      email: "ANNA@example.ch ",
    });
    expect(third.allowed).toBe(false);
  });

  it("does not limit paths without rules", async () => {
    const limiter = createAuthRateLimiter(null, "salt", rules);
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await limiter.check("/get-session", { ip: "192.0.2.9", email: null })).allowed).toBe(
        true,
      );
    }
  });

  it("stores only hashed keys in Valkey, never the IP or email", async () => {
    const { client, counts } = fakeValkey();
    const limiter = createAuthRateLimiter(client, "salt", rules);
    await limiter.check("/sign-in/email", { ip: "203.0.113.7", email: "anna@example.ch" });
    const keys = [...counts.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^rl:auth:[0-9a-f]{32}$/);
    }
  });

  it("falls back to an in-memory limit when Valkey fails", async () => {
    const { client } = fakeValkey({ failing: true });
    const limiter = createAuthRateLimiter(client, "salt", rules);
    const decisions = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      decisions.push(
        (await limiter.check("/sign-in/email", { ip: "203.0.113.8", email: null })).allowed,
      );
    }
    expect(decisions).toEqual([true, true, true, false]);
  });

  it("takes the client IP from the proxy header", () => {
    expect(clientIp(new Headers({ "x-real-ip": " 203.0.113.7 " }))).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
