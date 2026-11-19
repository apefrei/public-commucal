# ADR 0007: Bot protection with ALTCHA and rate limiting on Valkey

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

The public proposal form, login and password reset, the feeds and the MCP server need protection against bots and
abuse. The previous plan used Cloudflare Turnstile and `@upstash/ratelimit` with Upstash Redis – a cloud service that
does not match the self-contained stack (ADR-0002). The playbook lists Turnstile/hCaptcha for bot protection and
express-rate-limit, `@upstash/ratelimit` or framework middleware for rate limiting; it asks to discuss alternatives.

## Decision

- **Bot protection: ALTCHA** (self-hosted proof-of-work challenge; `altcha` widget, `altcha-lib` on the server with an
  HMAC key from the environment). Used on the proposal form and, after repeated failures, on login and password reset.
- **Rate limiting: `rate-limiter-flexible` with Valkey** as shared store, used by `web` and `mcp`. Keys are salted hashes
  of the client IP (from the trusted proxy chain, ADR-0002) with short TTLs.

Initial limits (tunable via configuration):

| Target | Limit |
|---|---|
| Proposal form | 3 per IP per hour; per-tenant daily cap |
| Login / MFA / password reset | progressive delay per account and per IP; ALTCHA after 3 failures |
| MCP | per-IP requests per minute and per day |
| Feeds | generous per-IP limit; caching handles normal load |

## Rationale

- ALTCHA needs no third party: no data goes to Cloudflare or hCaptcha, no cookies, no tracking, accessible without
  image puzzles. Chosen by the owner.
- Next.js has no built-in rate limiting and express-rate-limit is Express-only; `rate-limiter-flexible` works in any Node
  service and supports Valkey/Redis as a shared store, so limits hold across several `web` or `mcp` instances.
- Valkey is already part of the stack; no cloud dependency like Upstash.

## Rejected alternatives

- **Cloudflare Turnstile / hCaptcha:** third-party processors receiving residents' data; conflict with the data
  minimisation goal (NFR-15).
- **`@upstash/ratelimit`:** requires Upstash's HTTP Redis service.
- **Rate limiting only in nginx or WEDOS:** coarse (no per-account or per-tenant rules) and absent on staging; still used
  as an additional outer layer.
- **In-memory limits:** reset on restart and not shared between instances.

## Consequences

- Positive: no external processor for bot protection; consistent limits in all services.
- Negative: two libraries outside the playbook's list – this ADR is the documented exception. ALTCHA's proof-of-work
  stops cheap bots, not determined attackers with compute; rate limits and review workflow cover the rest.
- Follow-up: WP-1.4 (auth limits), WP-1.8 (MCP limits), WP-2.3 (proposal form).

## References

- [`docs/requirements.md`](../requirements.md) FR-32, FR-36, FR-49, NFR-6
- ADR-0002 (client IP handling)
