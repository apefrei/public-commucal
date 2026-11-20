import { type Database, isUuid, type TenantRole, tenant, tenantMember } from "@commucal/db";
import { and, eq } from "drizzle-orm";
import type { Auth } from "./auth.ts";
import { isMfaVerifiedSession } from "./mfa.ts";

/** The signed-in backend user as CommuCal code sees it. */
export interface BackendUser {
  id: string;
  email: string;
  name: string;
  globalAdmin: boolean;
}

/**
 * Result of checking a request against the backend rules (ADR-0003):
 * - `signed_out`: no valid session
 * - `mfa_setup_required`: valid session, but not MFA-verified; only the MFA setup flow is allowed (FR-3)
 * - `granted`: MFA-verified session
 */
export type BackendAccess =
  | { kind: "signed_out" }
  | { kind: "mfa_setup_required"; userId: string }
  | { kind: "granted"; user: BackendUser; sessionId: string };

export class AccessDeniedError extends Error {
  readonly reason: "signed_out" | "mfa_setup_required" | "forbidden";

  constructor(reason: "signed_out" | "mfa_setup_required" | "forbidden") {
    super(`Access denied: ${reason}`);
    this.name = "AccessDeniedError";
    this.reason = reason;
  }
}

export async function getBackendAccess(auth: Auth, headers: Headers): Promise<BackendAccess> {
  const result = await auth.api.getSession({ headers });
  if (!result) {
    return { kind: "signed_out" };
  }
  const { user, session } = result;
  if (!isMfaVerifiedSession(user, session)) {
    return { kind: "mfa_setup_required", userId: user.id };
  }
  return {
    kind: "granted",
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      globalAdmin: user.globalAdmin === true,
    },
  };
}

/**
 * For every backend page, route handler and server action except the MFA setup flow: returns the user or throws
 * AccessDeniedError.
 */
export async function requireBackendUser(auth: Auth, headers: Headers): Promise<BackendUser> {
  const access = await getBackendAccess(auth, headers);
  if (access.kind !== "granted") {
    throw new AccessDeniedError(access.kind);
  }
  return access.user;
}

/**
 * Role of a user in an active tenant, or null. Global admins act in every tenant without a membership; they get
 * "admin". Uses the auth database (commucal_auth), because memberships are not visible to the app role.
 */
export async function getTenantRole(
  authDb: Database,
  user: BackendUser,
  tenantId: string,
): Promise<TenantRole | null> {
  if (!isUuid(tenantId)) {
    return null;
  }
  const rows = await authDb
    .select({ role: tenantMember.role, status: tenant.status })
    .from(tenant)
    .leftJoin(
      tenantMember,
      and(eq(tenantMember.organizationId, tenant.id), eq(tenantMember.userId, user.id)),
    )
    .where(eq(tenant.id, tenantId));
  const row = rows[0];
  if (!row) {
    return null;
  }
  if (user.globalAdmin) {
    return "admin";
  }
  if (row.status !== "active" || !row.role) {
    return null;
  }
  return row.role as TenantRole;
}

/** Throws AccessDeniedError unless the user has one of the roles in the tenant. */
export async function requireTenantRole(
  authDb: Database,
  user: BackendUser,
  tenantId: string,
  allowed: readonly TenantRole[],
): Promise<TenantRole> {
  const role = await getTenantRole(authDb, user, tenantId);
  if (!role || !allowed.includes(role)) {
    throw new AccessDeniedError("forbidden");
  }
  return role;
}
