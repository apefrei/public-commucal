# ADR 0008: Annual invoicing with Swiss QR bill by email

- Status: Accepted
- Date: 2026-11-19
- Authors: apefrei

## Context

Municipalities and associations will pay an annual price per tenant. The owner wants billing to be simple and
traditional: invoices are created and emailed automatically, and customers pay by bank transfer. Swiss public
administrations process invoices with a QR bill (QR-Rechnung) in their accounting and e-banking. The playbook names the
Stripe SDK for payments; no online payment is planned.

## Decision

Generate annual invoices in the `worker` as PDF documents with a Swiss QR bill, using `swissqrbill` (QR bill section)
on top of `pdfkit` (invoice layout), and email them through Resend (ADR-0006). Payments arrive by bank transfer and
are marked as paid by a global admin.

Details:

- Billing year starts at the tenant's activation date; the invoice is created at its start, payment term 30 days.
- Invoice numbers are sequential and gapless per year, allocated inside the transaction that creates the invoice.
- The QR bill uses either the operator's IBAN with an ISO 11649 creditor reference (SCOR) or a QR-IBAN with a QR
  reference (QRR); both encode the invoice number, so payments can be matched later, also automatically from camt.054 files.
- Issued invoices are immutable: the PDF and a data snapshot (address, items, amounts, VAT) are stored in PostgreSQL.
  Corrections are made with a credit note. Retention 10 years (Code of Obligations art. 958f).
- Reminders are sent automatically at 10 and 30 days overdue; no automatic blocking of tenants.
- Billing tables carry `tenant_id` and follow the RLS rules of ADR-0004; only global admins can change billing data
  other than a tenant's own billing profile.

## Rationale

- The QR bill is the standard payment slip in Switzerland; municipal accounting can process it without new tools.
- `swissqrbill` is a maintained MIT library that implements the QR bill specification, so we do not build the QR
  payload or layout ourselves.
- Without online payments there is no payment provider, no card data and no extra processor.
- Generating invoices in the worker fits the existing job queue and email path.

## Rejected alternatives

- **Stripe Billing / Stripe Invoicing:** designed for card and online payments; adds a processor and fees; Swiss
  municipalities expect a QR bill.
- **External accounting or invoicing software (e.g. Bexio):** another processor and integration for a handful of
  invoices a year; may be revisited when volume grows.
- **Manual invoices:** contradicts the goal of automatic annual billing.

## Consequences

- Positive: billing that matches how Swiss municipalities pay; no payment provider.
- Negative: payment status is maintained manually until camt.054 import is added.
- Negative: ⚠️ invoices are legal documents; numbering, immutability and retention must be correct from the first
  invoice. Covered by tests and by the M4 exit criteria (validator and e-banking scan).
- Follow-up: WP-4.1 to WP-4.5; operator details (legal entity, IBAN/QR-IBAN, VAT status) are open question Q5.

## References

- [`docs/requirements.md`](../requirements.md) FR-51 to FR-61, milestone M4
- ADR-0004 (RLS and audit), ADR-0006 (email)
- Swiss Implementation Guidelines for the QR-bill (SIX)
