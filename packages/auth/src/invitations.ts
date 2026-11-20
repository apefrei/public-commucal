import {
  appUser,
  type Database,
  isUuid,
  recordAudit,
  TENANT_ROLES,
  type TenantRole,
  tenant,
  tenantInvitation,
  tenantMember,
  withTenant,
} from "@commucal/db";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  type Auth,
  type AuthMailer,
  INVITATION_LIFETIME_SECONDS,
  MIN_PASSWORD_LENGTH,
} from "./auth.ts";
import { AccessDeniedError, type BackendUser, getTenantRole } from "./backend-access.ts";

// Invitations (FR-2). Global admins invite the first admin of a tenant; tenant admins invite members of their tenant.
// Better Auth's invite endpoint requires the inviter to be a member, which global admins are not, so CommuCal creates
// invitations itself (one path for both, with audit entry). Accepting stays with Better Auth, which checks that the
// signed-in user's email matches the invitation.

export class InvitationError extends Error {
  readonly reason: "already_member" | "invalid" | "account_exists";

  constructor(reason: "already_member" | "invalid" | "account_exists") {
    super(`Invitation: ${reason}`);
    this.name = "InvitationError";
    this.reason = reason;
  }
}

const inviteSchema = z.object({
  tenantId: z.uuid(),
  email: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  role: z.enum(TENANT_ROLES),
});

export type InviteInput = z.input<typeof inviteSchema>;

/** Creates an invitation and queues the email. Replaces a pending invitation for the same email and tenant. */
export async function inviteToTenant(
  authDb: Database,
  mailer: Pick<AuthMailer, "sendInvitation">,
  actor: BackendUser,
  input: InviteInput,
): Promise<string> {
  const { tenantId, email, role } = inviteSchema.parse(input);
  if ((await getTenantRole(authDb, actor, tenantId)) !== "admin") {
    throw new AccessDeniedError("forbidden");
  }
  const { invitationId, tenantName } = await withTenant(
    authDb,
    { tenantId, globalAdmin: actor.globalAdmin },
    async (tx) => {
      const [target] = await tx
        .select({ name: tenant.name })
        .from(tenant)
        .where(and(eq(tenant.id, tenantId), eq(tenant.status, "active")));
      if (!target) {
        throw new AccessDeniedError("forbidden");
      }
      const existingMember = await tx
        .select({ id: tenantMember.id })
        .from(tenantMember)
        .innerJoin(appUser, eq(appUser.id, tenantMember.userId))
        .where(and(eq(tenantMember.organizationId, tenantId), eq(appUser.email, email)));
      if (existingMember.length > 0) {
        throw new InvitationError("already_member");
      }
      await tx
        .update(tenantInvitation)
        .set({ status: "canceled" })
        .where(
          and(
            eq(tenantInvitation.organizationId, tenantId),
            eq(tenantInvitation.email, email),
            eq(tenantInvitation.status, "pending"),
          ),
        );
      const [created] = await tx
        .insert(tenantInvitation)
        .values({
          organizationId: tenantId,
          email,
          role,
          inviterId: actor.id,
          expiresAt: new Date(Date.now() + INVITATION_LIFETIME_SECONDS * 1000),
        })
        .returning({ id: tenantInvitation.id });
      if (!created) {
        throw new Error("The invitation was not created");
      }
      // The email address stays out of the audit log; the invitation row holds it.
      await recordAudit(tx, {
        tenantId,
        actorUserId: actor.id,
        action: "invitation.create",
        entityType: "invitation",
        entityId: created.id,
        data: { role },
      });
      return { invitationId: created.id, tenantName: target.name };
    },
  );
  await mailer.sendInvitation({ to: email, invitationId, tenantName, role });
  return invitationId;
}

export interface InvitationDetails {
  id: string;
  email: string;
  tenantName: string;
  role: TenantRole;
  /** Whether a CommuCal account with the invited email exists (then: log in instead of registering). */
  accountExists: boolean;
}

/** A pending, unexpired invitation to an active tenant, or null. The id is the secret from the email link. */
export async function getOpenInvitation(
  authDb: Database,
  invitationId: string,
): Promise<InvitationDetails | null> {
  if (!isUuid(invitationId)) {
    return null;
  }
  const [row] = await authDb
    .select({
      id: tenantInvitation.id,
      email: tenantInvitation.email,
      role: tenantInvitation.role,
      tenantName: tenant.name,
    })
    .from(tenantInvitation)
    .innerJoin(tenant, eq(tenant.id, tenantInvitation.organizationId))
    .where(
      and(
        eq(tenantInvitation.id, invitationId),
        eq(tenantInvitation.status, "pending"),
        gt(tenantInvitation.expiresAt, new Date()),
        eq(tenant.status, "active"),
      ),
    );
  if (!row) {
    return null;
  }
  const accounts = await authDb
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.email, row.email));
  return { ...row, role: row.role as TenantRole, accountExists: accounts.length > 0 };
}

const registrationSchema = z.object({
  invitationId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export type RegistrationInput = z.input<typeof registrationSchema>;

/**
 * Creates the account of an invited person (FR-2). The email comes from the invitation, never from the form, and
 * counts as verified because the link reached that mailbox. The invitation stays pending: the person accepts it
 * after login and MFA setup.
 */
export async function registerInvitedUser(
  authDb: Database,
  auth: Pick<Auth, "api">,
  input: RegistrationInput,
): Promise<{ email: string }> {
  const { invitationId, name, password } = registrationSchema.parse(input);
  const invitation = await getOpenInvitation(authDb, invitationId);
  if (!invitation) {
    throw new InvitationError("invalid");
  }
  if (invitation.accountExists) {
    throw new InvitationError("account_exists");
  }
  const { user } = await auth.api.signUpEmail({
    body: { email: invitation.email, name, password },
  });
  await authDb
    .update(appUser)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(appUser.id, user.id));
  return { email: invitation.email };
}

export interface PendingInvitation {
  id: string;
  tenantName: string;
  role: TenantRole;
}

/** Pending, unexpired invitations for the user's email to active tenants. */
export async function listPendingInvitations(
  authDb: Database,
  user: BackendUser,
): Promise<PendingInvitation[]> {
  const rows = await authDb
    .select({ id: tenantInvitation.id, tenantName: tenant.name, role: tenantInvitation.role })
    .from(tenantInvitation)
    .innerJoin(tenant, eq(tenant.id, tenantInvitation.organizationId))
    .where(
      and(
        eq(tenantInvitation.email, user.email),
        eq(tenantInvitation.status, "pending"),
        gt(tenantInvitation.expiresAt, new Date()),
        eq(tenant.status, "active"),
      ),
    )
    .orderBy(tenant.name);
  return rows.map((row) => ({ ...row, role: row.role as TenantRole }));
}
