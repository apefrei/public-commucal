# ADR 0006: Transactional email with Resend

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

The product sends transactional emails: invitations, password reset, MFA reset notices, contributor notifications
about new event proposals, and annual invoices with payment reminders (ADR-0008). The playbook allows Resend or Postmark. Both are US companies; the product targets Swiss
municipalities under the revDSG.

## Decision

Send all transactional email through Resend in the Ireland region (`eu-west-1`), from the `worker` via a pg-boss job,
with sender addresses on `commucal.ch`. Personal data passed to Resend is limited to backend users and tenants'
billing contacts (email address, name). No email is ever sent to residents who submit proposals, and contributor
notifications contain no submitter data.

## Rationale

- The owner already uses Resend; it is on the playbook's list of allowed providers.
- The content is about public calendars; the only personal data involved are backend users' contact details, which
  they provide for exactly this purpose.
- Sending from the worker keeps the request path fast and allows retries.

## Rejected alternatives

- **Postmark:** equivalent; no advantage for this project.
- **Swiss SMTP provider (e.g. Infomaniak) via Nodemailer:** keeps data in Switzerland but is not on the playbook list and
  was not chosen by the owner. Can replace Resend later behind the same mail interface.
- **Emails to submitters (confirmation, decision):** would pass residents' personal data to a US processor; the on-screen
  confirmation is sufficient.

## Consequences

- Positive: reliable delivery, simple API, no mail server to operate.
- Negative: Resend is a US company, even though sending runs in Ireland. ⚠️ Personal data (DSG): Resend must be listed
  in the privacy policy and its data processing agreement accepted.
- Follow-up: SPF, DKIM and DMARC for `commucal.ch` so invoices and invitations are not marked as spam.
- Follow-up: WP-1.4 (mail interface, templates in DE first), WP-2.4 (contributor notifications), WP-3.5 (privacy policy).
  Development uses Mailpit; staging uses a Resend test domain or Mailpit.

## References

- [`docs/requirements.md`](../requirements.md) FR-2, FR-5, FR-7, FR-34, FR-35, FR-55, FR-58, NFR-14
- ADR-0008 (invoicing)
