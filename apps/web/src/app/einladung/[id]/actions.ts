"use server";

import { InvitationError, registerInvitedUser } from "@commucal/auth";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { z } from "zod";
import { authErrorMessage } from "@/lib/auth-messages";
import { logger } from "@/server/logger";
import { clientIp } from "@/server/rate-limit";
import { getServices } from "@/server/services";

export type RegisterResult = { ok: true } | { ok: false; message: string };

const formSchema = z.object({
  invitationId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  password: z.string().max(128),
  confirmation: z.string().max(128),
});

/** Creates the account of an invited person (FR-2). Public, so rate-limited per IP. */
export async function registerInvited(input: z.input<typeof formSchema>): Promise<RegisterResult> {
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Bitte füllen Sie alle Felder aus." };
  }
  const { invitationId, name, password, confirmation } = parsed.data;
  if (password !== confirmation) {
    return { ok: false, message: "Die beiden Passwörter stimmen nicht überein." };
  }
  const { auth, authDb, rateLimiter } = await getServices();
  const decision = await rateLimiter.check("action:register-invited", {
    ip: clientIp(await headers()),
    email: null,
  });
  if (!decision.allowed) {
    return { ok: false, message: authErrorMessage({ status: 429 }) };
  }
  try {
    await registerInvitedUser(authDb, auth, { invitationId, name, password });
    return { ok: true };
  } catch (error) {
    if (error instanceof InvitationError) {
      return {
        ok: false,
        message:
          error.reason === "account_exists"
            ? "Für diese Adresse besteht bereits ein Konto. Bitte melden Sie sich an."
            : "Diese Einladung ist ungültig oder abgelaufen.",
      };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, message: authErrorMessage({ code: "PASSWORD_TOO_SHORT" }) };
    }
    if (isAPIError(error)) {
      const code = (error.body as { code?: string } | undefined)?.code;
      return { ok: false, message: authErrorMessage({ code }) };
    }
    logger.error({ err: error }, "registration of an invited user failed");
    return { ok: false, message: authErrorMessage({ code: "UNKNOWN" }) };
  }
}
