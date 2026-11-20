import { emailJobSchema } from "@commucal/db";
import type { Logger } from "pino";
import { renderEmail } from "./templates.ts";
import type { EmailTransport } from "./transport.ts";

/**
 * Sends one email job. An invalid payload or a transport error throws, so pg-boss retries the job with backoff.
 * The log holds the job id and template, not the recipient (personal data).
 */
export async function sendEmailJob(
  job: { id: string; data: unknown },
  transport: EmailTransport,
  logger: Logger,
): Promise<void> {
  const email = emailJobSchema.parse(job.data);
  const rendered = renderEmail(email);
  await transport.send({ ...rendered, to: email.to, idempotencyKey: `email-${job.id}` });
  logger.info({ jobId: job.id, template: email.template, transport: transport.name }, "email sent");
}
