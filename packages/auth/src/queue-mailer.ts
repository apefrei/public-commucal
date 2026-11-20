import { enqueueEmail } from "@commucal/db";
import type { PgBoss } from "pg-boss";
import type { AuthMailer } from "./auth.ts";

/**
 * AuthMailer for the web app: puts every email on the queue; the worker sends it (ADR-0006). Links point to
 * pages of the web app under baseURL.
 */
export function createQueueMailer(boss: PgBoss, baseURL: string): AuthMailer {
  const link = (path: string) => new URL(path, baseURL).toString();
  return {
    async sendPasswordReset({ to, url }) {
      await enqueueEmail(boss, { template: "password_reset", to, url });
    },
    async sendInvitation({ to, invitationId, tenantName, role }) {
      if (role !== "admin" && role !== "contributor") {
        throw new Error(`Unknown role: ${role}`);
      }
      await enqueueEmail(boss, {
        template: "invitation",
        to,
        url: link(`/einladung/${encodeURIComponent(invitationId)}`),
        tenantName,
        role,
      });
    },
    async sendMfaResetNotice({ to }) {
      await enqueueEmail(boss, { template: "mfa_reset", to, url: link("/anmelden") });
    },
  };
}
