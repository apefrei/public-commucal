import {
  appUser,
  authSession,
  type Database,
  isUuid,
  recordAudit,
  tenantMember,
  twoFactor,
  withTenant,
} from "@commucal/db";
import { and, eq } from "drizzle-orm";
import type { AuthMailer } from "./auth.ts";
import { AccessDeniedError, type BackendUser, getTenantRole } from "./backend-access.ts";

export interface MfaResetRequest {
  actor: BackendUser;
  targetUserId: string;
  /**
   * Tenant in which a tenant admin acts; the target must be a member of it. Global admins may pass null for users
   * without a tenant (e.g. another global admin); the audit entry then goes to the platform chain.
   */
  tenantId: string | null;
}

/**
 * Resets a user's MFA (FR-5): removes the TOTP factor and backup codes, ends all sessions of the user and writes
 * an audit entry, all in one transaction. The user must set up MFA again at the next login and is notified by email.
 *
 * Allowed for global admins, and for tenant admins on members of their tenant who are not global admins. Nobody
 * resets their own MFA this way.
 */
export async function resetMfa(
  authDb: Database,
  mailer: Pick<AuthMailer, "sendMfaResetNotice">,
  request: MfaResetRequest,
): Promise<void> {
  const { actor, targetUserId, tenantId } = request;
  if (!isUuid(targetUserId) || (tenantId !== null && !isUuid(tenantId))) {
    throw new AccessDeniedError("forbidden");
  }
  if (actor.id === targetUserId) {
    throw new AccessDeniedError("forbidden");
  }
  if (!actor.globalAdmin) {
    if (tenantId === null || (await getTenantRole(authDb, actor, tenantId)) !== "admin") {
      throw new AccessDeniedError("forbidden");
    }
  }

  const target = await withTenant(
    authDb,
    { tenantId, globalAdmin: actor.globalAdmin },
    async (tx) => {
      const [user] = await tx
        .select({ email: appUser.email, globalAdmin: appUser.globalAdmin })
        .from(appUser)
        .where(eq(appUser.id, targetUserId))
        .for("update");
      if (!user) {
        throw new AccessDeniedError("forbidden");
      }
      if (!actor.globalAdmin) {
        if (user.globalAdmin || tenantId === null) {
          throw new AccessDeniedError("forbidden");
        }
        const membership = await tx
          .select({ id: tenantMember.id })
          .from(tenantMember)
          .where(
            and(eq(tenantMember.userId, targetUserId), eq(tenantMember.organizationId, tenantId)),
          );
        if (membership.length === 0) {
          throw new AccessDeniedError("forbidden");
        }
      }

      await tx.delete(twoFactor).where(eq(twoFactor.userId, targetUserId));
      await tx
        .update(appUser)
        .set({ twoFactorEnabled: false, twoFactorEnabledAt: null, updatedAt: new Date() })
        .where(eq(appUser.id, targetUserId));
      await tx.delete(authSession).where(eq(authSession.userId, targetUserId));
      await recordAudit(tx, {
        tenantId,
        actorUserId: actor.id,
        action: "user.mfa_reset",
        entityType: "user",
        entityId: targetUserId,
      });
      return user;
    },
  );

  await mailer.sendMfaResetNotice({ to: target.email });
}
