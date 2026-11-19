# ADR 0005: Public read-only MCP server

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

Being "AI-ready" is a core goal (G4): AI assistants should answer questions such as "When is the next paper
collection?" from a municipality's public calendars. The Model Context Protocol (MCP) is the common way for
assistants such as Claude or ChatGPT to connect to external data. The owner wants the MCP server in the first
milestone.

## Decision

Build a separate `mcp` service with the official MCP TypeScript SDK, using the Streamable HTTP transport, exposing
public calendar data read-only and without authentication.

### Endpoints

- `/mcp` – all tenants; tools take a `tenant` argument.
- `/t/{tenant}/mcp` – scoped to one tenant; the `tenant` argument is fixed. Tenants can publish this address.

### Tools

| Tool | Purpose |
|---|---|
| `list_calendars` | Public calendars of a tenant (name, description, slug, languages) |
| `get_upcoming_events` | Events in a time window, optionally filtered by calendar; recurrences expanded |
| `next_occurrence` | Next occurrence(s) of events matching a calendar and/or text, e.g. "paper collection" |
| `search_events` | Text search in a date range |
| `get_event` | Details of one event, including recurrence description |
| `get_subscription_links` | Feed URLs (https and webcal) and QR code link per calendar and language |

All tools accept an optional `language` (`de`, `fr`, `it`; falls back to the tenant default) and return dates in
Europe/Zurich with ISO 8601 offsets plus a human-readable form. Tool input is validated with zod; result sizes are
capped (e.g. max 100 events per call).

### Resources

- Tenant information (name, languages, website, public page URL).
- Calendar list per tenant.

### Security

- Database role `commucal_mcp` with `SELECT` on `public_*` views only (ADR-0004).
- Rate limiting per client IP on Valkey (ADR-0007); request size and time limits.
- No authentication, because all exposed data is public. No write tools.
- Recurrence expansion and formatting come from `packages/core`, shared with the feeds, so MCP answers and
  calendar feeds always agree.

### Quality

- MCP Inspector runs against the server in CI (protocol conformance and tool schemas).
- Golden tests for typical questions (next collection, events this weekend, DST weeks).

## Rationale

- Streamable HTTP is the current remote transport and works with hosted AI clients as a connector.
- A separate service with its own database role gives a hard guarantee that only public data is reachable.
- The per-tenant endpoint is a product feature: a municipality can tell residents "add our calendar to your assistant".

## Rejected alternatives

- **stdio-only server:** requires local installation by each resident; unusable for the general public.
- **Embedding MCP in the Next.js app:** shares the app's privileged database role.
- **Plain REST/OpenAPI instead of MCP:** fine for developers, but AI assistants connect to MCP directly. A JSON API can
  still be added later from the same core functions.
- **Authenticated write tools now:** valuable for staff, but needs OAuth and careful permission design; postponed.

## Consequences

- Positive: AI access to public data with a minimal attack surface; reuse of feed logic.
- Negative: an unauthenticated public endpoint can be scraped; mitigated by rate limits and WAF.
- Negative: SSE through WEDOS WAF and nginx must be verified (risk in requirements section 11).
- Follow-up: WP-1.8; later ADR for authenticated write tools with OAuth if needed.
- ⚠️ Public API: changes to tool names or schemas are breaking for clients; version and document them.

## References

- [`docs/requirements.md`](../requirements.md) FR-44 to FR-50, US-4, US-12
- ADR-0002 (topology), ADR-0004 (roles and views), ADR-0007 (rate limiting)
