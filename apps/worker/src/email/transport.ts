import { Resend } from "resend";
import type { RenderedEmail } from "./templates.ts";

export interface OutgoingEmail extends RenderedEmail {
  to: string;
  /** Stable per job, so a retried job does not send the same email twice (where the provider supports it). */
  idempotencyKey: string;
}

export interface EmailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

/** Production: Resend, region eu-west-1 (ADR-0006). */
export function resendTransport(apiKey: string, from: string): EmailTransport {
  const resend = new Resend(apiKey);
  return {
    name: "resend",
    async send(email) {
      const { error } = await resend.emails.send(
        { from, to: [email.to], subject: email.subject, text: email.text },
        { idempotencyKey: email.idempotencyKey },
      );
      if (error) {
        throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
      }
    },
  };
}

/** Development and staging: Mailpit's send API; mails never leave the host. */
export function mailpitTransport(baseUrl: string, from: string): EmailTransport {
  const endpoint = new URL("/api/v1/send", baseUrl);
  const sender = parseAddress(from);
  return {
    name: "mailpit",
    async send(email) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: sender,
          To: [{ Email: email.to }],
          Subject: email.subject,
          Text: email.text,
          Headers: { "Idempotency-Key": email.idempotencyKey },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Mailpit rejected the email: HTTP ${response.status}`);
      }
    },
  };
}

/** "Name <address>" or "address". */
function parseAddress(value: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (match?.[2]) {
    return match[1] ? { Email: match[2], Name: match[1] } : { Email: match[2] };
  }
  return { Email: value.trim() };
}

/**
 * Chooses the transport from the environment: Resend if RESEND_API_KEY is set, otherwise Mailpit if MAILPIT_URL is
 * set. Without either the worker refuses to start, so emails are never dropped silently.
 */
export function transportFromEnv(env: NodeJS.ProcessEnv): EmailTransport {
  const from = env.MAIL_FROM;
  if (!from) {
    throw new Error("MAIL_FROM is not set");
  }
  if (env.RESEND_API_KEY) {
    return resendTransport(env.RESEND_API_KEY, from);
  }
  if (env.MAILPIT_URL) {
    return mailpitTransport(env.MAILPIT_URL, from);
  }
  throw new Error("Set RESEND_API_KEY (production) or MAILPIT_URL (development, staging)");
}
