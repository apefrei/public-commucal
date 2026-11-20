"use server";

import {
  AccessDeniedError,
  InvitationError,
  inviteToTenant,
  requireBackendUser,
} from "@commucal/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { authErrorMessage } from "@/lib/auth-messages";
import { logger } from "@/server/logger";
import { clientIp } from "@/server/rate-limit";
import { getServices } from "@/server/services";

export type InviteResult = { ok: true } | { ok: false; message: string };

const inviteSchema = z.object({
  tenantId: z.uuid(),
  email: z.email().max(254),
  role: z.enum(["admin", "contributor"]),
});

/** Invites a person to a tenant (FR-2); allowed for tenant admins and global admins with an MFA-verified session. */
export async function invitePerson(input: z.input<typeof inviteSchema>): Promise<InviteResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Bitte geben Sie eine gültige E-Mail-Adresse an." };
  }
  const requestHeaders = await headers();
  const { auth, authDb, mailer, rateLimiter } = await getServices();
  try {
    const actor = await requireBackendUser(auth, requestHeaders);
    const decision = await rateLimiter.check("action:invite", {
      ip: clientIp(requestHeaders),
      email: null,
    });
    if (!decision.allowed) {
      return { ok: false, message: authErrorMessage({ status: 429 }) };
    }
    await inviteToTenant(authDb, mailer, actor, parsed.data);
    return { ok: true };
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return { ok: false, message: "Dazu fehlt Ihnen die Berechtigung." };
    }
    if (error instanceof InvitationError && error.reason === "already_member") {
      return { ok: false, message: "Diese Person ist bereits Mitglied." };
    }
    logger.error({ err: error }, "invitation failed");
    return { ok: false, message: authErrorMessage({ code: "UNKNOWN" }) };
  }
}
