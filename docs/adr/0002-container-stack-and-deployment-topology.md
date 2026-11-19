# ADR 0002: Container stack and deployment topology

- Status: Proposed
- Date: 2026-11-19
- Authors: apefrei

## Context

Commucal is a multi-tenant web product (see [`docs/requirements.md`](../requirements.md)) that must run as a
self-contained container stack. Constraints:

- Production runs on the owner's own server at Hetzner (EU). That server already runs nginx as an upstream proxy
  with TLS, and a WEDOS WAF sits in front of it.
- Staging runs on the owner's home server (cyberfrog), reachable in the LAN and through Twingate, without WAF and
  without host nginx.
- HTTPS must apply from day one, also on staging.
- Small operator team: as few moving parts as possible, no managed cloud services required.
- A read-only MCP server is a core feature and must not be able to touch non-public data.

## Decision

Run one Docker Compose stack with the services `web` (Next.js), `mcp` (MCP server), `worker` (pg-boss jobs),
`migrate` (one-shot), `postgres` and `valkey`. In production, the existing host nginx terminates TLS behind the
WEDOS WAF and routes to `web` and `mcp` on 127.0.0.1. On staging and locally, a `proxy` container (Caddy with an
internal CA) takes the place of WAF and host nginx, activated by the Compose profile `local`.

```
Production:  Internet → WEDOS WAF → host nginx (TLS) → 127.0.0.1:{web,mcp}
Staging:     LAN/Twingate → proxy (Caddy, internal CA) → web, mcp
Both:        web, mcp, worker → postgres, valkey   (internal network only)
```

Details:

- **One image build, several targets.** A multi-stage Dockerfile builds `web`, `mcp`, `worker` and `migrate` from the
  pnpm monorepo. CI pushes images to GHCR with an SBOM; deployments reference image digests. Staging and production
  run identical images.
- **Persistent state only in PostgreSQL.** Data, logos (as `bytea`, max 512 KB each) and the job queue (pg-boss)
  live in PostgreSQL. Containers are stateless; backups cover everything with one database dump.
- **Valkey** holds the feed cache and rate-limit counters only. Losing it costs performance, never data.
- **Job queue in PostgreSQL (pg-boss)** for anonymisation, purges, emails, audit verification and scheduled tasks.
  No extra broker service.
- **Network:** `postgres` and `valkey` sit on an internal Compose network without published ports. `web` and `mcp`
  publish only on `127.0.0.1` (production) or are reached through `proxy` (staging).
- **Client IP:** host nginx accepts the client IP from WEDOS only for the WEDOS IP ranges (`set_real_ip_from`,
  `real_ip_recursive on`) and passes it as `X-Real-IP`. The application trusts that header only from the proxy hop.
  Caddy does the same on staging.
- **Origin lockdown:** the Hetzner firewall allows ports 80/443 only from WEDOS IP ranges. The ranges are kept current
  with a documented update procedure.
- **MCP through proxies:** nginx disables buffering for `/mcp` and `/t/*/mcp` and uses long read timeouts so
  Streamable HTTP (SSE) works. WAF exceptions for these paths are verified before go-live.
- **Security headers** (CSP, HSTS, frame, referrer, permissions policy) are set by the application, so they are the
  same behind nginx and Caddy.
- **Uploads** use the framework's native `Request.formData()` in a route handler with size limits and content
  validation; no extra upload library is needed for one small logo per tenant.

## Rationale

- Reusing the existing host nginx and WEDOS WAF avoids a second TLS layer and keeps the production server consistent
  with its other services.
- Keeping Caddy for staging gives real HTTPS on cyberfrog without certificates from the public internet.
- Storing logos and jobs in PostgreSQL removes an object store and a message broker from the stack. At the expected
  scale (hundreds of tenants, one logo each) the database handles both easily.
- A separate `mcp` container allows a dedicated, minimal database role and independent scaling and rate limits.

## Rejected alternatives

- **Caddy or Traefik as the production edge:** would duplicate the existing nginx and conflict with the WEDOS setup.
- **S3-compatible object storage (MinIO, Garage, Hetzner Object Storage) for logos:** one more service or external
  dependency, separate backups, for a few hundred small files.
- **Redis:** licence changed; Valkey is the open-source fork with the same protocol.
- **Separate broker (RabbitMQ, BullMQ on Valkey):** BullMQ would make Valkey stateful; RabbitMQ adds a service.
- **MCP inside the Next.js app:** shares the app's database role and blast radius; harder to rate-limit separately.
- **Kubernetes:** unnecessary complexity for a single host.

## Consequences

- Positive: few services, one backup target, identical images for staging and production, HTTPS everywhere.
- Negative: production depends on correct host nginx configuration outside the repository. Mitigated by a versioned
  nginx snippet and runbook in `deploy/`.
- Negative: the WEDOS IP ranges must be kept current for real-IP handling and the origin firewall.
- Follow-up: WP-1.2 (Compose stack), WP-1.9 (release pipeline, nginx snippet, origin lockdown, WAF test for MCP),
  WP-3.3 (backups), WP-3.4 (monitoring).

## References

- [`docs/requirements.md`](../requirements.md) sections 6 and 7
- ADR-0004 (database roles), ADR-0005 (MCP server), ADR-0007 (rate limiting)
